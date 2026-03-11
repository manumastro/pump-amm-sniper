import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { CONFIG } from "../../app/config";
import { stageLog } from "../reporting/stageLog";

type DevHoldingsDeps = {
    monitorOnly: boolean;
    getMintDecimals: (connection: Connection, mintKey: PublicKey) => Promise<number>;
};

export function createDevHoldingsService(deps: DevHoldingsDeps) {
    async function getCreatorTokenBalanceRaw(
        connection: Connection,
        creatorAddress: string,
        tokenMint: string,
        postTokenBalances: any[],
    ): Promise<bigint> {
        const creatorBalanceEntry = postTokenBalances.find((b: any) =>
            b.mint === tokenMint && b.owner === creatorAddress
        );
        if (creatorBalanceEntry?.uiTokenAmount?.amount) {
            return BigInt(creatorBalanceEntry.uiTokenAmount.amount);
        }

        const owner = new PublicKey(creatorAddress);
        const [tokenAccs, token2022Accs] = await Promise.all([
            connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_PROGRAM_ID }, "confirmed")
                .catch(() => ({ value: [] as any[] })),
            connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed")
                .catch(() => ({ value: [] as any[] })),
        ]);

        let total = 0n;
        const all = [
            ...tokenAccs.value.filter((acc: any) => acc.account.data.parsed?.info?.mint === tokenMint),
            ...token2022Accs.value.filter((acc: any) => acc.account.data.parsed?.info?.mint === tokenMint),
        ];
        for (const acc of all) {
            const amount = acc.account.data.parsed?.info?.tokenAmount?.amount;
            if (amount) total += BigInt(amount);
        }
        return total;
    }

    async function getCreatorTokenBalanceRawWithRetry(
        connection: Connection,
        creatorAddress: string,
        tokenMint: string,
        postTokenBalances: any[],
    ): Promise<bigint> {
        const maxAttempts = Math.max(1, CONFIG.DEV_HOLDINGS_MAX_ATTEMPTS);
        const retryDelayMs = Math.max(0, CONFIG.DEV_HOLDINGS_RETRY_DELAY_MS);
        const maxDurationMs = Math.max(250, CONFIG.DEV_HOLDINGS_MAX_DURATION_MS);
        const startedAt = Date.now();
        let lastBalance = 0n;

        for (let i = 0; i < maxAttempts; i++) {
            if (Date.now() - startedAt > maxDurationMs) {
                throw new Error(`dev holdings check timed out after ${Date.now() - startedAt}ms`);
            }
            const bal = await getCreatorTokenBalanceRaw(connection, creatorAddress, tokenMint, postTokenBalances);
            lastBalance = bal;
            if (bal > 0n) return bal;
            if (i < maxAttempts - 1) {
                await new Promise((r) => setTimeout(r, retryDelayMs));
            }
        }

        return lastBalance;
    }

    async function runCheck(
        connection: Connection,
        creatorAddress: string,
        tokenMint: string,
        postTokenBalances: any[],
        ctx: string,
        enforceGate: boolean,
    ): Promise<boolean> {
        if (!CONFIG.ENFORCE_DEV_HOLDINGS_CHECK) {
            stageLog(ctx, "DEV", "holdings check disabled");
            return true;
        }

        const devCheckStart = Date.now();
        try {
            const creatorBalanceRaw = await getCreatorTokenBalanceRawWithRetry(connection, creatorAddress, tokenMint, postTokenBalances);
            const decimals = await deps.getMintDecimals(connection, new PublicKey(tokenMint));
            const totalSupplyRaw = 1_000_000_000n * (10n ** BigInt(decimals));

            const devPct = Number((creatorBalanceRaw * 10000n) / totalSupplyRaw) / 100;
            stageLog(ctx, "DEV", `holding ${creatorBalanceRaw.toString()} (${devPct.toFixed(2)}%)`);
            if (creatorBalanceRaw < 1n) {
                stageLog(ctx, "DEV", "creator wallet token balance is 0 after create_pool (can be normal)");
            }
            stageLog(ctx, "DEV", `check duration ${Date.now() - devCheckStart}ms`);

            if (devPct > CONFIG.MAX_DEV_HOLDINGS_PCT) {
                if (enforceGate) {
                    console.log(`🛑 SKIP: Dev holds too much (${devPct.toFixed(1)}% > ${CONFIG.MAX_DEV_HOLDINGS_PCT}%)`);
                    return false;
                }
                console.log(`⚠️ Dev holds too much (${devPct.toFixed(1)}% > ${CONFIG.MAX_DEV_HOLDINGS_PCT}%)`);
            }
            return true;
        } catch (e: any) {
            const reason = e?.message || String(e);
            const durationMs = Date.now() - devCheckStart;
            if (deps.monitorOnly && !enforceGate) {
                console.log(`⚠️ Dev check failed after ${durationMs}ms: ${reason}`);
                stageLog(ctx, "DEV", "check fail-open in MONITOR_ONLY");
                return true;
            }
            console.log(`🛑 SKIP: Dev check failed after ${durationMs}ms: ${reason}`);
            return false;
        }
    }

    return {
        runCheck,
    };
}
