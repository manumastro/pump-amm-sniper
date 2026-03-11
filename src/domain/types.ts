import { ChildProcess } from "child_process";
import BN from "bn.js";

export type WorkerSlotState = {
    slot: number;
    busy: boolean;
    signature: string | null;
    child: ChildProcess | null;
};

export type CreatorRiskResult = {
    ok: boolean;
    reason?: string;
    transientError?: boolean;
    latestObservedSignature?: string | null;
    latestObservedBlockTime?: number | null;
    deepChecksComplete?: boolean;
    deepTimedOut?: boolean;
    fastCheckMs?: number;
    deepCheckMs?: number;
    funder?: string | null;
    uniqueCounterparties?: number;
    compressedWindowSec?: number | null;
    burner?: boolean;
    funderRefundSol?: number;
    creatorCashoutSol?: number;
    creatorCashoutPctOfEntryLiquidity?: number;
    creatorCashoutScore?: number;
    creatorCashoutDestination?: string | null;
    relayFundingRoot?: string | null;
    directAmmReentrySig?: string | null;
    creatorSeedSol?: number;
    creatorSeedPctOfCurrentLiq?: number;
    inboundSpraySources?: number;
    precreateBurstTransfers?: number;
    setupBurstCreates?: number;
    setupBurstWindowSec?: number | null;
    closeAccountBurstTxs?: number;
    closeAccountBurstCloses?: number;
    closeAccountBurstWindowSec?: number | null;
    rapidDispersalTransfers?: number;
    rapidDispersalDestinations?: number;
    rapidDispersalTotalSol?: number;
    rapidDispersalWindowSec?: number | null;
    microInboundTransfers?: number;
    microInboundSources?: number;
    repeatedCreateRemoveCreates?: number;
    repeatedCreateRemoveRemoves?: number;
    repeatedCreateRemoveCashouts?: number;
    repeatedCreateRemoveWindowSec?: number | null;
    repeatedCreateRemoveMaxCashoutSol?: number;
};

export type CreatorRiskCacheEntry = {
    checkedAtMs: number;
    result: CreatorRiskResult;
};

export type CreatorRiskCheckOptions = {
    forceRefresh?: boolean;
    entrySolLiquidity?: number;
    createPoolSignature?: string;
    createPoolBlockTime?: number | null;
    creatorSeedSol?: number;
    previousResult?: CreatorRiskResult;
    allowReuseIfNoNewActivity?: boolean;
    allowFastPathOnDeepTimeout?: boolean;
    deepCheckBudgetMs?: number;
};

export type RugHistory = {
    rugCreators: Set<string>;
    rugFunders: Set<string>;
    rugMicroBurstSources: Set<string>;
    rugCashoutRelays: Set<string>;
    rugFunderCounts: Map<string, number>;
};

export type ParsedCreatorRiskTx = {
    signature: string;
    blockTime: number | null;
    tx: any;
};

export type PaperTradeResult = {
    ok: boolean;
    reason?: string;
    finalStatus?: string;
};

export type PaperSimulationOptions = {
    forceHoldMs?: number;
    suppressCreatorRiskRecheck?: boolean;
};

export type PreBuyEntryValidationResult = {
    ok: boolean;
    reason?: string;
    entryState?: any;
    tokenOutAtomic?: BN;
    tokenOutUi?: number;
    entrySpotSolPerToken?: number;
};
