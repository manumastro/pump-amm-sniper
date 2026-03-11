import { Connection, PublicKey } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { stageLog } from "../reporting/stageLog";

type Top10Deps = {
    getObserverPublicKey: () => PublicKey;
    fetchSwapState: (poolAddress: string, observerUser: PublicKey) => Promise<any | null>;
    ensureMintInfo: (connection: Connection, mintKey: PublicKey) => Promise<any>;
};

export function createTop10Service(deps: Top10Deps) {
    async function getLargestAccountsWithRetry(
        connection: Connection,
        mintKey: PublicKey,
        maxAttempts: number,
        delayMs: number,
    ) {
        for (let attempt = 1; attempt <= Math.max(1, maxAttempts); attempt++) {
            try {
                return await connection.getTokenLargestAccounts(mintKey, "confirmed");
            } catch {
                if (attempt < maxAttempts) {
                    await new Promise((r) => setTimeout(r, Math.max(0, delayMs)));
                }
            }
        }
        return null;
    }

    async function resolveMintKey(
        connection: Connection,
        tokenMint: string,
        poolAddress: string,
        ctx: string,
    ): Promise<PublicKey | null> {
        const candidates: string[] = [tokenMint];

        try {
            const observerUser = deps.getObserverPublicKey();
            const state = await deps.fetchSwapState(poolAddress, observerUser);
            const anyState = state as any;
            const baseMint = anyState?.baseMint?.toBase58?.() || String(anyState?.baseMint || "");
            const quoteMint = anyState?.quoteMint?.toBase58?.() || String(anyState?.quoteMint || "");
            if (baseMint && baseMint !== "So11111111111111111111111111111111111111112") candidates.push(baseMint);
            if (quoteMint && quoteMint !== "So11111111111111111111111111111111111111112") candidates.push(quoteMint);
        } catch {
            // Keep initial extracted mint only.
        }

        const uniqueCandidates = [...new Set(candidates)];
        for (const candidate of uniqueCandidates) {
            try {
                const key = new PublicKey(candidate);
                await deps.ensureMintInfo(connection, key);
                if (candidate !== tokenMint) {
                    stageLog(ctx, "TOP10", `using fallback mint ${candidate}`);
                }
                return key;
            } catch {
                // try next
            }
        }

        return null;
    }

    async function runCheck(
        connection: Connection,
        tokenMint: string,
        poolAddress: string,
        ctx: string,
    ): Promise<{ ok: boolean; reason?: string; top10Pct?: number }> {
        if (!CONFIG.PRE_BUY_TOP10_CHECK_ENABLED) {
            stageLog(ctx, "TOP10", "check disabled");
            return { ok: true };
        }

        const unavailableResult = (reason: string) => {
            const policy = CONFIG.PRE_BUY_TOP10_FAIL_OPEN ? "fail-open" : "fail-closed";
            stageLog(ctx, "TOP10", `unavailable (${reason}) -> ${policy}`);
            if (CONFIG.PRE_BUY_TOP10_FAIL_OPEN) {
                return { ok: true };
            }
            return { ok: false, reason: `top10 unavailable: ${reason}` };
        };

        const maxAttempts = Math.max(1, CONFIG.PRE_BUY_TOP10_MAX_ATTEMPTS);
        const baseDelayMs = Math.max(0, CONFIG.PRE_BUY_TOP10_RETRY_BASE_MS);
        let lastUnavailableReason = "top10 check failed";

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                const mintKey = await resolveMintKey(connection, tokenMint, poolAddress, ctx);
                if (!mintKey) {
                    lastUnavailableReason = "no valid mint candidate";
                    throw new Error(lastUnavailableReason);
                }

                let mintInfoErr: string | null = null;
                const mintInfo = await deps.ensureMintInfo(connection, mintKey).catch((e: any) => {
                    mintInfoErr = e?.message || String(e);
                    return null;
                });
                if (!mintInfo) {
                    lastUnavailableReason = `mint info error: ${mintInfoErr || "unknown error"}`;
                    throw new Error(lastUnavailableReason);
                }

                const totalSupplyRaw = Number(mintInfo.supply.toString());
                if (!Number.isFinite(totalSupplyRaw) || totalSupplyRaw <= 0) {
                    lastUnavailableReason = "invalid token supply";
                    throw new Error(lastUnavailableReason);
                }

                const largest = await getLargestAccountsWithRetry(connection, mintKey, 8, 350);
                if (!largest) {
                    lastUnavailableReason = "largest accounts error";
                    throw new Error(lastUnavailableReason);
                }

                const top10Accounts = largest.value.slice(0, 10);
                if (top10Accounts.length === 0) {
                    lastUnavailableReason = "no holder accounts found";
                    throw new Error(lastUnavailableReason);
                }

                const parsed = await Promise.all(
                    top10Accounts.map((a) => connection.getParsedAccountInfo(a.address, "confirmed").catch(() => null))
                );

                let top10Raw = 0;
                for (let i = 0; i < top10Accounts.length; i++) {
                    const amount = Number(top10Accounts[i].amount || "0");
                    if (!Number.isFinite(amount) || amount <= 0) continue;

                    const owner = (parsed[i] as any)?.value?.data?.parsed?.info?.owner as string | undefined;
                    if (CONFIG.PRE_BUY_TOP10_EXCLUDE_POOL && owner && owner === poolAddress) {
                        continue;
                    }

                    top10Raw += amount;
                }

                const top10Pct = (top10Raw / totalSupplyRaw) * 100;
                stageLog(ctx, "TOP10", `${top10Pct.toFixed(2)}% (max ${CONFIG.PRE_BUY_TOP10_MAX_PCT.toFixed(2)}%)`);

                if (top10Pct > CONFIG.PRE_BUY_TOP10_MAX_PCT) {
                    return {
                        ok: false,
                        reason: `top10 concentration ${top10Pct.toFixed(2)}% > ${CONFIG.PRE_BUY_TOP10_MAX_PCT.toFixed(2)}%`,
                        top10Pct,
                    };
                }

                return { ok: true, top10Pct };
            } catch (e: any) {
                lastUnavailableReason = e?.message || lastUnavailableReason;
                if (attempt < maxAttempts) {
                    const retryDelayMs = Math.round(baseDelayMs * Math.pow(1.6, attempt - 1));
                    stageLog(
                        ctx,
                        "TOP10",
                        `retry ${attempt}/${maxAttempts} after error: ${lastUnavailableReason} (wait ${retryDelayMs}ms)`
                    );
                    if (retryDelayMs > 0) {
                        await new Promise((r) => setTimeout(r, retryDelayMs));
                    }
                    continue;
                }
            }
        }

        return unavailableResult(lastUnavailableReason);
    }

    return { runCheck };
}
