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
        const startedAtMs = Date.now();
        const deadline = startedAtMs + windowMs;
        let best = initialLiquiditySol;

        // Traiettoria della curva durante la finestra. Su una bonding curve il livello di
        // liquidita e uno stock che parte da zero per tutti: quello che distingue un token a
        // pochi secondi di vita non e quanta SOL c'e dentro, ma quanto in fretta sta arrivando.
        // I campioni li stiamo gia pagando (16 in 5s a 300ms), tenerli costa zero chiamate.
        // Vedi docs/controls.md 39.
        const pathT: number[] = [0];
        const pathQ: number[] = [Number(initialLiquiditySol.toFixed(9))];
        const emitPath = (esito: string) => {
            if (pathT.length < 2) return;
            const durata = pathT[pathT.length - 1] / 1000;
            const delta = pathQ[pathQ.length - 1] - pathQ[0];
            stageLog(ctx, "LIQPATH", JSON.stringify({
                esito,
                initialSol: pathQ[0],
                finalSol: pathQ[pathQ.length - 1],
                bestSol: Number(Math.max(...pathQ).toFixed(9)),
                // pendenza media in SOL/s: il segnale di momentum vero e proprio
                slopeSolPerSec: durata > 0 ? Number((delta / durata).toFixed(9)) : 0,
                windowMs,
                t: pathT,
                q: pathQ,
            }));
        };

        stageLog(ctx, "LIQ", `recheck window ${windowMs}ms (initial ${formatLiquiditySol(initialLiquiditySol)} SOL)`);
        while (Date.now() < deadline) {
            const state = await deps.fetchSwapState(poolAddress, observerUser);
            if (state) {
                const liq = deps.getSolLiquidityFromState(state, tokenMint);
                if (liq !== null && Number.isFinite(liq)) {
                    pathT.push(Date.now() - startedAtMs);
                    pathQ.push(Number(liq.toFixed(9)));
                    if (liq > best) best = liq;
                    if (liq >= CONFIG.MIN_POOL_LIQUIDITY_SOL) {
                        stageLog(ctx, "LIQ", `recheck passed at ${formatLiquiditySol(liq)} SOL`);
                        emitPath("passato");
                        return liq;
                    }
                }
            }
            await new Promise((r) => setTimeout(r, intervalMs));
        }

        if (best > initialLiquiditySol) {
            stageLog(ctx, "LIQ", `recheck improved to ${formatLiquiditySol(best)} SOL`);
        }
        emitPath("sotto_soglia");
        return best;
    }

    return {
        recheckLowLiquidity,
    };
}
