import BN from "bn.js";
import { Connection } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { CreatorRiskResult } from "../../domain/types";
import { stageLog } from "../reporting/stageLog";
import { formatQuoteMovePct } from "../../utils/format";
import { shortSig } from "../../utils/pubkeys";
import { getExitQuoteSolFromState, getSolLiquidityFromState } from "./quote";

type HoldMonitorDeps = {
    recheckCreatorRisk: (
        connection: Connection,
        creatorAddress: string,
        logPrefix: string,
        entrySolLiquidity: number,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
        initialCreatorRisk?: CreatorRiskResult,
    ) => Promise<CreatorRiskResult>;
    shouldEscalateProbationCreatorRisk: (
        creatorRisk: CreatorRiskResult,
        baselineCreatorCashoutSol?: number,
    ) => { escalate: boolean; cashoutDeltaSol: number };
    detectRemoveLiquiditySince: (
        connection: Connection,
        poolAddress: string,
        creatorAddress: string,
        seenPoolSignatures: Set<string>,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
    ) => Promise<{
        detected: boolean;
        signature?: string | null;
        wsolToCreator?: number;
        solToCreator?: number;
        creatorAmmTouch?: boolean;
        eventTimeSec?: number | null;
    }>;
    getPoolRecentChurnStats: (
        connection: Connection,
        poolAddress: string,
        createPoolSignature?: string,
        minBlockTimeSec?: number | null,
    ) => Promise<{ shortCount: number; longCount: number; criticalCount: number }>;
    detectCreatorLargeOutboundSince: (
        connection: Connection,
        creatorAddress: string,
        poolAddress: string,
        seenCreatorSignatures: Set<string>,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
    ) => Promise<{ detected: boolean; signature?: string | null; outboundSol?: number; destination?: string | null }>;
    collectCreatorCloseAccountEventsSince: (
        connection: Connection,
        creatorAddress: string,
        seenCreatorCloseAccountSignatures: Set<string>,
        createPoolSignature?: string,
        minBlockTimeSec?: number | null,
    ) => Promise<Array<{ closeCount: number; eventTimeSec: number; signature: string }>>;
    collectCreatorOutboundTransfersSince: (
        connection: Connection,
        creatorAddress: string,
        poolAddress: string,
        seenCreatorSpraySignatures: Set<string>,
        createPoolSignature?: string,
        minBlockTimeSec?: number | null,
    ) => Promise<Array<{ destination: string; sol: number; eventTimeSec: number; signature: string }>>;
    collectCreatorInboundTransfersSince: (
        connection: Connection,
        creatorAddress: string,
        poolAddress: string,
        seenCreatorInboundSpraySignatures: Set<string>,
        createPoolSignature?: string,
        minBlockTimeSec?: number | null,
    ) => Promise<Array<{ source: string; sol: number; eventTimeSec: number; signature: string }>>;
    classifyHoldCreatorCloseAccountBurst: (
        events: Array<{ closeCount: number; eventTimeSec: number; signature: string }>
    ) => { detected: boolean; txCount: number; totalCloseCount: number; latestSignature: string };
    classifyHoldCreatorOutboundSpray: (
        events: Array<{ destination: string; sol: number; eventTimeSec: number; signature: string }>
    ) => { detected: boolean; transfers: number; destinations: number; medianSol: number; relStdDev: number; amountRatio: number };
    classifyHoldCreatorInboundSpray: (
        events: Array<{ source: string; sol: number; eventTimeSec: number; signature: string }>
    ) => { detected: boolean; transfers: number; sources: number; medianSol: number; relStdDev: number; amountRatio: number };
};

