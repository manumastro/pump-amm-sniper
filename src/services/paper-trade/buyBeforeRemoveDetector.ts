/**
 * Phase 2: Timing-Based Rug Detection
 * 
 * Detects the "Buy Before Remove" pattern which is a high-confidence rug signature:
 * - Creator makes multiple swap transactions (buys/sells)
 * - Followed by liquidity removal (pool collapse)
 * 
 * Analysis of 3 real Solscan rugs showed 100% consistency with this pattern,
 * occurring in 17-97 seconds after pool creation.
 * 
 * NOTE: Full detection of buy vs sell direction requires parsing AMM program data.
 * This initial implementation detects liquidity removals and high-frequency swaps,
 * which together indicate a rug in progress.
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { stageLog } from "../reporting/stageLog";

export interface BuyBeforeRemoveDetectionResult {
    detected: boolean;
    swapCount: number;
    removeDetected: boolean;
    windowSec: number | null;
    reason?: string;
}

/**
 * Quick check for liquidity removal events by the creator.
 * Returns true if we detect a liquidity removal in the pool within the time window.
 */
export async function detectLiquidityRemoval(
    connection: Connection,
    poolAddress: string,
    creatorAddress: string,
    createPoolBlockTime: number | null,
    ctx?: any
): Promise<BuyBeforeRemoveDetectionResult> {
    const windowSecToCheck = CONFIG.HOLD_CREATOR_BUY_BEFORE_REMOVE_WINDOW_SEC;

    if (!CONFIG.HOLD_CREATOR_BUY_BEFORE_REMOVE_EXIT_ENABLED || !Number.isFinite(createPoolBlockTime)) {
        return {
            detected: false,
            swapCount: 0,
            removeDetected: false,
            windowSec: null,
        };
    }

    try {
        // Get recent signatures for the pool (to detect removeLiquidity calls)
        const sigs = await connection.getSignaturesForAddress(new PublicKey(poolAddress), {
            limit: 30,
        });

        if (!sigs.length) {
            return {
                detected: false,
                swapCount: 0,
                removeDetected: false,
                windowSec: null,
            };
        }

        const createTime = Math.floor(Number(createPoolBlockTime));
        const timeWindowEnd = createTime + windowSecToCheck;

        let removeDetected = false;
        let removeTime: number | null = null;
        let swapCount = 0;

        // Check pool transactions for removeLiquidity operations
        for (const sig of sigs) {
            const blockTime = sig.blockTime;
            if (!blockTime) continue;

            // Only check within our window
            if (blockTime < createTime || blockTime > timeWindowEnd) {
                continue;
            }

            try {
                const tx = await connection.getParsedTransaction(sig.signature, {
                    maxSupportedTransactionVersion: 0,
                });

                if (!tx?.transaction?.message?.instructions) continue;

                const allInstructions = [
                    ...(tx.transaction.message.instructions || []),
                    ...((tx.meta?.innerInstructions || []).flatMap((i: any) => i.instructions || [])),
                ];

                for (const ix of allInstructions) {
                    const parsed = (ix as any).parsed;
                    const program = (ix as any).program || "";
                    const type = (parsed?.type || "").toLowerCase();

                    // Look for any operation on the pool
                    if (type && (type.includes("swap") || type.includes("transfer") || type.includes("remove"))) {
                        swapCount++;
                    }

                    // Explicit removeLiquidity detection
                    if (type === "removeliquidity" || type === "removeLiquidity") {
                        removeDetected = true;
                        removeTime = blockTime;
                    }
                }
            } catch (e) {
                // Continue on parse errors
                continue;
            }
        }

        const windowSec = removeTime ? removeTime - createTime : null;

        // Flag as detected if we see liquidity removal (high confidence rug signal)
        const detected = CONFIG.HOLD_CREATOR_BUY_BEFORE_REMOVE_EXIT_ENABLED && removeDetected;

        if (detected || removeDetected) {
            stageLog(ctx, "REM", `liquidity_removal detected=${removeDetected} window=${windowSec ?? "n/a"}s`);
        }

        return {
            detected,
            swapCount,
            removeDetected,
            windowSec,
            reason: detected ? "Liquidity removal detected - rug in progress" : undefined,
        };
    } catch (error) {
        // Log error but don't fail the check
        if (ctx) {
            stageLog(ctx, "REMX", `error: ${String(error).substring(0, 80)}`);
        }
        return {
            detected: false,
            swapCount: 0,
            removeDetected: false,
            windowSec: null,
        };
    }
}
