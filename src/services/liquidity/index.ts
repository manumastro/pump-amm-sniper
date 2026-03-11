import { CONFIG } from "../../app/config";
import { stageLog } from "../reporting/stageLog";
import { formatLiquiditySol } from "../../utils/format";

type LiquidityDeps = {
    getObserverPublicKey: () => any;
    fetchSwapState: (poolAddress: string, observerUser: any) => Promise<any | null>;
    getSolLiquidityFromState: (state: any, tokenMint: string) => number | null;
};

export function createLiquidityService(deps: LiquidityDeps) {
    async function recheckLowLiquidity(
        poolAddress: string,
        tokenMint: string,
        ctx: string,
        initialLiquiditySol: number,
    ): Promise<number> {
        if (!CONFIG.LOW_LIQUIDITY_RECHECK_ENABLED) return initialLiquiditySol;
        const windowMs = Math.max(0, CONFIG.LOW_LIQUIDITY_RECHECK_WINDOW_MS);
        const intervalMs = Math.max(100, CONFIG.LOW_LIQUIDITY_RECHECK_INTERVAL_MS);
        if (windowMs <= 0) return initialLiquiditySol;

        const observerUser = deps.getObserverPublicKey();
        const deadline = Date.now() + windowMs;
        let best = initialLiquiditySol;

        stageLog(ctx, "LIQ", `recheck window ${windowMs}ms (initial ${formatLiquiditySol(initialLiquiditySol)} SOL)`);
        while (Date.now() < deadline) {
            const state = await deps.fetchSwapState(poolAddress, observerUser);
            if (state) {
                const liq = deps.getSolLiquidityFromState(state, tokenMint);
                if (liq !== null && Number.isFinite(liq)) {
                    if (liq > best) best = liq;
                    if (liq >= CONFIG.MIN_POOL_LIQUIDITY_SOL) {
                        stageLog(ctx, "LIQ", `recheck passed at ${formatLiquiditySol(liq)} SOL`);
                        return liq;
                    }
                }
            }
            await new Promise((r) => setTimeout(r, intervalMs));
        }

        if (best > initialLiquiditySol) {
            stageLog(ctx, "LIQ", `recheck improved to ${formatLiquiditySol(best)} SOL`);
        }
        return best;
    }

    return {
        recheckLowLiquidity,
    };
}