export async function waitForExitStateWithLiquidityStop(
    deps: HoldMonitorDeps,
    connection: Connection,
    poolAddress: string,
    fetchStateWithRetry: () => Promise<any | null>,
    entryState: any,
    tokenMint: string,
    tokenOutAtomic: BN,
    logPrefix: string,
    holdMs: number,
    suppressCreatorRiskRecheck: boolean,
    creatorAddress?: string,
    createPoolSignature?: string,
    createPoolBlockTime?: number | null,
    initialCreatorRisk?: CreatorRiskResult,
): Promise<any | null> {
    const startedAtMs = Date.now();
    const deadlineMs = startedAtMs + Math.max(1000, holdMs);
    const pollIntervalMs = Math.max(250, Math.min(CONFIG.HOLD_REMOVE_LIQ_CHECK_INTERVAL_MS, 1500));
    const removeLiqCheckIntervalMs = Math.max(500, CONFIG.HOLD_REMOVE_LIQ_CHECK_INTERVAL_MS);
    const entrySolLiquidity = getSolLiquidityFromState(entryState, tokenMint) || 0;
    let latestState: any | null = entryState;
    let lastCreatorRiskCheckAtMs = 0;
    let lastRemoveLiqCheckAtMs = 0;
    let lastCreatorOutboundCheckAtMs = 0;
    let lastCreatorCloseAccountCheckAtMs = 0;
    let lastCreatorOutboundSprayCheckAtMs = 0;
    let lastCreatorInboundSprayCheckAtMs = 0;
    let lastPoolChurnCheckAtMs = 0;
    let lastPoolChurnWarnAtMs = 0;
    let lastSellQuoteCollapseCheckAtMs = 0;
    const seenPoolSignatures = new Set<string>();
    const seenCreatorSignatures = new Set<string>();
    const seenCreatorSpraySignatures = new Set<string>();
    const seenCreatorInboundSpraySignatures = new Set<string>();
    const seenCreatorCloseAccountSignatures = new Set<string>();
    const creatorAmmTouchTimesSec: number[] = [];
    const creatorOutboundSprayEvents: Array<{ destination: string; sol: number; eventTimeSec: number; signature: string }> = [];
    const creatorInboundSprayEvents: Array<{ source: string; sol: number; eventTimeSec: number; signature: string }> = [];
    const creatorCloseAccountEvents: Array<{ closeCount: number; eventTimeSec: number; signature: string }> = [];
    const baselineCreatorCashoutSol = Number(initialCreatorRisk?.creatorCashoutSol || 0);
    const baselineExitQuoteSol = getExitQuoteSolFromState(entryState, tokenMint, tokenOutAtomic);
    if (createPoolSignature) seenPoolSignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorSignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorSpraySignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorInboundSpraySignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorCloseAccountSignatures.add(createPoolSignature);

    const holdIntervalScale =
        suppressCreatorRiskRecheck
            ? Math.min(1, Math.max(0.1, CONFIG.HOLD_PROBATION_INTERVAL_MULTIPLIER))
            : 1;
    const scaledInterval = (baseMs: number) => Math.max(500, Math.round(baseMs * holdIntervalScale));

    while (Date.now() < deadlineMs) {
        const s = await fetchStateWithRetry();
        if (s) {
            latestState = s;

            if (
                creatorAddress &&
                CONFIG.HOLD_CREATOR_RISK_RECHECK_ENABLED &&
                Date.now() - lastCreatorRiskCheckAtMs >= scaledInterval(CONFIG.HOLD_CREATOR_RISK_RECHECK_INTERVAL_MS)
            ) {
                lastCreatorRiskCheckAtMs = Date.now();
                const creatorRisk = await deps.recheckCreatorRisk(
                    connection,
                    creatorAddress,
                    logPrefix,
                    entrySolLiquidity,
                    createPoolSignature,
                    createPoolBlockTime,
                    initialCreatorRisk,
                );
                if (!creatorRisk.ok) {
                    if (creatorRisk.transientError) {
                        stageLog(logPrefix, "CRISK", `transient error during hold recheck (${creatorRisk.reason || "rate limited"})`);
                        continue;
                    }
                    if (suppressCreatorRiskRecheck) {
                        const probationEscalation = deps.shouldEscalateProbationCreatorRisk(
                            creatorRisk,
                            baselineCreatorCashoutSol,
                        );
                        if (probationEscalation.escalate) {
                            console.log(
                                `⚠️ CREATOR RISK EXIT (probation hard): ${creatorRisk.reason}` +
                                ` (cashout_delta=${probationEscalation.cashoutDeltaSol.toFixed(3)} SOL)`
                            );
                            return s;
                        }
                    } else {
                        console.log(`⚠️ CREATOR RISK EXIT: ${creatorRisk.reason}`);
                        return s;
                    }
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_REMOVE_LIQ_DETECT_ENABLED &&
                Date.now() - lastRemoveLiqCheckAtMs >= scaledInterval(removeLiqCheckIntervalMs)
            ) {
                lastRemoveLiqCheckAtMs = Date.now();
                const removeLiq = await deps.detectRemoveLiquiditySince(
                    connection,
                    poolAddress,
                    creatorAddress,
                    seenPoolSignatures,
                    createPoolSignature,
                    createPoolBlockTime,
                );
                if (removeLiq.detected) {
                    console.log(
                        `⚠️ REMOVE LIQUIDITY EXIT: ` +
                        `${shortSig(removeLiq.signature || "-")} ` +
                        `(wsol_to_creator=${(removeLiq.wsolToCreator || 0).toFixed(3)} ` +
                        `sol_to_creator=${(removeLiq.solToCreator || 0).toFixed(3)} ` +
                        `entry_liq=${entrySolLiquidity.toFixed(2)} SOL)`
                    );
                    return s;
                }
                if (CONFIG.HOLD_CREATOR_AMM_BURST_DETECT_ENABLED && removeLiq.creatorAmmTouch) {
                    const eventTimeSec = removeLiq.eventTimeSec || Math.floor(Date.now() / 1000);
                    creatorAmmTouchTimesSec.push(eventTimeSec);
                    const windowSec = Math.max(1, CONFIG.HOLD_CREATOR_AMM_BURST_WINDOW_SEC);
                    const minTxs = Math.max(2, CONFIG.HOLD_CREATOR_AMM_BURST_MIN_TXS);
                    const cutoff = eventTimeSec - windowSec;
                    while (creatorAmmTouchTimesSec.length && creatorAmmTouchTimesSec[0] < cutoff) {
                        creatorAmmTouchTimesSec.shift();
                    }
                    if (creatorAmmTouchTimesSec.length >= minTxs) {
                        console.log(
                            `⚠️ CREATOR AMM BURST EXIT: ` +
                            `${creatorAmmTouchTimesSec.length} tx in ${windowSec}s ` +
                            `(${shortSig(removeLiq.signature || "-")})`
                        );
                        return s;
                    }
                }
            }

            if (
                CONFIG.HOLD_SELL_QUOTE_COLLAPSE_EXIT_ENABLED &&
                baselineExitQuoteSol &&
                baselineExitQuoteSol > 0 &&
                Date.now() - startedAtMs >= Math.max(0, CONFIG.HOLD_SELL_QUOTE_COLLAPSE_MIN_HOLD_MS) &&
                Date.now() - lastSellQuoteCollapseCheckAtMs >= scaledInterval(CONFIG.HOLD_SELL_QUOTE_COLLAPSE_CHECK_INTERVAL_MS)
            ) {
                lastSellQuoteCollapseCheckAtMs = Date.now();
                const currentExitQuoteSol = getExitQuoteSolFromState(s, tokenMint, tokenOutAtomic);
                if (currentExitQuoteSol !== null) {
                    const dropPct = ((baselineExitQuoteSol - currentExitQuoteSol) / baselineExitQuoteSol) * 100;
                    const minExitSol = Math.max(0, CONFIG.HOLD_SELL_QUOTE_COLLAPSE_MIN_SOL);
                    const dropTriggered = dropPct >= Math.abs(CONFIG.HOLD_SELL_QUOTE_COLLAPSE_DROP_PCT);
                    const floorTriggered = currentExitQuoteSol <= minExitSol;
                    if (dropTriggered || floorTriggered) {
                        console.log(
                            `⚠️ SELL QUOTE COLLAPSE EXIT: ` +
                            `${baselineExitQuoteSol.toFixed(6)} -> ${currentExitQuoteSol.toFixed(6)} SOL ` +
                            `(drop ${dropPct.toFixed(2)}%, floor ${minExitSol.toFixed(6)} SOL)`
                        );
                        return s;
                    }
                }
            }

            if (
                CONFIG.HOLD_POOL_CHURN_DETECT_ENABLED &&
                baselineExitQuoteSol &&
                baselineExitQuoteSol > 0 &&
                Date.now() - lastPoolChurnCheckAtMs >= scaledInterval(CONFIG.HOLD_POOL_CHURN_CHECK_INTERVAL_MS)
            ) {
                lastPoolChurnCheckAtMs = Date.now();
                const churn = await deps.getPoolRecentChurnStats(
                    connection,
                    poolAddress,
                    createPoolSignature,
                    Math.max(createPoolBlockTime || 0, Math.floor(startedAtMs / 1000)),
                );
                const currentExitQuoteSol = getExitQuoteSolFromState(s, tokenMint, tokenOutAtomic);
                if (currentExitQuoteSol && currentExitQuoteSol > 0) {
                    const dropPct = ((baselineExitQuoteSol - currentExitQuoteSol) / baselineExitQuoteSol) * 100;
                    const shortTriggered = churn.shortCount >= Math.max(1, CONFIG.HOLD_POOL_CHURN_TX_SHORT_MIN);
                    const criticalTriggered =
                        churn.criticalCount >= Math.max(1, CONFIG.HOLD_POOL_CHURN_TX_CRITICAL_MIN) &&
                        dropPct >= Math.abs(CONFIG.HOLD_POOL_CHURN_CRITICAL_SELL_DROP_PCT);
                    const longTriggered =
                        churn.longCount >= Math.max(1, CONFIG.HOLD_POOL_CHURN_TX_LONG_MIN) &&
                        dropPct >= Math.abs(CONFIG.HOLD_POOL_CHURN_SELL_DROP_PCT);

                    if (
                        shortTriggered &&
                        Date.now() - lastPoolChurnWarnAtMs >= Math.max(5000, CONFIG.HOLD_POOL_CHURN_WINDOW_SHORT_MS)
                    ) {
                        lastPoolChurnWarnAtMs = Date.now();
                        console.log(
                            `⚠️ POOL CHURN WARN: ${churn.shortCount} tx in ${(CONFIG.HOLD_POOL_CHURN_WINDOW_SHORT_MS / 1000).toFixed(0)}s ` +
                            `(sell_quote ${baselineExitQuoteSol.toFixed(6)} -> ${currentExitQuoteSol.toFixed(6)} SOL, ` +
                            `${formatQuoteMovePct(baselineExitQuoteSol, currentExitQuoteSol)})`
                        );
                    }

                    if (criticalTriggered || longTriggered) {
                        const windowMs = criticalTriggered
                            ? CONFIG.HOLD_POOL_CHURN_WINDOW_CRITICAL_MS
                            : CONFIG.HOLD_POOL_CHURN_WINDOW_LONG_MS;
                        const txCount = criticalTriggered ? churn.criticalCount : churn.longCount;
                        console.log(
                            `⚠️ POOL CHURN EXIT: ${txCount} tx in ${(windowMs / 1000).toFixed(0)}s ` +
                            `(sell_quote ${baselineExitQuoteSol.toFixed(6)} -> ${currentExitQuoteSol.toFixed(6)} SOL, ` +
                            `${formatQuoteMovePct(baselineExitQuoteSol, currentExitQuoteSol)})`
                        );
                        return s;
                    }
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_CREATOR_OUTBOUND_EXIT_ENABLED &&
                Date.now() - lastCreatorOutboundCheckAtMs >= scaledInterval(CONFIG.HOLD_CREATOR_OUTBOUND_CHECK_INTERVAL_MS)
            ) {
                lastCreatorOutboundCheckAtMs = Date.now();
                const creatorOutbound = await deps.detectCreatorLargeOutboundSince(
                    connection,
                    creatorAddress,
                    poolAddress,
                    seenCreatorSignatures,
                    createPoolSignature,
                    createPoolBlockTime,
                );
                if (creatorOutbound.detected) {
                    console.log(
                        `⚠️ CREATOR OUTBOUND EXIT: ` +
                        `${shortSig(creatorOutbound.signature || "-")} ` +
                        `(${(creatorOutbound.outboundSol || 0).toFixed(3)} SOL -> ${shortSig(creatorOutbound.destination || "-")})`
                    );
                    return s;
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_CREATOR_CLOSE_ACCOUNT_BURST_EXIT_ENABLED &&
                Date.now() - lastCreatorCloseAccountCheckAtMs >= scaledInterval(CONFIG.HOLD_CREATOR_CLOSE_ACCOUNT_BURST_CHECK_INTERVAL_MS)
            ) {
                lastCreatorCloseAccountCheckAtMs = Date.now();
                const minBlockTimeSec = Math.max(createPoolBlockTime || 0, Math.floor(startedAtMs / 1000));
                const newEvents = await deps.collectCreatorCloseAccountEventsSince(
                    connection,
                    creatorAddress,
                    seenCreatorCloseAccountSignatures,
                    createPoolSignature,
                    minBlockTimeSec,
                );
                if (newEvents.length) {
                    creatorCloseAccountEvents.push(...newEvents);
                }
                const windowSec = Math.max(5, CONFIG.HOLD_CREATOR_CLOSE_ACCOUNT_BURST_WINDOW_SEC);
                const nowSec = Math.floor(Date.now() / 1000);
                const cutoff = nowSec - windowSec;
                while (creatorCloseAccountEvents.length && creatorCloseAccountEvents[0].eventTimeSec < cutoff) {
                    creatorCloseAccountEvents.shift();
                }
                const burst = deps.classifyHoldCreatorCloseAccountBurst(creatorCloseAccountEvents);
                if (burst.detected) {
                    console.log(
                        `⚠️ CREATOR CLOSE ACCOUNT BURST EXIT: ` +
                        `${burst.txCount} tx / ${burst.totalCloseCount} closes in ${windowSec}s ` +
                        `(sig=${shortSig(burst.latestSignature)})`
                    );
                    return s;
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_EXIT_ENABLED &&
                Date.now() - lastCreatorOutboundSprayCheckAtMs >= scaledInterval(CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_CHECK_INTERVAL_MS)
            ) {
                lastCreatorOutboundSprayCheckAtMs = Date.now();
                const minBlockTimeSec = Math.max(createPoolBlockTime || 0, Math.floor(startedAtMs / 1000));
                const newEvents = await deps.collectCreatorOutboundTransfersSince(
                    connection,
                    creatorAddress,
                    poolAddress,
                    seenCreatorSpraySignatures,
                    createPoolSignature,
                    minBlockTimeSec,
                );
                if (newEvents.length) {
                    creatorOutboundSprayEvents.push(...newEvents);
                }
                const windowSec = Math.max(5, CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_WINDOW_SEC);
                const nowSec = Math.floor(Date.now() / 1000);
                const cutoff = nowSec - windowSec;
                while (creatorOutboundSprayEvents.length && creatorOutboundSprayEvents[0].eventTimeSec < cutoff) {
                    creatorOutboundSprayEvents.shift();
                }
                const spray = deps.classifyHoldCreatorOutboundSpray(creatorOutboundSprayEvents);
                if (spray.detected) {
                    const latestSig = creatorOutboundSprayEvents[creatorOutboundSprayEvents.length - 1]?.signature || "-";
                    console.log(
                        `⚠️ CREATOR OUTBOUND SPRAY EXIT: ` +
                        `${spray.transfers} transfers to ${spray.destinations} destinations in ${windowSec}s ` +
                        `(median ${spray.medianSol.toFixed(3)} SOL, rel_std ${spray.relStdDev.toFixed(2)}, ` +
                        `ratio ${spray.amountRatio.toFixed(2)}, sig=${shortSig(latestSig)})`
                    );
                    return s;
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_CREATOR_INBOUND_SPRAY_EXIT_ENABLED &&
                Date.now() - lastCreatorInboundSprayCheckAtMs >= scaledInterval(CONFIG.HOLD_CREATOR_INBOUND_SPRAY_CHECK_INTERVAL_MS)
            ) {
                lastCreatorInboundSprayCheckAtMs = Date.now();
                const minBlockTimeSec = Math.max(createPoolBlockTime || 0, Math.floor(startedAtMs / 1000));
                const newEvents = await deps.collectCreatorInboundTransfersSince(
                    connection,
                    creatorAddress,
                    poolAddress,
                    seenCreatorInboundSpraySignatures,
                    createPoolSignature,
                    minBlockTimeSec,
                );
                if (newEvents.length) {
                    creatorInboundSprayEvents.push(...newEvents);
                }
                const windowSec = Math.max(5, CONFIG.HOLD_CREATOR_INBOUND_SPRAY_WINDOW_SEC);
                const nowSec = Math.floor(Date.now() / 1000);
                const cutoff = nowSec - windowSec;
                while (creatorInboundSprayEvents.length && creatorInboundSprayEvents[0].eventTimeSec < cutoff) {
                    creatorInboundSprayEvents.shift();
                }
                const spray = deps.classifyHoldCreatorInboundSpray(creatorInboundSprayEvents);
                if (spray.detected) {
                    const latestSig = creatorInboundSprayEvents[creatorInboundSprayEvents.length - 1]?.signature || "-";
                    console.log(
                        `⚠️ CREATOR INBOUND SPRAY EXIT: ` +
                        `${spray.transfers} transfers from ${spray.sources} sources in ${windowSec}s ` +
                        `(median ${spray.medianSol.toFixed(3)} SOL, rel_std ${spray.relStdDev.toFixed(2)}, ` +
                        `ratio ${spray.amountRatio.toFixed(2)}, sig=${shortSig(latestSig)})`
                    );
                    return s;
                }
            }
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    return latestState || fetchStateWithRetry();
}
