import { Connection, PublicKey } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { CreatorRiskCacheEntry, CreatorRiskCheckOptions, CreatorRiskResult, ParsedCreatorRiskTx, RugHistory } from "../../domain/types";
import { stageLog } from "../reporting/stageLog";
import { shortSig } from "../../utils/pubkeys";

type WalkParsedInstructionsResult = {
    solInTransfers: number;
    solOutTransfers: number;
    solInSol: number;
    solOutSol: number;
    inboundSources: string[];
    inboundTransfers: Array<{ source: string; sol: number }>;
    outboundDestinations: string[];
    outboundTransfers: Array<{ destination: string; sol: number }>;
};

type CreatorCashoutRisk = {
    totalSol: number;
    maxSingleSol: number;
    pctOfEntryLiquidity: number;
    score: number;
    destination: string | null;
};

type RelayFundingResult = {
    detected: boolean;
    root: string | null;
    inboundSol: number;
    outboundSol: number;
    windowSec: number | null;
};

type SprayPatternResult = {
    detected: boolean;
    transfers: number;
    destinations: number;
    medianSol: number;
    relStdDev: number;
    amountRatio: number;
};

type InboundSprayPatternResult = {
    detected: boolean;
    transfers: number;
    sources: number;
    medianSol: number;
    relStdDev: number;
    amountRatio: number;
};

type ConcentratedInboundFundingResult = {
    detected: boolean;
    transfers: number;
    sources: number;
    topSources: number;
    medianSol: number;
    totalSol: number;
    relStdDev: number;
    amountRatio: number;
    topSourceShare: number;
    windowSec: number | null;
};

type RepeatCreateRemovePatternResult = {
    detected: boolean;
    creates: number;
    removes: number;
    cashouts: number;
    windowSec: number | null;
    maxCashoutSol: number;
};

type PrecreateBurstResult = {
    detected: boolean;
    transfers: number;
    destinations: number;
    medianSol: number;
    totalSol: number;
    relStdDev: number;
    amountRatio: number;
    windowSec?: number | null;
};

type SetupBurstResult = {
    detected: boolean;
    creates: number;
    lookupTables: number;
    windowSec: number | null;
};

type PrecreateLargeUniformBurstResult = {
    detected: boolean;
    transfers: number;
    destinations: number;
    medianSol: number;
    totalSol: number;
    relStdDev: number;
    amountRatio: number;
    windowSec: number | null;
};

type PrecreateDispersalSetupResult = {
    detected: boolean;
    transfers: number;
    destinations: number;
    medianSol: number;
    totalSol: number;
    windowSec: number | null;
};

type FreshFundedHighSeedResult = {
    strictFlowRequired: boolean;
    blockDetected: boolean;
    fundingSol: number;
    fundingAgeSec: number | null;
};

type CloseAccountBurstResult = {
    detected: boolean;
    txs: number;
    closes: number;
    windowSec: number | null;
};

type RapidDispersalResult = {
    detected: boolean;
    transfers: number;
    destinations: number;
    totalSol: number;
    windowSec: number | null;
};

type DirectAmmReentryResult = {
    detected: boolean;
    signature: string | null;
    blockTime: number | null;
};

type CreatorRiskDeps = {
    monitorOnly: boolean;
    pumpfunAmmProgramId: string;
    buildRugHistory: (connection: Connection) => Promise<RugHistory>;
    fetchParsedTransactionsForSignatures: (
        connection: Connection,
        signatures: Array<{ signature: string; blockTime?: number | null }>
    ) => Promise<Array<{ signature: string; blockTime: number | null; tx: any }>>;
    walkParsedInstructions: (
        instructions: any[] | undefined,
        creatorAddress: string,
        counterparties: Set<string>,
        linksToCreators: Set<string>,
        rugCreators: Set<string>,
    ) => WalkParsedInstructionsResult;
    classifyRecentCreateRemovePattern: (
        parsedCreatorRiskTxs: ParsedCreatorRiskTx[],
        creatorAddress: string,
        options: { currentCreatePoolSignature?: string; currentCreatePoolBlockTime?: number | null },
    ) => RepeatCreateRemovePatternResult;
    detectCreatorDirectAmmReentry: (
        connection: Connection,
        creatorAddress: string,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
        prefetchedCreatorRiskTxs?: ParsedCreatorRiskTx[],
    ) => Promise<DirectAmmReentryResult>;
    classifySprayOutboundPattern: (outboundTransfers: Array<{ destination: string; sol: number }>) => SprayPatternResult;
    classifyInboundSprayPattern: (inboundTransfers: Array<{ source: string; sol: number }>) => InboundSprayPatternResult;
    classifyCreatorCashoutRisk: (
        connection: Connection,
        creatorAddress: string,
        funder: string | null,
        outboundTransfers: Array<{ destination: string; sol: number }>,
        entrySolLiquidity?: number,
        excludedDestinations?: Set<string>,
    ) => Promise<CreatorCashoutRisk>;
    collectPrecreateCreatorRiskTxs: (
        connection: Connection,
        creatorAddress: string,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
        prefetchedCreatorRiskTxs?: ParsedCreatorRiskTx[],
    ) => Promise<ParsedCreatorRiskTx[]>;
    collectPrecreateOutboundTransfers: (
        connection: Connection,
        creatorAddress: string,
        createPoolSignature?: string,
        createPoolBlockTime?: number | null,
        prefetchedCreatorRiskTxs?: ParsedCreatorRiskTx[],
    ) => Promise<Array<{ destination: string; sol: number }>>;
    classifyRecentRelayFunding: (
        connection: Connection,
        creatorAddress: string,
        funder: string | null,
    ) => Promise<RelayFundingResult>;
    classifyPrecreateOutboundBurst: (
        outboundTransfers: Array<{ destination: string; sol: number }>
    ) => PrecreateBurstResult;
    isStandardRelayRiskPool: (entrySolLiquidity?: number) => boolean;
    isSuspiciousRelayRoot: (root: string, rugHistory: RugHistory) => boolean;
    trackRecentFunderCreator: (funder: string, creatorAddress: string) => number;
    withTimeout: <T>(promise: Promise<T>, timeoutMs: number) => Promise<{ timedOut: boolean; value?: T }>;
    isRateLimitedMessage: (message?: string) => boolean;
};

function flattenParsedInstructions(tx: any): any[] {
    const outer = tx?.transaction?.message?.instructions || [];
    const inner = (tx?.meta?.innerInstructions || []).flatMap((entry: any) => entry?.instructions || []);
    return [...outer, ...inner];
}

function getInstructionType(ix: any): string {
    return String(ix?.parsed?.type || "").toLowerCase();
}

function getFeePayer(tx: any): string | null {
    const first = tx?.transaction?.message?.accountKeys?.[0];
    return first?.pubkey?.toBase58?.() || first?.pubkey || first?.toBase58?.() || first || null;
}

function classifySetupBurst(parsedCreatorRiskTxs: ParsedCreatorRiskTx[], creatorAddress: string): SetupBurstResult {
    const setupEvents = parsedCreatorRiskTxs
        .filter(({ tx }) => getFeePayer(tx) === creatorAddress)
        .map(({ blockTime, tx }) => ({
            blockTime: blockTime ?? tx?.blockTime ?? null,
            creates: flattenParsedInstructions(tx).reduce((count, ix) => {
                const type = getInstructionType(ix);
                return type === "create" || type === "mintto" ? count + 1 : count;
            }, 0),
            lookupTables: flattenParsedInstructions(tx).reduce((count, ix) => {
                const type = getInstructionType(ix);
                return type === "createlookuptable" ? count + 1 : count;
            }, 0),
        }))
        .filter((event) => (event.creates > 0 || event.lookupTables > 0) && Number.isFinite(event.blockTime));

    if (!setupEvents.length) {
        return { detected: false, creates: 0, lookupTables: 0, windowSec: null };
    }

    const creates = setupEvents.reduce((sum, event) => sum + event.creates, 0);
    const lookupTables = setupEvents.reduce((sum, event) => sum + event.lookupTables, 0);
    const times = setupEvents.map((event) => Number(event.blockTime));
    const windowSec = Math.max(0, Math.max(...times) - Math.min(...times));
    return {
        detected:
            CONFIG.CREATOR_RISK_SETUP_BURST_BLOCK_ENABLED &&
            creates >= CONFIG.CREATOR_RISK_SETUP_BURST_MIN_CREATES &&
            windowSec <= CONFIG.CREATOR_RISK_SETUP_BURST_MAX_WINDOW_SEC,
        creates,
        lookupTables,
        windowSec,
    };
}

function mergeParsedCreatorRiskTxs(
    baseEntries: ParsedCreatorRiskTx[],
    extraEntries: ParsedCreatorRiskTx[],
): ParsedCreatorRiskTx[] {
    const bySig = new Map<string, ParsedCreatorRiskTx>();
    for (const entry of [...baseEntries, ...extraEntries]) {
        bySig.set(entry.signature, entry);
    }
    return [...bySig.values()].sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0));
}

function extractOutboundTransfersFromParsedCreatorRiskTxs(
    parsedCreatorRiskTxs: ParsedCreatorRiskTx[],
    creatorAddress: string,
): Array<{ destination: string; sol: number; blockTime: number }> {
    return parsedCreatorRiskTxs
        .filter(({ tx }) => getFeePayer(tx) === creatorAddress)
        .flatMap(({ blockTime, tx }) => {
            const eventTime = blockTime ?? tx?.blockTime ?? null;
            return flattenParsedInstructions(tx)
                .map((ix) => {
                    const parsed = ix?.parsed;
                    const type = getInstructionType(ix);
                    if (ix?.program !== "system" || type !== "transfer") return null;
                    const info = parsed?.info || {};
                    const source = info.source || info.from || null;
                    const destination = info.destination || info.to || null;
                    const lamports = Number(info.lamports || 0);
                    if (
                        source !== creatorAddress ||
                        !destination ||
                        !Number.isFinite(eventTime) ||
                        !Number.isFinite(lamports) ||
                        lamports <= 0
                    ) {
                        return null;
                    }
                    return {
                        destination,
                        sol: lamports / 1e9,
                        blockTime: Number(eventTime),
                    };
                })
                .filter((entry): entry is { destination: string; sol: number; blockTime: number } => !!entry);
        });
}

function extractInboundTransfersFromParsedCreatorRiskTxs(
    parsedCreatorRiskTxs: ParsedCreatorRiskTx[],
    creatorAddress: string,
): Array<{ source: string; sol: number; blockTime: number }> {
    return parsedCreatorRiskTxs.flatMap(({ blockTime, tx }) => {
        const eventTime = blockTime ?? tx?.blockTime ?? null;
        return flattenParsedInstructions(tx)
            .map((ix) => {
                const parsed = ix?.parsed;
                const type = getInstructionType(ix);
                if (ix?.program !== "system" || type !== "transfer") return null;
                const info = parsed?.info || {};
                const source = info.source || info.from || null;
                const destination = info.destination || info.to || null;
                const lamports = Number(info.lamports || 0);
                if (
                    !source ||
                    destination !== creatorAddress ||
                    !Number.isFinite(eventTime) ||
                    !Number.isFinite(lamports) ||
                    lamports <= 0
                ) {
                    return null;
                }
                return {
                    source,
                    sol: lamports / 1e9,
                    blockTime: Number(eventTime),
                };
            })
            .filter((entry): entry is { source: string; sol: number; blockTime: number } => !!entry);
    });
}

