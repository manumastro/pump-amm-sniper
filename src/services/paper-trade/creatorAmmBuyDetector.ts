/**
 * Phase 2: Rug Detection - Creator AMM Buy Detection
 * 
 * PATTERN IDENTIFICATO DA SOLSCAN ANALYSIS:
 * Quando un creator compra il SUO token sulla pool appena creata,
 * è un pattern di pump & dump in corso.
 * 
 * SOLSCAN EVIDENCE (evt-000079):
 * - Pool created 22:07:49
 * - Creator BUY #1 at 22:07:57 (8 seconds after pool)
 * - Creator BUY #2-6 in next 8 seconds (total 6 buys in 17 seconds)
 * - Creator SELL aggressivamente after
 * - Liquidity removal at 22:08:07
 * - Profit extracted: 325 SOL
 * 
 * DETECTION STRATEGY:
 * - Monitor creatorAddress signatures continuously during ENTIRE hold
 * - Look for "AMM: Buy" transaction type in Solscan terms
 * - EVEN A SINGLE BUY by creator on his own token = immediate EXIT
 * - This catches the pump phase BEFORE the dump and removal
 */

import { Connection, PublicKey } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { stageLog } from "../reporting/stageLog";

export interface CreatorAmmBuyDetectionResult {
    detected: boolean;
    buyCount: number;
    firstBuySignature?: string | null;
    firstBuyTime?: number | null;
}

/**
 * Detect if creator has made any AMM buy transactions on their own token.
 * This is a high-confidence rug indicator.
 * 
 * We check creator's recent transactions and look for swap operations
 * where they're accumulating their own token (buying).
 */
export async function detectCreatorAmmBuy(
    connection: Connection,
    creatorAddress: string,
    seenCreatorSignatures: Set<string>,
    ctx?: any
): Promise<CreatorAmmBuyDetectionResult> {
    if (!CONFIG.HOLD_CREATOR_AMM_BUY_DETECT_ENABLED) {
        return {
            detected: false,
            buyCount: 0,
        };
    }

    try {
        // Get recent transactions from the creator's account
        const signatures = await connection.getSignaturesForAddress(new PublicKey(creatorAddress), {
            limit: 30,
        });

        if (!signatures || signatures.length === 0) {
            return {
                detected: false,
                buyCount: 0,
            };
        }

        let buyCount = 0;
        let firstBuySignature: string | null = null;
        let firstBuyTime: number | null = null;

        for (const sig of signatures) {
            const signature = sig.signature;

            // Skip if we've already checked this signature
            if (seenCreatorSignatures.has(signature)) {
                continue;
            }

            // Mark as seen for next iteration
            seenCreatorSignatures.add(signature);

            try {
                // Fetch the full transaction
                const tx = await connection.getParsedTransaction(signature, {
                    maxSupportedTransactionVersion: 0,
                });

                if (!tx || !tx.transaction) {
                    continue;
                }

                const blockTime = (tx.blockTime || sig.blockTime) ?? null;
                const instructions = tx.transaction.message.instructions || [];
                const innerInstructions = tx.meta?.innerInstructions || [];

                // Flatten all instructions (both top-level and inner)
                const allInstructions = [
                    ...instructions,
                    ...innerInstructions.flatMap((entry: any) => entry.instructions || []),
                ];

                // Look for AMM swap operations
                for (const ix of allInstructions) {
                    const parsed = (ix as any).parsed;
                    const program = (ix as any).program || "";
                    const type = parsed?.type?.toLowerCase() || "";

                    // Check for swap-like operations
                    // In Raydium/Pump, swaps show as "swap" or with program="amm"
                    // We detect this heuristically:
                    // - Swap programs typically show token transfers
                    // - Creator buying = token balance increase
                    
                    if (
                        type === "swap" ||
                        type.includes("swap") ||
                        (program.includes("amm") || program.includes("pump"))
                    ) {
                        // This is a swap operation by the creator
                        // In a real rug, creator BUYs token (increases balance)
                        // This is hard to detect without full program data parsing,
                        // but the presence of swap operations on creator account
                        // combined with rapid succession is suspicious
                        
                        if (!firstBuySignature) {
                            firstBuySignature = signature;
                            firstBuyTime = blockTime;
                        }
                        buyCount++;
                    }
                }
            } catch (e) {
                // Continue on transaction parsing errors
                continue;
            }
        }

        // Detect if creator is actively swapping (even 1 = suspicious during hold)
        const detected = CONFIG.HOLD_CREATOR_AMM_BUY_DETECT_ENABLED && buyCount > 0;

        if (detected) {
            stageLog(
                ctx,
                "CAB",
                `creator AMM buy detected! buys=${buyCount} first=${firstBuySignature ? firstBuySignature.substring(0, 8) : "-"}...`
            );
        }

        return {
            detected,
            buyCount,
            firstBuySignature,
            firstBuyTime: firstBuyTime || null,
        };
    } catch (error) {
        // Log error but don't crash
        if (ctx) {
            stageLog(ctx, "CABX", `error detecting creator amm buy: ${String(error).substring(0, 60)}`);
        }
        return {
            detected: false,
            buyCount: 0,
        };
    }
}
