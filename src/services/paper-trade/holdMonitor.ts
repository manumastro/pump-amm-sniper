import BN from "bn.js";
import { Connection } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { CreatorRiskResult, WinnerManagementProfile } from "../../domain/types";
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
        tokenMint: string,
        seenPoolSignatures: Set<string>,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
    ) => Promise<{
        detected: boolean;
        signature?: string | null;
        wsolToCreator?: number;
        solToCreator?: number;
        tokenToCreator?: number;
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
    winnerProfile?: WinnerManagementProfile,
    elapsedBeforeStartMs = 0,
    initialPeakExitQuoteSol?: number,
): Promise<{ state: any | null; exitReason?: string } | null> {
    const startedAtMs = Date.now();
    const deadlineMs = startedAtMs + Math.max(1000, holdMs);
    const pollIntervalMs = Math.max(
        200,
        Math.min(
            CONFIG.HOLD_WINNER_CHECK_INTERVAL_MS,
            CONFIG.HOLD_HARD_STOP_LOSS_CHECK_INTERVAL_MS,
            CONFIG.HOLD_SINGLE_SWAP_SHOCK_CHECK_INTERVAL_MS,
            CONFIG.HOLD_SELL_QUOTE_COLLAPSE_CHECK_INTERVAL_MS,
            CONFIG.HOLD_REMOVE_LIQ_CHECK_INTERVAL_MS,
            1000,
        ),
    );
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
    let lastSingleSwapShockCheckAtMs = 0;
    let lastHardStopLossCheckAtMs = 0;
    let lastWinnerCheckAtMs = 0;
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

    let triggerMap: Record<string, { triggered: boolean; detail: string }> = {};
    function recordTrigger(name: string, triggered: boolean, detail: string) {
        triggerMap[name] = { triggered, detail };
    }
    function logHoldSummary(reason: string | undefined) {
        const peakPnlPct = peakExitQuoteSol > 0
            ? ((peakExitQuoteSol - CONFIG.TRADE_AMOUNT_SOL) / CONFIG.TRADE_AMOUNT_SOL) * 100
            : 0;
        const winnerArmed = peakPnlPct >= activeWinnerProfile.armPnlPct;
        const trailingActive = winnerArmed && activeWinnerProfile.trailingDropPct > 0;
        stageLog(logPrefix, "HOLDLOG", JSON.stringify({
            exitReason: reason || "deadline",
            holdMs,
            actualDurationMs: Date.now() - startedAtMs,
            timeToPeakMs: peakAtMs - startedAtMs,
            entryBaselineQuoteSol: baselineExitQuoteSol ? Number(baselineExitQuoteSol.toFixed(8)) : null,
            peakExitQuoteSol: Number(peakExitQuoteSol.toFixed(8)),
            peakPnlPct: Number(peakPnlPct.toFixed(4)),
            winnerArmed,
            trailingActive,
            triggers: triggerMap,
            guards: {
                removeLiq: { enabled: CONFIG.HOLD_REMOVE_LIQ_DETECT_ENABLED },
                creatorAmmBurst: { enabled: CONFIG.HOLD_CREATOR_AMM_BURST_DETECT_ENABLED },
                creatorRiskRecheck: { enabled: CONFIG.HOLD_CREATOR_RISK_RECHECK_ENABLED && !suppressCreatorRiskRecheck },
                winnerManagement: { enabled: activeWinnerProfile.enabled, armPct: activeWinnerProfile.armPnlPct, trailingPct: activeWinnerProfile.trailingDropPct, hardTpPct: activeWinnerProfile.hardTakeProfitPct, minHoldMs: activeWinnerProfile.minHoldMs },
                sellQuoteCollapse: { enabled: CONFIG.HOLD_SELL_QUOTE_COLLAPSE_EXIT_ENABLED, minHoldMs: CONFIG.HOLD_SELL_QUOTE_COLLAPSE_MIN_HOLD_MS, dropPct: CONFIG.HOLD_SELL_QUOTE_COLLAPSE_DROP_PCT },
                singleSwapShock: { enabled: CONFIG.HOLD_SINGLE_SWAP_SHOCK_EXIT_ENABLED, minHoldMs: CONFIG.HOLD_SINGLE_SWAP_SHOCK_MIN_HOLD_MS, dropPct: CONFIG.HOLD_SINGLE_SWAP_SHOCK_DROP_PCT },
                hardStopLoss: { enabled: CONFIG.HOLD_HARD_STOP_LOSS_EXIT_ENABLED, minHoldMs: CONFIG.HOLD_HARD_STOP_LOSS_MIN_HOLD_MS, lossPct: CONFIG.HOLD_HARD_STOP_LOSS_PCT },
                poolChurn: { enabled: CONFIG.HOLD_POOL_CHURN_DETECT_ENABLED },
                creatorOutbound: { enabled: CONFIG.HOLD_CREATOR_OUTBOUND_EXIT_ENABLED },
                creatorCloseAccount: { enabled: CONFIG.HOLD_CREATOR_CLOSE_ACCOUNT_BURST_EXIT_ENABLED },
                creatorOutboundSpray: { enabled: CONFIG.HOLD_CREATOR_OUTBOUND_SPRAY_EXIT_ENABLED },
                creatorInboundSpray: { enabled: CONFIG.HOLD_CREATOR_INBOUND_SPRAY_EXIT_ENABLED },
            },
        }));
    }
    const baselineExitQuoteSol = getExitQuoteSolFromState(entryState, tokenMint, tokenOutAtomic);
    let peakExitQuoteSol = Number.isFinite(initialPeakExitQuoteSol)
        ? Number(initialPeakExitQuoteSol)
        : (baselineExitQuoteSol || 0);
    let peakAtMs = startedAtMs;
    let previousExitQuoteSol = baselineExitQuoteSol;
    const activeWinnerProfile: WinnerManagementProfile = winnerProfile || {
        enabled: CONFIG.HOLD_WINNER_MANAGEMENT_ENABLED,
        checkIntervalMs: CONFIG.HOLD_WINNER_CHECK_INTERVAL_MS,
        minHoldMs: CONFIG.HOLD_WINNER_MIN_HOLD_MS,
        armPnlPct: CONFIG.HOLD_WINNER_ARM_PNL_PCT,
        trailingDropPct: CONFIG.HOLD_WINNER_TRAILING_DROP_PCT,
        hardTakeProfitPct: CONFIG.HOLD_WINNER_HARD_TAKE_PROFIT_PCT,
        minPeakSol: CONFIG.HOLD_WINNER_MIN_PEAK_SOL,
        profitFloorPct: CONFIG.HOLD_WINNER_PROFIT_FLOOR_PCT,
    };
    if (createPoolSignature) seenPoolSignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorSignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorSpraySignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorInboundSpraySignatures.add(createPoolSignature);
    if (createPoolSignature) seenCreatorCloseAccountSignatures.add(createPoolSignature);

    const holdIntervalScale =
        suppressCreatorRiskRecheck
            ? Math.min(1, Math.max(0.1, CONFIG.HOLD_PROBATION_INTERVAL_MULTIPLIER))
            : 1;
    const scaledInterval = (baseMs: number) => Math.max(250, Math.round(baseMs * holdIntervalScale));

    while (Date.now() < deadlineMs) {
        const s = await fetchStateWithRetry();
        if (s) {
            latestState = s;

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
                    tokenMint,
                    seenPoolSignatures,
                    createPoolSignature,
                    createPoolBlockTime,
                );
                if (removeLiq.detected) {
                    const detail = `${shortSig(removeLiq.signature || "-")} wsol=${(removeLiq.wsolToCreator||0).toFixed(3)} sol=${(removeLiq.solToCreator||0).toFixed(3)} tok=${(removeLiq.tokenToCreator||0).toFixed(3)}`;
                    recordTrigger("removeLiq", true, detail);
                    console.log(`⚠️ REMOVE LIQUIDITY EXIT: ${detail}`);
                    logHoldSummary("remove liquidity");
                    return { state: s, exitReason: "remove liquidity" };
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
                        recordTrigger("creatorAmmBurst", true, `${creatorAmmTouchTimesSec.length}tx/${windowSec}s`);
                        console.log(`⚠️ CREATOR AMM BURST EXIT: ${creatorAmmTouchTimesSec.length}tx in ${windowSec}s (${shortSig(removeLiq.signature||"-")})`);
                        logHoldSummary("creator amm burst");
                        return { state: s, exitReason: "creator amm burst" };
                    }
                }
            }

            if (
                creatorAddress &&
                CONFIG.HOLD_CREATOR_RISK_RECHECK_ENABLED &&
                !suppressCreatorRiskRecheck &&
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
                    recordTrigger("creatorRiskRecheck", true, creatorRisk.reason || "unknown");
                    console.log(`⚠️ CREATOR RISK EXIT: ${creatorRisk.reason}`);
                    logHoldSummary(`creator risk: ${creatorRisk.reason || "unknown"}`);
                    return { state: s, exitReason: `creator risk: ${creatorRisk.reason || "unknown"}` };
                }
            }

            if (
                CONFIG.HOLD_HARD_STOP_LOSS_EXIT_ENABLED &&
                elapsedBeforeStartMs + (Date.now() - startedAtMs) >= Math.max(0, CONFIG.HOLD_HARD_STOP_LOSS_MIN_HOLD_MS) &&
                Date.now() - lastHardStopLossCheckAtMs >= scaledInterval(CONFIG.HOLD_HARD_STOP_LOSS_CHECK_INTERVAL_MS)
            ) {
                lastHardStopLossCheckAtMs = Date.now();
                const currentExitQuoteSol = getExitQuoteSolFromState(s, tokenMint, tokenOutAtomic);
                if (currentExitQuoteSol !== null && currentExitQuoteSol > 0) {
                    const currentPnlPct = ((currentExitQuoteSol - CONFIG.TRADE_AMOUNT_SOL) / CONFIG.TRADE_AMOUNT_SOL) * 100;
                    const hardStopLossPct = Math.abs(CONFIG.HOLD_HARD_STOP_LOSS_PCT);
                    if (currentPnlPct <= -hardStopLossPct) {
                        // --- Profit floor intercept for armed winners ---
                        // If the trade was previously armed (peak exceeded arm threshold),
                        // exit with profit floor instead of hard stop loss.
                        // This prevents fast crashes from bypassing the profit floor check
                        // which runs later in the winner management block.
                        const peakPnlPctHsl = ((peakExitQuoteSol - CONFIG.TRADE_AMOUNT_SOL) / CONFIG.TRADE_AMOUNT_SOL) * 100;
                        const minPeakSolHsl = Math.max(0, activeWinnerProfile.minPeakSol);
                        if (
                            activeWinnerProfile.enabled &&
                            activeWinnerProfile.profitFloorPct > 0 &&
                            peakExitQuoteSol >= minPeakSolHsl &&
                            peakPnlPctHsl >= activeWinnerProfile.armPnlPct
                        ) {
                            recordTrigger("winnerProfitFloor", true, `peak=${peakExitQuoteSol.toFixed(6)}SOL(${peakPnlPctHsl.toFixed(2)}%) cur=${currentExitQuoteSol.toFixed(6)}SOL(${currentPnlPct.toFixed(2)}%) floor=${activeWinnerProfile.profitFloorPct.toFixed(2)}% [intercepted from hard stop]`);
                            console.log(`⚠️ WINNER PROFIT FLOOR EXIT (intercepted at hard stop): peak ${peakExitQuoteSol.toFixed(6)} SOL (${peakPnlPctHsl.toFixed(2)}%) -> ${currentExitQuoteSol.toFixed(6)} SOL (${currentPnlPct.toFixed(2)}%), floor ${activeWinnerProfile.profitFloorPct.toFixed(2)}%`);
                            logHoldSummary("winner profit floor");
                            return { state: s, exitReason: "winner profit floor" };
                        }
                        recordTrigger(
                            "hardStopLoss",
                            true,
                            `${currentExitQuoteSol.toFixed(6)}SOL(${currentPnlPct.toFixed(2)}%) <= -${hardStopLossPct.toFixed(2)}%`
                        );
                        console.log(
                            `⚠️ HARD STOP LOSS EXIT: ${currentExitQuoteSol.toFixed(6)} SOL (${currentPnlPct.toFixed(2)}%) <= -${hardStopLossPct.toFixed(2)}%`
                        );
                        logHoldSummary("hard stop loss");
                        return { state: s, exitReason: "hard stop loss" };
                    }
                }
            }

            if (
                activeWinnerProfile.enabled &&
                elapsedBeforeStartMs + (Date.now() - startedAtMs) >= Math.max(0, activeWinnerProfile.minHoldMs) &&
                Date.now() - lastWinnerCheckAtMs >= scaledInterval(activeWinnerProfile.checkIntervalMs)
            ) {
                lastWinnerCheckAtMs = Date.now();
                const currentExitQuoteSol = getExitQuoteSolFromState(s, tokenMint, tokenOutAtomic);
                if (currentExitQuoteSol !== null && currentExitQuoteSol > 0) {
                    if (currentExitQuoteSol > peakExitQuoteSol) {
                        peakExitQuoteSol = currentExitQuoteSol;
                        peakAtMs = Date.now();
                    }
                    const currentPnlPct = ((currentExitQuoteSol - CONFIG.TRADE_AMOUNT_SOL) / CONFIG.TRADE_AMOUNT_SOL) * 100;
                    const peakPnlPct = ((peakExitQuoteSol - CONFIG.TRADE_AMOUNT_SOL) / CONFIG.TRADE_AMOUNT_SOL) * 100;
                    const drawdownFromPeakPct =
                        peakExitQuoteSol > 0
                            ? ((peakExitQuoteSol - currentExitQuoteSol) / peakExitQuoteSol) * 100
                            : 0;
                    const minPeakSol = Math.max(0, activeWinnerProfile.minPeakSol);
                    if (
                        activeWinnerProfile.hardTakeProfitPct > 0 &&
                        currentPnlPct >= activeWinnerProfile.hardTakeProfitPct
                    ) {
                        recordTrigger("winnerTakeProfit", true, `${currentExitQuoteSol.toFixed(6)}SOL(${currentPnlPct.toFixed(2)}%)`);
                        console.log(`⚠️ WINNER TAKE PROFIT EXIT: ${currentExitQuoteSol.toFixed(6)} SOL (${currentPnlPct.toFixed(2)}%)`);
                        logHoldSummary("winner take profit");
                        return { state: s, exitReason: "winner take profit" };
                    }
                    if (
                        peakExitQuoteSol >= minPeakSol &&
                        peakPnlPct >= activeWinnerProfile.armPnlPct &&
                        drawdownFromPeakPct >= Math.abs(activeWinnerProfile.trailingDropPct)
                    ) {
                        recordTrigger("winnerTrailing", true, `peak=${peakExitQuoteSol.toFixed(6)}SOL(${peakPnlPct.toFixed(2)}%) cur=${currentExitQuoteSol.toFixed(6)}SOL(${currentPnlPct.toFixed(2)}%) dd=${drawdownFromPeakPct.toFixed(2)}%`);
                        console.log(`⚠️ WINNER TRAILING EXIT: peak ${peakExitQuoteSol.toFixed(6)} SOL (${peakPnlPct.toFixed(2)}%) -> ${currentExitQuoteSol.toFixed(6)} SOL (${currentPnlPct.toFixed(2)}%), drawdown ${drawdownFromPeakPct.toFixed(2)}%`);
                        logHoldSummary("winner trailing stop");
                        return { state: s, exitReason: "winner trailing stop" };
                    }
                    if (
                        activeWinnerProfile.profitFloorPct > 0 &&
                        peakExitQuoteSol >= minPeakSol &&
                        peakPnlPct >= activeWinnerProfile.armPnlPct &&
                        currentPnlPct < activeWinnerProfile.profitFloorPct
                    ) {
                        recordTrigger("winnerProfitFloor", true, `peak=${peakExitQuoteSol.toFixed(6)}SOL(${peakPnlPct.toFixed(2)}%) cur=${currentExitQuoteSol.toFixed(6)}SOL(${currentPnlPct.toFixed(2)}%) floor=${activeWinnerProfile.profitFloorPct.toFixed(2)}%`);
                        console.log(`⚠️ WINNER PROFIT FLOOR EXIT: peak ${peakExitQuoteSol.toFixed(6)} SOL (${peakPnlPct.toFixed(2)}%) -> ${currentExitQuoteSol.toFixed(6)} SOL (${currentPnlPct.toFixed(2)}%), below floor ${activeWinnerProfile.profitFloorPct.toFixed(2)}%`);
                        logHoldSummary("winner profit floor");
                        return { state: s, exitReason: "winner profit floor" };
                    }
                }
            }

            if (
                CONFIG.HOLD_SINGLE_SWAP_SHOCK_EXIT_ENABLED &&
                Date.now() - startedAtMs >= Math.max(0, CONFIG.HOLD_SINGLE_SWAP_SHOCK_MIN_HOLD_MS) &&
                Date.now() - lastSingleSwapShockCheckAtMs >= scaledInterval(CONFIG.HOLD_SINGLE_SWAP_SHOCK_CHECK_INTERVAL_MS)
            ) {
                lastSingleSwapShockCheckAtMs = Date.now();
                const currentExitQuoteSol = getExitQuoteSolFromState(s, tokenMint, tokenOutAtomic);
                if (
                    previousExitQuoteSol !== null &&
                    previousExitQuoteSol > 0 &&
                    currentExitQuoteSol !== null &&
                    Number.isFinite(currentExitQuoteSol)
                ) {
                    const dropPct = ((previousExitQuoteSol - currentExitQuoteSol) / previousExitQuoteSol) * 100;
                    if (dropPct >= Math.abs(CONFIG.HOLD_SINGLE_SWAP_SHOCK_DROP_PCT)) {
                        recordTrigger("singleSwapShock", true, `${previousExitQuoteSol.toFixed(6)}->${currentExitQuoteSol.toFixed(6)} drop=${dropPct.toFixed(2)}%`);
                        console.log(`⚠️ SINGLE SWAP SHOCK EXIT: ${previousExitQuoteSol.toFixed(6)} -> ${currentExitQuoteSol.toFixed(6)} SOL (drop ${dropPct.toFixed(2)}%)`);
                        logHoldSummary("single swap shock");
                        return { state: s, exitReason: "single swap shock" };
                    }
                }
                if (currentExitQuoteSol !== null && Number.isFinite(currentExitQuoteSol) && currentExitQuoteSol > 0) {
                    previousExitQuoteSol = currentExitQuoteSol;
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
                        recordTrigger("sellQuoteCollapse", true, `${baselineExitQuoteSol.toFixed(6)}->${currentExitQuoteSol.toFixed(6)} drop=${dropPct.toFixed(2)}%`);
                        console.log(`⚠️ SELL QUOTE COLLAPSE EXIT: ${baselineExitQuoteSol.toFixed(6)} -> ${currentExitQuoteSol.toFixed(6)} SOL (drop ${dropPct.toFixed(2)}%, floor ${minExitSol.toFixed(6)} SOL)`);
                        logHoldSummary("sell quote collapse");
                        return { state: s, exitReason: "sell quote collapse" };
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
                        const windowMs = criticalTriggered ? CONFIG.HOLD_POOL_CHURN_WINDOW_CRITICAL_MS : CONFIG.HOLD_POOL_CHURN_WINDOW_LONG_MS;
                        const txCount = criticalTriggered ? churn.criticalCount : churn.longCount;
                        recordTrigger("poolChurn", true, `${txCount}tx/${(windowMs/1000).toFixed(0)}s`);
                        console.log(`⚠️ POOL CHURN EXIT: ${txCount} tx in ${(windowMs/1000).toFixed(0)}s (quote ${baselineExitQuoteSol.toFixed(6)}->${currentExitQuoteSol.toFixed(6)})`);
                        logHoldSummary("pool churn");
                        return { state: s, exitReason: "pool churn" };
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
                    recordTrigger("creatorOutbound", true, `${(creatorOutbound.outboundSol||0).toFixed(3)}SOL->${shortSig(creatorOutbound.destination||"-")}`);
                    console.log(`⚠️ CREATOR OUTBOUND EXIT: ${shortSig(creatorOutbound.signature||"-")} (${(creatorOutbound.outboundSol||0).toFixed(3)}SOL->${shortSig(creatorOutbound.destination||"-")})`);
                    logHoldSummary("creator outbound");
                    return { state: s, exitReason: "creator outbound" };
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
                    recordTrigger("creatorCloseAccount", true, `${burst.txCount}tx/${burst.totalCloseCount}closes/${windowSec}s`);
                    console.log(`⚠️ CREATOR CLOSE ACCOUNT BURST EXIT: ${burst.txCount}tx/${burst.totalCloseCount}closes in ${windowSec}s (sig=${shortSig(burst.latestSignature)})`);
                    logHoldSummary("creator close-account burst");
                    return { state: s, exitReason: "creator close-account burst" };
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
                    recordTrigger("creatorOutboundSpray", true, `${spray.transfers}transfers/${spray.destinations}dest/${windowSec}s`);
                    console.log(`⚠️ CREATOR OUTBOUND SPRAY EXIT: ${spray.transfers}transfers->${spray.destinations}dest in ${windowSec}s (median=${spray.medianSol.toFixed(3)}SOL)`);
                    logHoldSummary("creator outbound spray");
                    return { state: s, exitReason: "creator outbound spray" };
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
                    recordTrigger("creatorInboundSpray", true, `${spray.transfers}transfers/${spray.sources}sources/${windowSec}s`);
                    console.log(`⚠️ CREATOR INBOUND SPRAY EXIT: ${spray.transfers}transfers<-${spray.sources}sources in ${windowSec}s (median=${spray.medianSol.toFixed(3)}SOL)`);
                    logHoldSummary("creator inbound spray");
                    return { state: s, exitReason: "creator inbound spray" };
                }
            }
        }

        await new Promise((r) => setTimeout(r, pollIntervalMs));
    }

    recordTrigger("deadline", true, "hold timeout reached");
    logHoldSummary("hold timeout");
    return { state: latestState || await fetchStateWithRetry(), exitReason: "hold timeout" };
}