function classifyConcentratedInboundFunding(
    parsedCreatorRiskTxs: ParsedCreatorRiskTx[],
    creatorAddress: string,
): ConcentratedInboundFundingResult {
    const positive = extractInboundTransfersFromParsedCreatorRiskTxs(parsedCreatorRiskTxs, creatorAddress).filter(
        (t) => Number.isFinite(t.sol) && t.sol >= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MIN_TRANSFER_SOL
    );
    if (!positive.length) {
        return {
            detected: false,
            transfers: 0,
            sources: 0,
            topSources: 0,
            medianSol: 0,
            totalSol: 0,
            relStdDev: Infinity,
            amountRatio: Infinity,
            topSourceShare: 0,
            windowSec: null,
        };
    }

    const values = positive.map((t) => t.sol).sort((a, b) => a - b);
    const totalSol = values.reduce((sum, v) => sum + v, 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const relStdDev = mean > 0 ? stdDev / mean : Infinity;
    const medianSol =
        values.length % 2 === 0
            ? (values[(values.length / 2) - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];
    const amountRatio = values[0] > 0 ? values[values.length - 1] / values[0] : Infinity;

    const sourceCounts = new Map<string, number>();
    for (const transfer of positive) {
        sourceCounts.set(transfer.source, (sourceCounts.get(transfer.source) || 0) + 1);
    }
    const sortedCounts = [...sourceCounts.values()].sort((a, b) => b - a);
    const topSources = Math.min(CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_TOP_SOURCE_COUNT, sortedCounts.length);
    const topSourceTransfers = sortedCounts.slice(0, topSources).reduce((sum, count) => sum + count, 0);
    const topSourceShare = positive.length > 0 ? topSourceTransfers / positive.length : 0;

    const times = positive.map((t) => t.blockTime);
    const windowSec = Math.max(0, Math.max(...times) - Math.min(...times));
    const sources = sourceCounts.size;
    const transfers = positive.length;

    return {
        detected:
            CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_BLOCK_ENABLED &&
            transfers >= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MIN_TRANSFERS &&
            sources <= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MAX_SOURCES &&
            topSourceShare >= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MIN_TOP_SOURCE_SHARE &&
            totalSol >= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MIN_TOTAL_SOL &&
            medianSol >= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MIN_MEDIAN_SOL &&
            medianSol <= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MAX_MEDIAN_SOL &&
            relStdDev <= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MAX_REL_STDDEV &&
            amountRatio <= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MAX_AMOUNT_RATIO &&
            windowSec <= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MAX_WINDOW_SEC,
        transfers,
        sources,
        topSources,
        medianSol,
        totalSol,
        relStdDev,
        amountRatio,
        topSourceShare,
        windowSec,
    };
}

function classifyPrecreateLargeUniformBurst(
    parsedCreatorRiskTxs: ParsedCreatorRiskTx[],
    creatorAddress: string,
): PrecreateLargeUniformBurstResult {
    const positive = extractOutboundTransfersFromParsedCreatorRiskTxs(parsedCreatorRiskTxs, creatorAddress).filter(
        (t) => Number.isFinite(t.sol) && t.sol >= CONFIG.CREATOR_RISK_PRECREATE_LARGE_UNIFORM_MIN_TRANSFER_SOL
    );
    if (!positive.length) {
        return {
            detected: false,
            transfers: 0,
            destinations: 0,
            medianSol: 0,
            totalSol: 0,
            relStdDev: Infinity,
            amountRatio: Infinity,
            windowSec: null,
        };
    }

    const values = positive.map((t) => t.sol).sort((a, b) => a - b);
    const destinations = new Set(positive.map((t) => t.destination)).size;
    const totalSol = values.reduce((sum, v) => sum + v, 0);
    const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(Math.max(0, variance));
    const relStdDev = mean > 0 ? stdDev / mean : Infinity;
    const medianSol =
        values.length % 2 === 0
            ? (values[(values.length / 2) - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];
    const amountRatio = values[0] > 0 ? values[values.length - 1] / values[0] : Infinity;
    const times = positive.map((t) => t.blockTime);
    const windowSec = Math.max(0, Math.max(...times) - Math.min(...times));

    const transfers = positive.length;

    return {
        detected:
            CONFIG.CREATOR_RISK_PRECREATE_LARGE_UNIFORM_BLOCK_ENABLED &&
            transfers >= CONFIG.CREATOR_RISK_PRECREATE_LARGE_UNIFORM_MIN_TRANSFERS &&
            destinations >= CONFIG.CREATOR_RISK_PRECREATE_LARGE_UNIFORM_MIN_DESTINATIONS &&
            totalSol >= CONFIG.CREATOR_RISK_PRECREATE_LARGE_UNIFORM_MIN_TOTAL_SOL &&
            relStdDev <= CONFIG.CREATOR_RISK_PRECREATE_LARGE_UNIFORM_MAX_REL_STDDEV &&
            amountRatio <= CONFIG.CREATOR_RISK_PRECREATE_LARGE_UNIFORM_MAX_AMOUNT_RATIO &&
            windowSec <= CONFIG.CREATOR_RISK_PRECREATE_LARGE_UNIFORM_MAX_WINDOW_SEC,
        transfers: positive.length,
        destinations,
        medianSol,
        totalSol,
        relStdDev,
        amountRatio,
        windowSec,
    };
}

function classifyPrecreateDispersalSetupPattern(
    parsedCreatorRiskTxs: ParsedCreatorRiskTx[],
    creatorAddress: string,
    setupBurst: SetupBurstResult,
): PrecreateDispersalSetupResult {
    const positive = extractOutboundTransfersFromParsedCreatorRiskTxs(parsedCreatorRiskTxs, creatorAddress).filter(
        (t) => Number.isFinite(t.sol) && t.sol >= CONFIG.CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_MIN_TRANSFER_SOL
    );
    if (!positive.length) {
        return {
            detected: false,
            transfers: 0,
            destinations: 0,
            medianSol: 0,
            totalSol: 0,
            windowSec: null,
        };
    }

    const values = positive.map((t) => t.sol).sort((a, b) => a - b);
    const transfers = positive.length;
    const destinations = new Set(positive.map((t) => t.destination)).size;
    const totalSol = values.reduce((sum, v) => sum + v, 0);
    const medianSol =
        values.length % 2 === 0
            ? (values[(values.length / 2) - 1] + values[values.length / 2]) / 2
            : values[Math.floor(values.length / 2)];
    const times = positive.map((t) => t.blockTime);
    const windowSec = Math.max(0, Math.max(...times) - Math.min(...times));

    return {
        detected:
            CONFIG.CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_BLOCK_ENABLED &&
            transfers >= CONFIG.CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_MIN_TRANSFERS &&
            destinations >= CONFIG.CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_MIN_DESTINATIONS &&
            totalSol >= CONFIG.CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_MIN_TOTAL_SOL &&
            medianSol >= CONFIG.CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_MIN_MEDIAN_SOL &&
            windowSec <= CONFIG.CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_MAX_WINDOW_SEC &&
            setupBurst.creates >= CONFIG.CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_MIN_SETUP_CREATES &&
            setupBurst.windowSec !== null &&
            setupBurst.windowSec <= CONFIG.CREATOR_RISK_PRECREATE_DISPERSAL_SETUP_MAX_SETUP_WINDOW_SEC,
        transfers,
        destinations,
        medianSol,
        totalSol,
        windowSec,
    };
}

function classifyFreshFundedHighSeed(
    parsedCreatorRiskTxs: ParsedCreatorRiskTx[],
    creatorAddress: string,
    createPoolBlockTime: number | null | undefined,
    creatorSeedSol: number,
    creatorSeedPctOfCurrentLiq: number,
    uniqueCounterparties: number,
): FreshFundedHighSeedResult {
    const createTime = Number.isFinite(createPoolBlockTime) ? Number(createPoolBlockTime) : null;
    if (!createTime) {
        return { strictFlowRequired: false, blockDetected: false, fundingSol: 0, fundingAgeSec: null };
    }

    const inbound = extractInboundTransfersFromParsedCreatorRiskTxs(parsedCreatorRiskTxs, creatorAddress)
        .filter((transfer) => transfer.blockTime <= createTime)
        .sort((a, b) => b.blockTime - a.blockTime || b.sol - a.sol);

    const latestFunding = inbound.find(
        (transfer) =>
            transfer.sol >= CONFIG.CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_MIN_FUNDING_SOL
    );
    if (!latestFunding) {
        return { strictFlowRequired: false, blockDetected: false, fundingSol: 0, fundingAgeSec: null };
    }

    const fundingAgeSec = Math.max(0, createTime - latestFunding.blockTime);
    const strictFlowRequired =
        CONFIG.CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_STRICT_FLOW_ENABLED &&
        latestFunding.sol >= CONFIG.CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_MIN_FUNDING_SOL &&
        fundingAgeSec <= CONFIG.CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_MAX_FUNDING_AGE_SEC &&
        creatorSeedSol >= CONFIG.CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_MIN_SEED_SOL;
    const blockDetected =
        CONFIG.CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_BLOCK_ENABLED &&
        strictFlowRequired &&
        creatorSeedPctOfCurrentLiq >= CONFIG.CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_MIN_SEED_PCT_OF_LIQ &&
        uniqueCounterparties <= CONFIG.CREATOR_RISK_FRESH_FUNDED_HIGH_SEED_MAX_COUNTERPARTIES;

    return {
        strictFlowRequired,
        blockDetected,
        fundingSol: latestFunding.sol,
        fundingAgeSec,
    };
}

function classifyCloseAccountBurst(parsedCreatorRiskTxs: ParsedCreatorRiskTx[], creatorAddress: string): CloseAccountBurstResult {
    const closeEvents = parsedCreatorRiskTxs
        .filter(({ tx }) => getFeePayer(tx) === creatorAddress)
        .map(({ blockTime, tx }) => ({
            blockTime: blockTime ?? tx?.blockTime ?? null,
            closes: flattenParsedInstructions(tx).reduce((count, ix) => {
                const type = getInstructionType(ix);
                return type === "closeaccount" || type === "close_account" ? count + 1 : count;
            }, 0),
        }))
        .filter((event) => event.closes > 0 && Number.isFinite(event.blockTime));

    if (!closeEvents.length) {
        return { detected: false, txs: 0, closes: 0, windowSec: null };
    }

    const txs = closeEvents.length;
    const closes = closeEvents.reduce((sum, event) => sum + event.closes, 0);
    const times = closeEvents.map((event) => Number(event.blockTime));
    const windowSec = Math.max(0, Math.max(...times) - Math.min(...times));
    return {
        detected:
            CONFIG.CREATOR_RISK_CLOSE_ACCOUNT_BURST_BLOCK_ENABLED &&
            txs >= CONFIG.CREATOR_RISK_CLOSE_ACCOUNT_BURST_MIN_TXS &&
            closes >= CONFIG.CREATOR_RISK_CLOSE_ACCOUNT_BURST_MIN_CLOSES &&
            windowSec <= CONFIG.CREATOR_RISK_CLOSE_ACCOUNT_BURST_MAX_WINDOW_SEC,
        txs,
        closes,
        windowSec,
    };
}

function classifyRapidDispersal(parsedCreatorRiskTxs: ParsedCreatorRiskTx[], creatorAddress: string): RapidDispersalResult {
    const events = parsedCreatorRiskTxs
        .filter(({ tx }) => getFeePayer(tx) === creatorAddress)
        .flatMap(({ blockTime, tx }) => {
            const eventTime = blockTime ?? tx?.blockTime ?? null;
            return flattenParsedInstructions(tx)
                .map((ix) => {
                    const parsed = ix?.parsed;
                    const type = getInstructionType(ix);
                    if (ix?.program !== "system" || type !== "transfer") return null;
                    const info = parsed?.info || {};
                    const source = info.source || info.from || null;
                    const destination = info.destination || info.to || null;
                    const lamports = Number(info.lamports || 0);
                    if (
                        source !== creatorAddress ||
                        !destination ||
                        !Number.isFinite(eventTime) ||
                        !Number.isFinite(lamports) ||
                        lamports <= 0
                    ) {
                        return null;
                    }
                    return {
                        destination,
                        sol: lamports / 1e9,
                        blockTime: Number(eventTime),
                    };
                })
                .filter((entry): entry is { destination: string; sol: number; blockTime: number } => !!entry);
        });

    if (!events.length) {
        return { detected: false, transfers: 0, destinations: 0, totalSol: 0, windowSec: null };
    }

    const transfers = events.length;
    const destinations = new Set(events.map((entry) => entry.destination)).size;
    const totalSol = events.reduce((sum, entry) => sum + entry.sol, 0);
    const times = events.map((entry) => entry.blockTime);
    const windowSec = Math.max(0, Math.max(...times) - Math.min(...times));
    return {
        detected:
            CONFIG.CREATOR_RISK_RAPID_DISPERSAL_BLOCK_ENABLED &&
            transfers >= CONFIG.CREATOR_RISK_RAPID_DISPERSAL_MIN_TRANSFERS &&
            destinations >= CONFIG.CREATOR_RISK_RAPID_DISPERSAL_MIN_DESTINATIONS &&
            totalSol >= CONFIG.CREATOR_RISK_RAPID_DISPERSAL_MIN_TOTAL_SOL &&
            windowSec <= CONFIG.CREATOR_RISK_RAPID_DISPERSAL_MAX_WINDOW_SEC,
        transfers,
        destinations,
        totalSol,
        windowSec,
    };
}

export function createCreatorRiskService(deps: CreatorRiskDeps) {
    const creatorRiskCache = new Map<string, CreatorRiskCacheEntry>();

    function isProbationBypassForbidden(result?: CreatorRiskResult): boolean {
        const normalized = (result?.reason || "").toLowerCase();
        const creatorCashoutSol = Number(result?.creatorCashoutSol || 0);
        const creatorCashoutPct = Number(result?.creatorCashoutPctOfEntryLiquidity || 0);
        const creatorCashoutScore = Number(result?.creatorCashoutScore || 0);
        const uniqueCounterparties = Number(result?.uniqueCounterparties || 0);
        const solInTransfers = Number(result?.solInTransfers || 0);
        const solOutTransfers = Number(result?.solOutTransfers || 0);
        if (
            normalized.includes("creator in historical rug blacklist") ||
            normalized.includes("funder blacklisted") ||
            normalized.includes("fresh-funded high-seed creator") ||
            normalized.includes("relay funding recent on standard pool") ||
            normalized.includes("relay funding recent + micro burst") ||
            normalized.includes("standard pool outbound-heavy creator history") ||
            normalized.includes("concentrated inbound funding") ||
            normalized.includes("micro inbound burst") ||
            normalized.includes("lookup-table + setup burst") ||
            normalized.includes("setup burst") ||
            normalized.includes("close-account burst") ||
            normalized.includes("creator direct amm re-entry") ||
            normalized.includes("creator repeated create-remove pattern") ||
            normalized.includes("creator seed too small") ||
            normalized.includes("429 too many requests") ||
            normalized.includes("rate limited")
        ) {
            return true;
        }

        if (
            CONFIG.PAPER_CREATOR_RISK_EXTREME_CASHOUT_BLOCK_ENABLED &&
            creatorCashoutPct >= CONFIG.PAPER_CREATOR_RISK_EXTREME_CASHOUT_MIN_PCT_OF_LIQ &&
            creatorCashoutScore >= CONFIG.PAPER_CREATOR_RISK_EXTREME_CASHOUT_MIN_SCORE
        ) {
            return true;
        }

        if (
            CONFIG.PAPER_CREATOR_RISK_EXTREME_PROBATION_CASHOUT_BLOCK_ENABLED &&
            creatorCashoutSol >= CONFIG.PAPER_CREATOR_RISK_EXTREME_PROBATION_CASHOUT_MIN_SOL &&
            creatorCashoutPct >= CONFIG.PAPER_CREATOR_RISK_EXTREME_PROBATION_CASHOUT_MIN_PCT_OF_LIQ &&
            creatorCashoutScore >= CONFIG.PAPER_CREATOR_RISK_EXTREME_PROBATION_CASHOUT_MIN_SCORE
        ) {
            return true;
        }

        if (
            CONFIG.PAPER_CREATOR_RISK_EXTREME_HISTORY_BLOCK_ENABLED &&
            uniqueCounterparties >= CONFIG.PAPER_CREATOR_RISK_EXTREME_HISTORY_MIN_COUNTERPARTIES &&
            solOutTransfers >= CONFIG.PAPER_CREATOR_RISK_EXTREME_HISTORY_MIN_OUT_TRANSFERS &&
            solInTransfers <= CONFIG.PAPER_CREATOR_RISK_EXTREME_HISTORY_MAX_IN_TRANSFERS
        ) {
            return true;
        }

        if (
            CONFIG.PAPER_CREATOR_RISK_EXTREME_UNIQUE_COUNTERPARTIES_BLOCK_ENABLED &&
            uniqueCounterparties >= CONFIG.PAPER_CREATOR_RISK_EXTREME_UNIQUE_COUNTERPARTIES_MIN &&
            solOutTransfers >= CONFIG.PAPER_CREATOR_RISK_EXTREME_UNIQUE_COUNTERPARTIES_MIN_OUT_TRANSFERS &&
            solInTransfers <= CONFIG.PAPER_CREATOR_RISK_EXTREME_UNIQUE_COUNTERPARTIES_MAX_IN_TRANSFERS
        ) {
            return true;
        }

        if (
            CONFIG.PAPER_CREATOR_RISK_PROBATION_UNIQUE_COUNTERPARTIES_BLOCK_ENABLED &&
            uniqueCounterparties >= CONFIG.PAPER_CREATOR_RISK_PROBATION_UNIQUE_COUNTERPARTIES_MIN &&
            solOutTransfers >= CONFIG.PAPER_CREATOR_RISK_PROBATION_UNIQUE_COUNTERPARTIES_MIN_OUT_TRANSFERS &&
            solInTransfers <= CONFIG.PAPER_CREATOR_RISK_PROBATION_UNIQUE_COUNTERPARTIES_MAX_IN_TRANSFERS
        ) {
            return true;
        }

        if (
            CONFIG.PAPER_CREATOR_RISK_PROBATION_LOW_CASHOUT_BLOCK_ENABLED &&
            creatorCashoutSol >= CONFIG.PAPER_CREATOR_RISK_PROBATION_LOW_CASHOUT_MIN_SOL &&
            creatorCashoutPct >= CONFIG.PAPER_CREATOR_RISK_PROBATION_LOW_CASHOUT_MIN_PCT_OF_LIQ &&
            creatorCashoutScore >= CONFIG.PAPER_CREATOR_RISK_PROBATION_LOW_CASHOUT_MIN_SCORE
        ) {
            return true;
        }

        return false;
    }

    function getProbationHoldMs(reason?: string): number {
        const normalized = (reason || "").toLowerCase();
        if (normalized.includes("creator cashout")) {
            return Math.max(1000, CONFIG.PAPER_CREATOR_CASHOUT_PROBATION_HOLD_MS);
        }
        return Math.max(1000, CONFIG.PAPER_CREATOR_RISK_PROBATION_HOLD_MS);
    }

    function shouldEscalateProbationCreatorRisk(
        creatorRisk: CreatorRiskResult,
        baselineCreatorCashoutSol = 0,
    ): { escalate: boolean; cashoutDeltaSol: number } {
        const reason = (creatorRisk.reason || "").toLowerCase();
        const cashoutDeltaSol = Math.max(
            0,
            Number(creatorRisk.creatorCashoutSol || 0) - Math.max(0, baselineCreatorCashoutSol)
        );
        const hardReason =
            isProbationBypassForbidden(creatorRisk) ||
            reason.includes("lookup-table + setup burst") ||
            reason.includes("setup burst") ||
            reason.includes("close-account burst") ||
            reason.includes("creator direct amm re-entry") ||
            reason.includes("spray outbound") ||
            reason.includes("concentrated inbound funding") ||
            reason.includes("micro inbound burst") ||
            reason.includes("relay funding recent + micro burst");

        return {
            escalate: hardReason || cashoutDeltaSol >= CONFIG.HOLD_PROBATION_CASHOUT_DELTA_MIN_SOL,
            cashoutDeltaSol,
        };
    }

    async function runCheck(
        connection: Connection,
        creatorAddress: string,
        ctx: string,
        options: CreatorRiskCheckOptions = {},
    ): Promise<CreatorRiskResult> {
        if (!CONFIG.CREATOR_RISK_CHECK_ENABLED) {
            stageLog(ctx, "CRISK", "check disabled");
            return { ok: true };
        }

        const cached = creatorRiskCache.get(creatorAddress);
        if (!options.forceRefresh && cached && Date.now() - cached.checkedAtMs < CONFIG.CREATOR_RISK_CACHE_TTL_MS) {
            return cached.result;
        }

        try {
            const startedAtMs = Date.now();
            const fmtMs = (value: number) => `${Math.max(0, Math.round(value))}ms`;
            const rugHistory = await deps.buildRugHistory(connection);
            const rugHistoryDoneAtMs = Date.now();
            const previousResult = options.previousResult || cached?.result;

            if (rugHistory.rugCreators.has(creatorAddress)) {
                const result = {
                    ok: false,
                    reason: "creator in historical rug blacklist",
                    deepChecksComplete: true,
                    latestObservedSignature: previousResult?.latestObservedSignature || null,
                    latestObservedBlockTime: previousResult?.latestObservedBlockTime || null,
                };
                creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
                return result;
            }

            const sigLimit = Math.max(5, CONFIG.CREATOR_RISK_SIG_LIMIT);
            const parseLimit = Math.max(3, CONFIG.CREATOR_RISK_PARSED_TX_LIMIT);
            const sigs = await connection.getSignaturesForAddress(new PublicKey(creatorAddress), { limit: sigLimit }, "confirmed");
            const latestObservedSignature = sigs[0]?.signature || null;
            const latestObservedBlockTime = sigs[0]?.blockTime ?? null;
            if (
                options.allowReuseIfNoNewActivity &&
                previousResult?.latestObservedSignature &&
                previousResult.latestObservedSignature === latestObservedSignature
            ) {
                stageLog(ctx, "CRISK", `reused cached result (no new creator tx, latest=${shortSig(latestObservedSignature || "-")})`);
                return {
                    ...previousResult,
                    latestObservedSignature,
                    latestObservedBlockTime,
                };
            }

            const chronological = [...sigs].reverse();
            const sample = chronological.slice(-parseLimit);

            let solInTransfers = 0;
            let solOutTransfers = 0;
            let solInSol = 0;
            let solOutSol = 0;
            let funder: string | null = null;
            let funderRefundSol = 0;
            const counterparties = new Set<string>();
            const linksToCreators = new Set<string>();
            const outboundTransfers: Array<{ destination: string; sol: number }> = [];
            const inboundTransfers: Array<{ source: string; sol: number }> = [];
            const createPoolOutboundDestinations = new Set<string>();
            const parsedCreatorRiskTxs: ParsedCreatorRiskTx[] = [];
            const parsedCreatorRiskTxSignatures = new Set<string>();

            const sampleSignatures = new Set(sample.map((s) => s.signature));
            const ingestParsedTx = (
                tx: any,
                ingestOptions: { recordCreatePoolDestinations?: boolean; signature?: string; blockTime?: number | null } = {},
            ) => {
                const outer = deps.walkParsedInstructions(
                    tx.transaction?.message?.instructions,
                    creatorAddress,
                    counterparties,
                    linksToCreators,
                    rugHistory.rugCreators,
                );
                const innerParts = (tx.meta?.innerInstructions || []).map((inner: any) =>
                    deps.walkParsedInstructions(inner.instructions, creatorAddress, counterparties, linksToCreators, rugHistory.rugCreators)
                );

                solInTransfers += outer.solInTransfers;
                solOutTransfers += outer.solOutTransfers;
                solInSol += outer.solInSol;
                solOutSol += outer.solOutSol;
                inboundTransfers.push(...outer.inboundTransfers);

                for (const inner of innerParts) {
                    solInTransfers += inner.solInTransfers;
                    solOutTransfers += inner.solOutTransfers;
                    solInSol += inner.solInSol;
                    solOutSol += inner.solOutSol;
                    inboundTransfers.push(...inner.inboundTransfers);
                    outboundTransfers.push(...inner.outboundTransfers);
                }
                outboundTransfers.push(...outer.outboundTransfers);

                if (ingestOptions.signature && !parsedCreatorRiskTxSignatures.has(ingestOptions.signature)) {
                    parsedCreatorRiskTxSignatures.add(ingestOptions.signature);
                    parsedCreatorRiskTxs.push({
                        signature: ingestOptions.signature,
                        blockTime: ingestOptions.blockTime ?? tx.blockTime ?? null,
                        tx,
                    });
                }

                if (ingestOptions.recordCreatePoolDestinations) {
                    for (const dest of outer.outboundDestinations) {
                        if (dest && dest !== creatorAddress) createPoolOutboundDestinations.add(dest);
                    }
                    for (const inner of innerParts) {
                        for (const dest of inner.outboundDestinations) {
                            if (dest && dest !== creatorAddress) createPoolOutboundDestinations.add(dest);
                        }
                    }
                }

                if (!funder) {
                    funder = outer.inboundSources[0] || innerParts.flatMap((p: WalkParsedInstructionsResult) => p.inboundSources)[0] || null;
                }

                if (funder) {
                    const outerRefunds = outer.outboundDestinations.filter((d) => d === funder).length > 0 ? outer.solOutSol : 0;
                    const innerRefunds = innerParts
                        .filter((p: WalkParsedInstructionsResult) => p.outboundDestinations.filter((d: string) => d === funder).length > 0)
                        .reduce((sum: number, p: WalkParsedInstructionsResult) => sum + p.solOutSol, 0);
                    funderRefundSol += outerRefunds + innerRefunds;
                }
            };

            const parsedSampleTxs = await deps.fetchParsedTransactionsForSignatures(connection, sample);
            for (const parsed of parsedSampleTxs) {
                ingestParsedTx(parsed.tx, {
                    recordCreatePoolDestinations: parsed.signature === options.createPoolSignature,
                    signature: parsed.signature,
                    blockTime: parsed.blockTime ?? null,
                });
            }

            if (options.createPoolSignature && !sampleSignatures.has(options.createPoolSignature)) {
                try {
                    const createTx = (await deps.fetchParsedTransactionsForSignatures(connection, [{
                        signature: options.createPoolSignature,
                        blockTime: options.createPoolBlockTime ?? null,
                    }]))[0];
                    if (createTx) {
                        ingestParsedTx(createTx.tx, {
                            recordCreatePoolDestinations: true,
                            signature: options.createPoolSignature,
                            blockTime: options.createPoolBlockTime ?? createTx.blockTime ?? null,
                        });
                    }
                } catch {
                    // fail-open
                }
            }

            const historyParsedAtMs = Date.now();
            const uniqueCounterparties = counterparties.size;
            const firstSigTime = sample[0]?.blockTime || null;
            const lastSigTime = sample[sample.length - 1]?.blockTime || null;
            const augmentedFirstSigTime =
                options.createPoolBlockTime && firstSigTime
                    ? Math.min(firstSigTime, options.createPoolBlockTime)
                    : (firstSigTime ?? options.createPoolBlockTime ?? null);
            const augmentedLastSigTime =
                options.createPoolBlockTime && lastSigTime
                    ? Math.max(lastSigTime, options.createPoolBlockTime)
                    : (lastSigTime ?? options.createPoolBlockTime ?? null);
            const compressedWindowSec =
                augmentedFirstSigTime && augmentedLastSigTime && augmentedLastSigTime >= augmentedFirstSigTime
                    ? augmentedLastSigTime - augmentedFirstSigTime
                    : null;
            const microInboundTransfers = inboundTransfers.filter(
                (transfer) => transfer.sol > 0 && transfer.sol <= CONFIG.CREATOR_RISK_MICRO_INBOUND_MAX_SOL
            );
            const microInboundSources = new Set(microInboundTransfers.map((transfer) => transfer.source));
            const burner =
                solInTransfers === 0 &&
                solOutTransfers > 0 &&
                solOutTransfers <= 3 &&
                solOutSol >= CONFIG.CREATOR_RISK_BURNER_MIN_OUT_SOL;
            const repeatCreateRemovePattern = deps.classifyRecentCreateRemovePattern(parsedCreatorRiskTxs, creatorAddress, {
                currentCreatePoolSignature: options.createPoolSignature,
                currentCreatePoolBlockTime: options.createPoolBlockTime,
            });
            const directAmmReentry = await deps.detectCreatorDirectAmmReentry(
                connection,
                creatorAddress,
                options.createPoolSignature,
                options.createPoolBlockTime,
                parsedCreatorRiskTxs,
            );
            const earlyChecksDoneAtMs = Date.now();
            const creatorSeedSol = Number.isFinite(options.creatorSeedSol) ? Math.max(0, options.creatorSeedSol || 0) : 0;
            const creatorSeedPctOfCurrentLiq =
                options.entrySolLiquidity && options.entrySolLiquidity > 0 && creatorSeedSol > 0
                    ? (creatorSeedSol / options.entrySolLiquidity) * 100
                    : 0;
            const creatorSeedGrowthMultiple =
                creatorSeedSol > 0 && options.entrySolLiquidity && options.entrySolLiquidity > 0
                    ? options.entrySolLiquidity / creatorSeedSol
                    : Infinity;
            const freshFundedHighSeed = classifyFreshFundedHighSeed(
                parsedCreatorRiskTxs,
                creatorAddress,
                options.createPoolBlockTime,
                creatorSeedSol,
                creatorSeedPctOfCurrentLiq,
                uniqueCounterparties,
            );
            const sprayOutbound = deps.classifySprayOutboundPattern(outboundTransfers);
            const sprayInbound = deps.classifyInboundSprayPattern(inboundTransfers);
            let setupBurst = classifySetupBurst(parsedCreatorRiskTxs, creatorAddress);
            const closeAccountBurst = classifyCloseAccountBurst(parsedCreatorRiskTxs, creatorAddress);
            const rapidDispersal = classifyRapidDispersal(parsedCreatorRiskTxs, creatorAddress);

            stageLog(
                ctx,
                "CRISK",
                `cp=${uniqueCounterparties} in=${solInTransfers} out=${solOutTransfers} ` +
                `window=${compressedWindowSec ?? "n/a"}s funder=${funder ? funder : "-"} refund=${funderRefundSol.toFixed(3)} ` +
                `micro=${microInboundTransfers.length}/${microInboundSources.size}`
            );

            const enrichBaseResult = (result: CreatorRiskResult): CreatorRiskResult => ({
                latestObservedSignature,
                latestObservedBlockTime,
                fastCheckMs: earlyChecksDoneAtMs - startedAtMs,
                solInTransfers,
                solOutTransfers,
                ...result,
            });
            const cacheAndReturn = (result: CreatorRiskResult) => {
                creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
                return result;
            };
            const returnEarlyDecision = (result: CreatorRiskResult) => {
                stageLog(
                    ctx,
                    "CRISKT",
                    `hist=${fmtMs(rugHistoryDoneAtMs - startedAtMs)} parse=${fmtMs(historyParsedAtMs - rugHistoryDoneAtMs)} ` +
                    `early=${fmtMs(earlyChecksDoneAtMs - historyParsedAtMs)} deep=0ms total=${fmtMs(earlyChecksDoneAtMs - startedAtMs)}`
                );
                return cacheAndReturn(enrichBaseResult({
                    deepChecksComplete: true,
                    deepCheckMs: 0,
                    ...result,
                }));
            };

            if (creatorSeedSol > 0 && options.entrySolLiquidity && options.entrySolLiquidity > 0) {
                stageLog(
                    ctx,
                    "SEED",
                    `creator=${creatorSeedSol.toFixed(3)} SOL pct=${creatorSeedPctOfCurrentLiq.toFixed(2)}% growth=${creatorSeedGrowthMultiple.toFixed(2)}x`
                );
            }
            if (freshFundedHighSeed.strictFlowRequired) {
                stageLog(
                    ctx,
                    "FFSEED",
                    `fund=${freshFundedHighSeed.fundingSol.toFixed(3)} age=${freshFundedHighSeed.fundingAgeSec ?? "n/a"}s ` +
                    `seed=${creatorSeedSol.toFixed(3)} pct=${creatorSeedPctOfCurrentLiq.toFixed(2)}% cp=${uniqueCounterparties} ` +
                    `block=${freshFundedHighSeed.blockDetected ? "yes" : "no"}`
                );
            }
            if (sprayInbound.detected) {
                stageLog(
                    ctx,
                    "ISPRAY",
                    `in=${sprayInbound.transfers} src=${sprayInbound.sources} median=${sprayInbound.medianSol.toFixed(3)} ` +
                    `rel_std=${sprayInbound.relStdDev.toFixed(2)} ratio=${sprayInbound.amountRatio.toFixed(2)}`
                );
            }
            if (sprayOutbound.detected) {
                stageLog(
                    ctx,
                    "SPRAY",
                    `out=${sprayOutbound.transfers} dest=${sprayOutbound.destinations} median=${sprayOutbound.medianSol.toFixed(3)} ` +
                    `rel_std=${sprayOutbound.relStdDev.toFixed(2)} ratio=${sprayOutbound.amountRatio.toFixed(2)}`
                );
            }
            if (closeAccountBurst.closes > 0) {
                stageLog(
                    ctx,
                    "CCLOSE",
                    `txs=${closeAccountBurst.txs} closes=${closeAccountBurst.closes} window=${closeAccountBurst.windowSec ?? "n/a"}s`
                );
            }
            if (repeatCreateRemovePattern.creates > 0 || repeatCreateRemovePattern.removes > 0 || repeatCreateRemovePattern.cashouts > 0) {
                stageLog(
                    ctx,
                    "RREPEAT",
                    `create=${repeatCreateRemovePattern.creates} remove=${repeatCreateRemovePattern.removes} ` +
                    `cashout=${repeatCreateRemovePattern.cashouts} window=${repeatCreateRemovePattern.windowSec ?? "n/a"}s ` +
                    `max_out=${repeatCreateRemovePattern.maxCashoutSol.toFixed(3)}`
                );
            }
            if (directAmmReentry.detected) {
                stageLog(
                    ctx,
                    "CAMM",
                    `creator direct ${shortSig(deps.pumpfunAmmProgramId)} re-entry via ${shortSig(directAmmReentry.signature || "-")}`
                );
                return returnEarlyDecision({
                    ok: false,
                    reason: `creator direct AMM re-entry ${directAmmReentry.signature}`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    deepChecksComplete: true,
                    directAmmReentrySig: directAmmReentry.signature,
                    creatorSeedSol,
                    creatorSeedPctOfCurrentLiq,
                    repeatedCreateRemoveCreates: repeatCreateRemovePattern.creates,
                    repeatedCreateRemoveRemoves: repeatCreateRemovePattern.removes,
                    repeatedCreateRemoveCashouts: repeatCreateRemovePattern.cashouts,
                    repeatedCreateRemoveWindowSec: repeatCreateRemovePattern.windowSec,
                    repeatedCreateRemoveMaxCashoutSol: repeatCreateRemovePattern.maxCashoutSol,
                });
            }

            if (funder && (rugHistory.rugCreators.has(funder) || rugHistory.rugFunders.has(funder))) {
                return returnEarlyDecision({
                    ok: false,
                    reason: `funder blacklisted ${funder}`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                });
            }

            if (funder && (rugHistory.rugMicroBurstSources.has(funder) || rugHistory.rugCashoutRelays.has(funder))) {
                return returnEarlyDecision({
                    ok: false,
                    reason: `funder linked to suspicious infra ${funder}`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                });
            }

            const blacklistedMicroSource = [...microInboundSources].find((source) => rugHistory.rugMicroBurstSources.has(source));
            if (blacklistedMicroSource) {
                return returnEarlyDecision({
                    ok: false,
                    reason: `micro-burst source blacklisted ${blacklistedMicroSource}`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                });
            }

            if (
                freshFundedHighSeed.blockDetected
            ) {
                return returnEarlyDecision({
                    ok: false,
                    reason:
                        `fresh-funded high-seed creator ${freshFundedHighSeed.fundingSol.toFixed(3)} SOL ` +
                        `${freshFundedHighSeed.fundingAgeSec ?? "n/a"}s before create ` +
                        `(seed ${creatorSeedSol.toFixed(3)} SOL, ${creatorSeedPctOfCurrentLiq.toFixed(2)}% liq, cp ${uniqueCounterparties})`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    strictPreEntryFlowRequired: true,
                    creatorSeedSol,
                    creatorSeedPctOfCurrentLiq,
                    freshFundedHighSeed: true,
                    freshFundingSol: freshFundedHighSeed.fundingSol,
                    freshFundingAgeSec: freshFundedHighSeed.fundingAgeSec,
                });
            }

            if (
                CONFIG.CREATOR_RISK_CREATOR_SEED_RATIO_BLOCK_ENABLED &&
                creatorSeedSol > 0 &&
                options.entrySolLiquidity &&
                options.entrySolLiquidity > 0 &&
                creatorSeedPctOfCurrentLiq < CONFIG.CREATOR_RISK_CREATOR_SEED_MIN_PCT_OF_CURRENT_LIQ &&
                creatorSeedGrowthMultiple >= CONFIG.CREATOR_RISK_CREATOR_SEED_MAX_GROWTH_MULTIPLIER
            ) {
                return returnEarlyDecision({
                    ok: false,
                    reason:
                        `creator seed too small ${creatorSeedSol.toFixed(3)} SOL ` +
                        `(${creatorSeedPctOfCurrentLiq.toFixed(2)}% of liq, growth ${creatorSeedGrowthMultiple.toFixed(2)}x)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    creatorSeedSol,
                    creatorSeedPctOfCurrentLiq,
                });
            }

            if (
                compressedWindowSec !== null &&
                compressedWindowSec <= CONFIG.CREATOR_RISK_MICRO_INBOUND_WINDOW_SEC &&
                microInboundTransfers.length >= CONFIG.CREATOR_RISK_MICRO_INBOUND_MIN_TRANSFERS &&
                microInboundSources.size >= CONFIG.CREATOR_RISK_MICRO_INBOUND_MIN_SOURCES
            ) {
                return returnEarlyDecision({
                    ok: false,
                    reason: `micro inbound burst ${microInboundTransfers.length} transfers from ${microInboundSources.size} sources in ${compressedWindowSec}s`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    microInboundTransfers: microInboundTransfers.length,
                    microInboundSources: microInboundSources.size,
                });
            }

            if (
                CONFIG.CREATOR_RISK_INBOUND_SPRAY_BLOCK_ENABLED &&
                compressedWindowSec !== null &&
                compressedWindowSec <= CONFIG.CREATOR_RISK_INBOUND_SPRAY_MAX_WINDOW_SEC &&
                sprayInbound.detected
            ) {
                return returnEarlyDecision({
                    ok: false,
                    reason:
                        `inbound collector pattern ${sprayInbound.transfers} transfers ` +
                        `from ${sprayInbound.sources} sources in ${compressedWindowSec}s ` +
                        `(median ${sprayInbound.medianSol.toFixed(3)} SOL, rel_std ${sprayInbound.relStdDev.toFixed(2)})`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    creatorSeedSol,
                    creatorSeedPctOfCurrentLiq,
                    inboundSpraySources: sprayInbound.sources,
                });
            }

            if (CONFIG.CREATOR_RISK_SPRAY_OUTBOUND_BLOCK_ENABLED && sprayOutbound.detected) {
                return returnEarlyDecision({
                    ok: false,
                    reason:
                        `spray outbound pattern ${sprayOutbound.transfers} transfers ` +
                        `to ${sprayOutbound.destinations} destinations ` +
                        `(median ${sprayOutbound.medianSol.toFixed(3)} SOL, rel_std ${sprayOutbound.relStdDev.toFixed(2)})`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    creatorSeedSol,
                    creatorSeedPctOfCurrentLiq,
                });
            }

            if (repeatCreateRemovePattern.detected) {
                return returnEarlyDecision({
                    ok: false,
                    reason:
                        `creator repeated create-remove pattern ` +
                        `create=${repeatCreateRemovePattern.creates} remove=${repeatCreateRemovePattern.removes} ` +
                        `cashout=${repeatCreateRemovePattern.cashouts} in ${repeatCreateRemovePattern.windowSec ?? "n/a"}s ` +
                        `(max_out ${repeatCreateRemovePattern.maxCashoutSol.toFixed(3)} SOL)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    repeatedCreateRemoveCreates: repeatCreateRemovePattern.creates,
                    repeatedCreateRemoveRemoves: repeatCreateRemovePattern.removes,
                    repeatedCreateRemoveCashouts: repeatCreateRemovePattern.cashouts,
                    repeatedCreateRemoveWindowSec: repeatCreateRemovePattern.windowSec,
                    repeatedCreateRemoveMaxCashoutSol: repeatCreateRemovePattern.maxCashoutSol,
                });
            }

            if (
                deps.isStandardRelayRiskPool(options.entrySolLiquidity) &&
                CONFIG.CREATOR_RISK_STANDARD_POOL_MICRO_BLOCK_ENABLED &&
                compressedWindowSec !== null &&
                compressedWindowSec <= CONFIG.CREATOR_RISK_STANDARD_POOL_MICRO_MAX_WINDOW_SEC &&
                microInboundTransfers.length >= CONFIG.CREATOR_RISK_STANDARD_POOL_MICRO_MIN_TRANSFERS &&
                microInboundSources.size >= CONFIG.CREATOR_RISK_STANDARD_POOL_MICRO_MIN_SOURCES
            ) {
                return returnEarlyDecision({
                    ok: false,
                    reason:
                        `standard pool micro burst ${microInboundTransfers.length} transfers ` +
                        `from ${microInboundSources.size} sources in ${compressedWindowSec}s ` +
                        `(${options.entrySolLiquidity?.toFixed(2)} SOL pool)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                });
            }

            if (
                deps.isStandardRelayRiskPool(options.entrySolLiquidity) &&
                CONFIG.CREATOR_RISK_STANDARD_POOL_OUTBOUND_HEAVY_BLOCK_ENABLED &&
                compressedWindowSec !== null &&
                compressedWindowSec <= CONFIG.CREATOR_RISK_STANDARD_POOL_OUTBOUND_HEAVY_MAX_WINDOW_SEC &&
                uniqueCounterparties >= CONFIG.CREATOR_RISK_STANDARD_POOL_OUTBOUND_HEAVY_MIN_COUNTERPARTIES &&
                solOutTransfers >= CONFIG.CREATOR_RISK_STANDARD_POOL_OUTBOUND_HEAVY_MIN_OUT_TRANSFERS &&
                solInTransfers <= CONFIG.CREATOR_RISK_STANDARD_POOL_OUTBOUND_HEAVY_MAX_IN_TRANSFERS
            ) {
                return returnEarlyDecision({
                    ok: false,
                    reason:
                        `standard pool outbound-heavy creator history ` +
                        `cp=${uniqueCounterparties} in=${solInTransfers} out=${solOutTransfers} ` +
                        `window=${compressedWindowSec}s`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                });
            }

            if (
                CONFIG.CREATOR_RISK_FUNDING_PATTERN_BLOCK_ENABLED &&
                (
                    (microInboundTransfers.length >= CONFIG.CREATOR_RISK_FUNDING_PATTERN_MICRO_MIN_TRANSFERS &&
                     microInboundSources.size >= CONFIG.CREATOR_RISK_FUNDING_PATTERN_MICRO_MIN_SOURCES)
                )
            ) {
                return returnEarlyDecision({
                    ok: false,
                    reason: `suspicious funding pattern: ${microInboundTransfers.length} micro transfers from ${microInboundSources.size} sources`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    creatorRiskMicroTransfers: microInboundTransfers.length,
                    creatorRiskMicroSources: microInboundSources.size,
                });
            }

            if (funder && CONFIG.CREATOR_RISK_FUNDER_CLUSTER_ENABLED) {
                const historicalCount = rugHistory.rugFunderCounts.get(funder) || 0;
                if (historicalCount >= CONFIG.CREATOR_RISK_HISTORICAL_FUNDER_CLUSTER_MIN_RUG_CREATORS) {
                    return returnEarlyDecision({
                        ok: false,
                        reason: `funder cluster historical ${historicalCount} rug creators`,
                        funder,
                        uniqueCounterparties,
                        compressedWindowSec,
                        burner,
                    });
                }

                const recentCreatorCount = deps.trackRecentFunderCreator(funder, creatorAddress);
                if (recentCreatorCount >= CONFIG.CREATOR_RISK_FUNDER_CLUSTER_MIN_CREATORS) {
                    return returnEarlyDecision({
                        ok: false,
                        reason: `funder cluster recent ${recentCreatorCount} creators in ${CONFIG.CREATOR_RISK_FUNDER_CLUSTER_WINDOW_SEC}s`,
                        funder,
                        uniqueCounterparties,
                        compressedWindowSec,
                        burner,
                    });
                }
            }

            if (linksToCreators.size > 0) {
                const linked = Array.from(linksToCreators)[0];
                return returnEarlyDecision({
                    ok: false,
                    reason: `linked to historical rug creator ${linked}`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                });
            }

            if (funder && funderRefundSol >= CONFIG.CREATOR_RISK_FUNDER_REFUND_MIN_SOL) {
                return returnEarlyDecision({
                    ok: false,
                    reason: `creator refunded funder ${funderRefundSol.toFixed(3)} SOL`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    funderRefundSol,
                });
            }

            if (uniqueCounterparties >= CONFIG.CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES) {
                return returnEarlyDecision({
                    ok: false,
                    reason: `unique counterparties ${uniqueCounterparties} >= ${CONFIG.CREATOR_RISK_MAX_UNIQUE_COUNTERPARTIES}`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                });
            }

            if (
                compressedWindowSec !== null &&
                compressedWindowSec <= CONFIG.CREATOR_RISK_COMPRESSED_WINDOW_SEC &&
                uniqueCounterparties >= CONFIG.CREATOR_RISK_COMPRESSED_MAX_COUNTERPARTIES
            ) {
                return returnEarlyDecision({
                    ok: false,
                    reason: `compressed activity ${uniqueCounterparties} counterparties in ${compressedWindowSec}s`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                });
            }

            if (burner) {
                return returnEarlyDecision({
                    ok: false,
                    reason: `burner profile out=${solOutSol.toFixed(2)} SOL with no inbound transfers`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                });
            }

            const deepChecksPromise = Promise.all([
                deps.classifyCreatorCashoutRisk(
                    connection,
                    creatorAddress,
                    funder,
                    outboundTransfers,
                    options.entrySolLiquidity,
                    createPoolOutboundDestinations,
                ),
                deps.collectPrecreateCreatorRiskTxs(
                    connection,
                    creatorAddress,
                    options.createPoolSignature,
                    options.createPoolBlockTime,
                    parsedCreatorRiskTxs,
                ),
                deps.classifyRecentRelayFunding(connection, creatorAddress, funder),
            ]);
            const deepBudgetMs = Math.max(0, Number(options.deepCheckBudgetMs ?? CONFIG.CREATOR_RISK_DEEP_CHECK_BUDGET_MS));
            let deepOutcome = await deps.withTimeout(deepChecksPromise, deepBudgetMs);
            if (deepOutcome.timedOut && !options.allowFastPathOnDeepTimeout && !deps.monitorOnly) {
                deepOutcome = { timedOut: false, value: await deepChecksPromise };
            }

            let creatorCashout = previousResult?.deepChecksComplete
                ? {
                    totalSol: Number(previousResult.creatorCashoutSol || 0),
                    maxSingleSol: Number(previousResult.creatorCashoutSol || 0),
                    pctOfEntryLiquidity: Number(previousResult.creatorCashoutPctOfEntryLiquidity || 0),
                    score: Number(previousResult.creatorCashoutScore || 0),
                    destination: previousResult.creatorCashoutDestination || null,
                }
                : { totalSol: 0, maxSingleSol: 0, pctOfEntryLiquidity: 0, score: 0, destination: null as string | null };
            let precreateOutboundTransfers: Array<{ destination: string; sol: number }> = [];
            let precreateCreatorRiskTxs: ParsedCreatorRiskTx[] = [];
            let relayFunding: RelayFundingResult = {
                detected: false,
                root: previousResult?.relayFundingRoot || null,
                inboundSol: 0,
                outboundSol: 0,
                windowSec: null,
            };

            if (!deepOutcome.timedOut && deepOutcome.value) {
                [creatorCashout, precreateCreatorRiskTxs, relayFunding] = deepOutcome.value;
            } else if (deepOutcome.timedOut) {
                stageLog(ctx, "CRISK", `deep checks timed out at ${deepBudgetMs}ms`);
            }

            const deepChecksDoneAtMs = Date.now();
            const deepChecksComplete = !deepOutcome.timedOut;
            const combinedPrecreateTxs = mergeParsedCreatorRiskTxs(parsedCreatorRiskTxs, precreateCreatorRiskTxs);
            setupBurst = classifySetupBurst(combinedPrecreateTxs, creatorAddress);
            precreateOutboundTransfers = extractOutboundTransfersFromParsedCreatorRiskTxs(combinedPrecreateTxs, creatorAddress)
                .map(({ destination, sol }) => ({ destination, sol }));
            const concentratedInboundFunding = classifyConcentratedInboundFunding(combinedPrecreateTxs, creatorAddress);
            const precreateBurst = deps.classifyPrecreateOutboundBurst(precreateOutboundTransfers);
            const precreateLargeUniformBurst = classifyPrecreateLargeUniformBurst(combinedPrecreateTxs, creatorAddress);
            const precreateDispersalSetup = classifyPrecreateDispersalSetupPattern(
                combinedPrecreateTxs,
                creatorAddress,
                setupBurst,
            );
            if (setupBurst.creates > 0 || setupBurst.lookupTables > 0) {
                stageLog(
                    ctx,
                    "CSETUP",
                    `creates=${setupBurst.creates} lookups=${setupBurst.lookupTables} window=${setupBurst.windowSec ?? "n/a"}s`
                );
            }
            if (concentratedInboundFunding.detected) {
                stageLog(
                    ctx,
                    "CFANIN",
                    `in=${concentratedInboundFunding.transfers} src=${concentratedInboundFunding.sources} top${concentratedInboundFunding.topSources}=${(concentratedInboundFunding.topSourceShare * 100).toFixed(0)}% ` +
                    `total=${concentratedInboundFunding.totalSol.toFixed(3)} median=${concentratedInboundFunding.medianSol.toFixed(3)} ` +
                    `rel_std=${concentratedInboundFunding.relStdDev.toFixed(2)} ratio=${concentratedInboundFunding.amountRatio.toFixed(2)} window=${concentratedInboundFunding.windowSec ?? "n/a"}s`
                );
            }
            if (relayFunding.detected || relayFunding.inboundSol > 0 || relayFunding.outboundSol > 0) {
                stageLog(
                    ctx,
                    "RRELAY",
                    `root=${relayFunding.root ? shortSig(relayFunding.root) : "-"} funder=${funder ? funder : "-"} ` +
                    `in=${relayFunding.inboundSol.toFixed(3)} out=${relayFunding.outboundSol.toFixed(3)} ` +
                    `window=${relayFunding.windowSec ?? "n/a"}s`
                );
            }
            if (creatorCashout.totalSol > 0 || creatorCashout.score >= CONFIG.CREATOR_RISK_CASHOUT_WARN_SCORE) {
                stageLog(
                    ctx,
                    "CCASH",
                    `total=${creatorCashout.totalSol.toFixed(3)} max=${creatorCashout.maxSingleSol.toFixed(3)} ` +
                    `rel=${creatorCashout.pctOfEntryLiquidity.toFixed(2)}% score=${creatorCashout.score.toFixed(2)} ` +
                    `dest=${creatorCashout.destination ? shortSig(creatorCashout.destination) : "-"}`
                );
            }
            if (rapidDispersal.detected) {
                stageLog(
                    ctx,
                    "CDISP",
                    `out=${rapidDispersal.transfers} dest=${rapidDispersal.destinations} total=${rapidDispersal.totalSol.toFixed(3)}`
                );
            }
            if (precreateBurst.detected) {
                stageLog(
                    ctx,
                    "PBURST",
                    `precreate out=${precreateBurst.transfers} dest=${precreateBurst.destinations} total=${precreateBurst.totalSol.toFixed(3)} median=${precreateBurst.medianSol.toFixed(3)} ` +
                        `rel_std=${precreateBurst.relStdDev.toFixed(2)} ratio=${precreateBurst.amountRatio.toFixed(2)}`
                );
            }
            if (precreateLargeUniformBurst.detected) {
                stageLog(
                    ctx,
                    "PLBURST",
                    `precreate out=${precreateLargeUniformBurst.transfers} dest=${precreateLargeUniformBurst.destinations} total=${precreateLargeUniformBurst.totalSol.toFixed(3)} median=${precreateLargeUniformBurst.medianSol.toFixed(3)} ` +
                    `rel_std=${precreateLargeUniformBurst.relStdDev.toFixed(2)} ratio=${precreateLargeUniformBurst.amountRatio.toFixed(2)} window=${precreateLargeUniformBurst.windowSec ?? "n/a"}s`
                );
            }
            if (precreateDispersalSetup.detected) {
                stageLog(
                    ctx,
                    "PDSUP",
                    `out=${precreateDispersalSetup.transfers} dest=${precreateDispersalSetup.destinations} total=${precreateDispersalSetup.totalSol.toFixed(3)} ` +
                    `median=${precreateDispersalSetup.medianSol.toFixed(3)} window=${precreateDispersalSetup.windowSec ?? "n/a"}s ` +
                    `setup=${setupBurst.creates}/${setupBurst.windowSec ?? "n/a"}s`
                );
            }
            stageLog(
                ctx,
                "CRISKT",
                `hist=${fmtMs(rugHistoryDoneAtMs - startedAtMs)} parse=${fmtMs(historyParsedAtMs - rugHistoryDoneAtMs)} ` +
                `early=${fmtMs(earlyChecksDoneAtMs - historyParsedAtMs)} deep=${fmtMs(deepChecksDoneAtMs - earlyChecksDoneAtMs)} ` +
                `total=${fmtMs(deepChecksDoneAtMs - startedAtMs)}`
            );

            if (deepChecksComplete && precreateBurst.detected) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason:
                        `precreate uniform outbound burst ${precreateBurst.transfers} transfers ` +
                        `to ${precreateBurst.destinations} destinations ` +
                        `(total ${precreateBurst.totalSol.toFixed(3)} SOL, ` +
                        `median ${precreateBurst.medianSol.toFixed(3)} SOL, rel_std ${precreateBurst.relStdDev.toFixed(2)})`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    precreateBurstTransfers: precreateBurst.transfers,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (deepChecksComplete && precreateLargeUniformBurst.detected) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason:
                        `precreate large uniform outbound burst ${precreateLargeUniformBurst.transfers} transfers ` +
                        `to ${precreateLargeUniformBurst.destinations} destinations ` +
                        `(total ${precreateLargeUniformBurst.totalSol.toFixed(3)} SOL, median ${precreateLargeUniformBurst.medianSol.toFixed(3)} SOL)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    precreateLargeBurstTransfers: precreateLargeUniformBurst.transfers,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (deepChecksComplete && precreateDispersalSetup.detected) {
                const entrySol = options.entrySolLiquidity || 0;
                const bypassLiqThreshold = CONFIG.CREATOR_RISK_SETUP_BURST_LIQUIDITY_BYPASS_SOL;
                if (entrySol >= bypassLiqThreshold) {
                    stageLog(
                        ctx,
                        "CRISK",
                        `precreate dispersal + setup burst bypassed (${entrySol.toFixed(2)} SOL >= ${bypassLiqThreshold} SOL threshold)`
                    );
                    return cacheAndReturn(enrichBaseResult({
                        ok: true,
                        setupBurstCreates: setupBurst.creates,
                        setupBurstLookupTables: setupBurst.lookupTables,
                        setupBurstWindowSec: setupBurst.windowSec,
                        precreateDispersalSetupTransfers: precreateDispersalSetup.transfers,
                        precreateDispersalSetupDestinations: precreateDispersalSetup.destinations,
                        precreateDispersalSetupTotalSol: precreateDispersalSetup.totalSol,
                        precreateDispersalSetupMedianSol: precreateDispersalSetup.medianSol,
                        precreateDispersalSetupWindowSec: precreateDispersalSetup.windowSec,
                        poolLiquiditySol: entrySol,
                        deepChecksComplete: true,
                        deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                    }));
                }
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason:
                        `precreate dispersal + setup burst ${precreateDispersalSetup.transfers} transfers ` +
                        `to ${precreateDispersalSetup.destinations} destinations ` +
                        `(${precreateDispersalSetup.totalSol.toFixed(3)} SOL, ` +
                        `median ${precreateDispersalSetup.medianSol.toFixed(3)} SOL, ` +
                        `setup ${setupBurst.creates} in ${setupBurst.windowSec ?? "n/a"}s)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    setupBurstCreates: setupBurst.creates,
                    setupBurstLookupTables: setupBurst.lookupTables,
                    setupBurstWindowSec: setupBurst.windowSec,
                    precreateDispersalSetupTransfers: precreateDispersalSetup.transfers,
                    precreateDispersalSetupDestinations: precreateDispersalSetup.destinations,
                    precreateDispersalSetupTotalSol: precreateDispersalSetup.totalSol,
                    precreateDispersalSetupMedianSol: precreateDispersalSetup.medianSol,
                    precreateDispersalSetupWindowSec: precreateDispersalSetup.windowSec,
                    poolLiquiditySol: entrySol,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (
                deepChecksComplete &&
                concentratedInboundFunding.detected &&
                setupBurst.creates >= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MIN_SETUP_CREATES &&
                repeatCreateRemovePattern.creates >= CONFIG.CREATOR_RISK_CONCENTRATED_INBOUND_MIN_REPEAT_CREATES
            ) {
                const entrySol = options.entrySolLiquidity || 0;
                const bypassLiqThreshold = CONFIG.CREATOR_RISK_SETUP_BURST_LIQUIDITY_BYPASS_SOL;
                if (entrySol >= bypassLiqThreshold) {
                    stageLog(
                        ctx,
                        "CRISK",
                        `concentrated inbound + setup burst bypassed (${entrySol.toFixed(2)} SOL >= ${bypassLiqThreshold} SOL threshold)`
                    );
                    return cacheAndReturn(enrichBaseResult({
                        ok: true,
                        setupBurstCreates: setupBurst.creates,
                        setupBurstLookupTables: setupBurst.lookupTables,
                        setupBurstWindowSec: setupBurst.windowSec,
                        repeatedCreateRemoveCreates: repeatCreateRemovePattern.creates,
                        repeatedCreateRemoveRemoves: repeatCreateRemovePattern.removes,
                        repeatedCreateRemoveCashouts: repeatCreateRemovePattern.cashouts,
                        repeatedCreateRemoveWindowSec: repeatCreateRemovePattern.windowSec,
                        repeatedCreateRemoveMaxCashoutSol: repeatCreateRemovePattern.maxCashoutSol,
                        poolLiquiditySol: entrySol,
                        deepChecksComplete: true,
                        deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                    }));
                }
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason:
                        `concentrated inbound funding ${concentratedInboundFunding.transfers} transfers ` +
                        `from ${concentratedInboundFunding.sources} sources ` +
                        `(top${concentratedInboundFunding.topSources} ${(concentratedInboundFunding.topSourceShare * 100).toFixed(0)}%, ` +
                        `median ${concentratedInboundFunding.medianSol.toFixed(3)} SOL, total ${concentratedInboundFunding.totalSol.toFixed(3)} SOL)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    setupBurstCreates: setupBurst.creates,
                    setupBurstLookupTables: setupBurst.lookupTables,
                    setupBurstWindowSec: setupBurst.windowSec,
                    repeatedCreateRemoveCreates: repeatCreateRemovePattern.creates,
                    repeatedCreateRemoveRemoves: repeatCreateRemovePattern.removes,
                    repeatedCreateRemoveCashouts: repeatCreateRemovePattern.cashouts,
                    repeatedCreateRemoveWindowSec: repeatCreateRemovePattern.windowSec,
                    repeatedCreateRemoveMaxCashoutSol: repeatCreateRemovePattern.maxCashoutSol,
                    poolLiquiditySol: entrySol,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (
                deepChecksComplete &&
                CONFIG.CREATOR_RISK_LOOKUP_TABLE_NEAR_CREATE_BLOCK_ENABLED &&
                setupBurst.lookupTables >= CONFIG.CREATOR_RISK_LOOKUP_TABLE_NEAR_CREATE_MIN_LOOKUPS &&
                setupBurst.creates >= CONFIG.CREATOR_RISK_LOOKUP_TABLE_NEAR_CREATE_MIN_CREATES &&
                setupBurst.windowSec !== null &&
                setupBurst.windowSec <= CONFIG.CREATOR_RISK_LOOKUP_TABLE_NEAR_CREATE_MAX_WINDOW_SEC
            ) {
                const entrySol = options.entrySolLiquidity || 0;
                const bypassLiqThreshold = CONFIG.CREATOR_RISK_SETUP_BURST_LIQUIDITY_BYPASS_SOL;
                if (entrySol >= bypassLiqThreshold) {
                    stageLog(
                        ctx,
                        "CRISK",
                        `lookup-table + setup burst bypassed (${entrySol.toFixed(2)} SOL >= ${bypassLiqThreshold} SOL threshold)`
                    );
                    return cacheAndReturn(enrichBaseResult({
                        ok: true,
                        setupBurstCreates: setupBurst.creates,
                        setupBurstLookupTables: setupBurst.lookupTables,
                        setupBurstWindowSec: setupBurst.windowSec,
                        poolLiquiditySol: entrySol,
                        deepChecksComplete: true,
                        deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                    }));
                }
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason:
                        `lookup-table + setup burst ${setupBurst.lookupTables} lookups ` +
                        `and ${setupBurst.creates} create/mint ops in ${setupBurst.windowSec}s`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    setupBurstCreates: setupBurst.creates,
                    setupBurstLookupTables: setupBurst.lookupTables,
                    setupBurstWindowSec: setupBurst.windowSec,
                    poolLiquiditySol: entrySol,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (setupBurst.detected) {
                const entrySol = options.entrySolLiquidity || 0;
                const bypassLiqThreshold = CONFIG.CREATOR_RISK_SETUP_BURST_LIQUIDITY_BYPASS_SOL;
                if (entrySol >= bypassLiqThreshold) {
                    stageLog(
                        ctx,
                        "CRISK",
                        `setup burst ${setupBurst.creates} ops/${setupBurst.windowSec}s bypassed (${entrySol.toFixed(2)} SOL >= ${bypassLiqThreshold} SOL threshold)`
                    );
                    return cacheAndReturn(enrichBaseResult({
                        ok: true,
                        setupBurstCreates: setupBurst.creates,
                        setupBurstLookupTables: setupBurst.lookupTables,
                        setupBurstWindowSec: setupBurst.windowSec,
                        poolLiquiditySol: entrySol,
                        deepChecksComplete: true,
                        deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                    }));
                }
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason: `setup burst ${setupBurst.creates} create/mint ops in ${setupBurst.windowSec ?? "n/a"}s`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    setupBurstCreates: setupBurst.creates,
                    setupBurstLookupTables: setupBurst.lookupTables,
                    setupBurstWindowSec: setupBurst.windowSec,
                    poolLiquiditySol: entrySol,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (closeAccountBurst.detected) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason: `close-account burst ${closeAccountBurst.closes} closes across ${closeAccountBurst.txs} tx in ${closeAccountBurst.windowSec ?? "n/a"}s`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    closeAccountBurstTxs: closeAccountBurst.txs,
                    closeAccountBurstCloses: closeAccountBurst.closes,
                    closeAccountBurstWindowSec: closeAccountBurst.windowSec,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (deepChecksComplete && creatorCashout.totalSol > 0 && rapidDispersal.detected) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason:
                        `rapid creator dispersal ${rapidDispersal.transfers} transfers ` +
                        `to ${rapidDispersal.destinations} destinations ` +
                        `(${rapidDispersal.totalSol.toFixed(3)} SOL)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    creatorCashoutSol: creatorCashout.totalSol,
                    creatorCashoutPctOfEntryLiquidity: creatorCashout.pctOfEntryLiquidity,
                    creatorCashoutScore: creatorCashout.score,
                    creatorCashoutDestination: creatorCashout.destination,
                    rapidDispersalTransfers: rapidDispersal.transfers,
                    rapidDispersalDestinations: rapidDispersal.destinations,
                    rapidDispersalTotalSol: rapidDispersal.totalSol,
                    rapidDispersalWindowSec: rapidDispersal.windowSec,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (
                deps.isStandardRelayRiskPool(options.entrySolLiquidity) &&
                CONFIG.CREATOR_RISK_STANDARD_POOL_RELAY_OUTBOUND_BLOCK_ENABLED &&
                !!funder &&
                uniqueCounterparties >= CONFIG.CREATOR_RISK_STANDARD_POOL_RELAY_OUTBOUND_MIN_COUNTERPARTIES &&
                solOutTransfers >= CONFIG.CREATOR_RISK_STANDARD_POOL_RELAY_OUTBOUND_MIN_OUT_TRANSFERS &&
                microInboundTransfers.length <= CONFIG.CREATOR_RISK_STANDARD_POOL_RELAY_OUTBOUND_MAX_MICRO_TRANSFERS &&
                relayFunding.outboundSol >= CONFIG.CREATOR_RISK_STANDARD_POOL_RELAY_OUTBOUND_MIN_SOL
            ) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason:
                        `standard pool relay-outbound pattern funder=${funder} ` +
                        `cp=${uniqueCounterparties} out=${solOutTransfers} ` +
                        `micro=${microInboundTransfers.length}/${microInboundSources.size} ` +
                        `relay_out=${relayFunding.outboundSol.toFixed(3)} SOL`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    relayFundingRoot: relayFunding.root,
                    deepChecksComplete,
                    deepTimedOut: !deepChecksComplete,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (
                deepChecksComplete &&
                CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_BLOCK_ENABLED &&
                relayFunding.root &&
                deps.isSuspiciousRelayRoot(relayFunding.root, rugHistory) &&
                uniqueCounterparties >= CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MIN_COUNTERPARTIES &&
                solOutTransfers >= CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MIN_OUT_TRANSFERS &&
                microInboundTransfers.length <= CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MAX_MICRO_TRANSFERS &&
                microInboundSources.size <= CONFIG.CREATOR_RISK_SUSPICIOUS_ROOT_PATTERN_MAX_MICRO_SOURCES
            ) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason:
                        `suspicious relay-root pattern root=${relayFunding.root} ` +
                        `cp=${uniqueCounterparties} out=${solOutTransfers} ` +
                        `micro=${microInboundTransfers.length}/${microInboundSources.size}`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    relayFundingRoot: relayFunding.root,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (
                deepChecksComplete &&
                CONFIG.CREATOR_RISK_SPRAY_OUTBOUND_BLOCK_ENABLED &&
                relayFunding.root &&
                deps.isSuspiciousRelayRoot(relayFunding.root, rugHistory) &&
                sprayOutbound.detected
            ) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason:
                        `spray outbound pattern root=${relayFunding.root} ` +
                        `out=${sprayOutbound.transfers} dest=${sprayOutbound.destinations} ` +
                        `median=${sprayOutbound.medianSol.toFixed(3)} rel_std=${sprayOutbound.relStdDev.toFixed(2)}`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    relayFundingRoot: relayFunding.root,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (
                deepChecksComplete &&
                options.entrySolLiquidity &&
                CONFIG.HOLD_CREATOR_CASHOUT_EXIT_ENABLED &&
                creatorCashout.score >= CONFIG.CREATOR_RISK_CASHOUT_EXIT_SCORE
            ) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason: `creator cashout ${creatorCashout.totalSol.toFixed(3)} SOL (${creatorCashout.pctOfEntryLiquidity.toFixed(2)}% liq, score ${creatorCashout.score.toFixed(2)})`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    funderRefundSol,
                    creatorCashoutSol: creatorCashout.totalSol,
                    creatorCashoutPctOfEntryLiquidity: creatorCashout.pctOfEntryLiquidity,
                    creatorCashoutScore: creatorCashout.score,
                    creatorCashoutDestination: creatorCashout.destination,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (deepChecksComplete && relayFunding.detected && deps.isStandardRelayRiskPool(options.entrySolLiquidity)) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason: `relay funding recent on standard pool ${options.entrySolLiquidity?.toFixed(2)} SOL (root ${relayFunding.root || "-"}, in ${relayFunding.inboundSol.toFixed(3)} SOL, out ${relayFunding.outboundSol.toFixed(3)} SOL)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    relayFundingRoot: relayFunding.root,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (
                deepChecksComplete &&
                relayFunding.detected &&
                microInboundTransfers.length >= CONFIG.CREATOR_RISK_MICRO_INBOUND_MIN_TRANSFERS
            ) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason: `relay funding recent + micro burst (root ${relayFunding.root || "-"}, in ${relayFunding.inboundSol.toFixed(3)} SOL, out ${relayFunding.outboundSol.toFixed(3)} SOL)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    relayFundingRoot: relayFunding.root,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (
                deepChecksComplete &&
                relayFunding.detected &&
                relayFunding.root &&
                (rugHistory.rugFunders.has(relayFunding.root) || rugHistory.rugCashoutRelays.has(relayFunding.root))
            ) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason: `relay funding root blacklisted ${relayFunding.root}`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    relayFundingRoot: relayFunding.root,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            if (
                deepChecksComplete &&
                CONFIG.CREATOR_RISK_FUNDING_PATTERN_BLOCK_ENABLED &&
                relayFunding.detected &&
                relayFunding.inboundSol > 0 &&
                relayFunding.inboundSol <= CONFIG.CREATOR_RISK_FUNDING_PATTERN_RELAY_INBOUND_MAX_SOL &&
                relayFunding.outboundSol >= CONFIG.CREATOR_RISK_FUNDING_PATTERN_RELAY_OUTBOUND_MIN_SOL &&
                (relayFunding.outboundSol / relayFunding.inboundSol) > CONFIG.CREATOR_RISK_FUNDING_PATTERN_RELAY_ASYMMETRY_RATIO
            ) {
                return cacheAndReturn(enrichBaseResult({
                    ok: false,
                    reason: `relay funding asymmetry pattern (in ${relayFunding.inboundSol.toFixed(3)} SOL, out ${relayFunding.outboundSol.toFixed(1)} SOL, ratio ${(relayFunding.outboundSol / relayFunding.inboundSol).toFixed(0)}x)`,
                    funder,
                    uniqueCounterparties,
                    compressedWindowSec,
                    burner,
                    relayFundingRoot: relayFunding.root,
                    relayFundingInboundSol: relayFunding.inboundSol,
                    relayFundingOutboundSol: relayFunding.outboundSol,
                    relayFundingWindowSec: relayFunding.windowSec,
                    relayFundingFunder: funder,
                    deepChecksComplete: true,
                    deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                }));
            }

            return cacheAndReturn(enrichBaseResult({
                ok: true,
                funder,
                uniqueCounterparties,
                compressedWindowSec,
                burner,
                deepChecksComplete,
                deepTimedOut: !deepChecksComplete,
                deepCheckMs: deepChecksDoneAtMs - earlyChecksDoneAtMs,
                funderRefundSol,
                creatorCashoutSol: creatorCashout.totalSol,
                creatorCashoutPctOfEntryLiquidity: creatorCashout.pctOfEntryLiquidity,
                creatorCashoutScore: creatorCashout.score,
                creatorCashoutDestination: creatorCashout.destination,
                relayFundingRoot: relayFunding.root,
                relayFundingInboundSol: relayFunding.inboundSol,
                relayFundingOutboundSol: relayFunding.outboundSol,
                relayFundingWindowSec: relayFunding.windowSec,
                relayFundingFunder: funder,
                creatorRiskMicroTransfers: microInboundTransfers.length,
                creatorRiskMicroSources: microInboundSources.size,
                directAmmReentrySig: directAmmReentry.signature,
                strictPreEntryFlowRequired: freshFundedHighSeed.strictFlowRequired,
                creatorSeedSol,
                creatorSeedPctOfCurrentLiq,
                freshFundedHighSeed: freshFundedHighSeed.strictFlowRequired,
                freshFundingSol: freshFundedHighSeed.fundingSol,
                freshFundingAgeSec: freshFundedHighSeed.fundingAgeSec,
                inboundSpraySources: sprayInbound.sources,
                precreateBurstTransfers: precreateBurst.transfers,
                setupBurstCreates: setupBurst.creates,
                setupBurstWindowSec: setupBurst.windowSec,
                closeAccountBurstTxs: closeAccountBurst.txs,
                closeAccountBurstCloses: closeAccountBurst.closes,
                closeAccountBurstWindowSec: closeAccountBurst.windowSec,
                rapidDispersalTransfers: rapidDispersal.transfers,
                rapidDispersalDestinations: rapidDispersal.destinations,
                rapidDispersalTotalSol: rapidDispersal.totalSol,
                rapidDispersalWindowSec: rapidDispersal.windowSec,
                repeatedCreateRemoveCreates: repeatCreateRemovePattern.creates,
                repeatedCreateRemoveRemoves: repeatCreateRemovePattern.removes,
                repeatedCreateRemoveCashouts: repeatCreateRemovePattern.cashouts,
                repeatedCreateRemoveWindowSec: repeatCreateRemovePattern.windowSec,
                repeatedCreateRemoveMaxCashoutSol: repeatCreateRemovePattern.maxCashoutSol,
            }));
        } catch (e: any) {
            const reason = e?.message || "creator risk check failed";
            const result = { ok: false, reason, transientError: deps.isRateLimitedMessage(reason) };
            if (!result.transientError) {
                creatorRiskCache.set(creatorAddress, { checkedAtMs: Date.now(), result });
            }
            return result;
        }
    }

    async function runCheckWithRetry(
        connection: Connection,
        creatorAddress: string,
        ctx: string,
        options: CreatorRiskCheckOptions = {},
    ): Promise<CreatorRiskResult> {
        const retries = Math.max(0, CONFIG.CREATOR_RISK_RATE_LIMIT_RETRIES);
        const maxAttempts = retries + 1;
        const baseDelayMs = Math.max(0, CONFIG.CREATOR_RISK_RATE_LIMIT_RETRY_BASE_MS);

        let lastResult: CreatorRiskResult = { ok: false, reason: "creator risk unavailable", transientError: true };
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const result = await runCheck(connection, creatorAddress, ctx, options);
            if (!result.transientError) {
                return result;
            }
            if ((result.reason || "").toLowerCase().includes("too many requests from your ip")) {
                return result;
            }

            lastResult = result;
            if (attempt < maxAttempts) {
                const delayMs = Math.round(baseDelayMs * Math.pow(1.8, attempt - 1));
                stageLog(ctx, "CRISK", `rate-limited retry ${attempt}/${maxAttempts - 1} (wait ${delayMs}ms)`);
                if (delayMs > 0) {
                    await new Promise((r) => setTimeout(r, delayMs));
                }
            }
        }

        return lastResult;
    }

    return {
        getProbationHoldMs,
        isProbationBypassForbidden,
        runCheck,
        runCheckWithRetry,
        shouldEscalateProbationCreatorRisk,
    };
}
