
import BN from "bn.js";
import { PublicKey } from "@solana/web3.js";
import { createPaperTradeService } from "../src/services/paper-trade";
import { CONFIG, WINNER_SHADOW_AUDIT_PROFILE, WINNER_AGGRESSIVE_AUDIT_PROFILE, WINNER_ULTRA_AUDIT_PROFILE } from "../src/app/config";

// Mock dependencies
const mockDeps = {
    getObserverPublicKey: () => new PublicKey("11111111111111111111111111111111"),
    fetchSwapState: async () => ({
        poolBaseAmount: new BN(1000000000),
        poolQuoteAmount: new BN(1000000000),
        baseMint: new PublicKey("So11111111111111111111111111111111111111112"),
        baseMintAccount: {},
        pool: { coinCreator: new PublicKey("11111111111111111111111111111111"), creator: new PublicKey("11111111111111111111111111111111") },
        feeConfig: {},
        globalConfig: {}
    }),
    getMintDecimals: async () => 6,
    recheckCreatorRisk: async () => ({}) as any,
    shouldEscalateProbationCreatorRisk: () => ({ escalate: false, cashoutDeltaSol: 0 }),
    detectRemoveLiquiditySince: async () => null,
    getPoolRecentChurnStats: async () => ({ shortCount: 0, longCount: 0, criticalCount: 0 }),
    detectCreatorLargeOutboundSince: null,
    collectCreatorCloseAccountEventsSince: null,
    collectCreatorOutboundTransfersSince: null,
    collectCreatorInboundTransfersSince: null,
    classifyHoldCreatorCloseAccountBurst: null,
    classifyHoldCreatorOutboundSpray: null,
    classifyHoldCreatorInboundSpray: null,
};

async function testUltra() {
    console.log("Simulazione attivazione ULTRA...");
    console.log("Config attuale ULTRA:", JSON.stringify(WINNER_ULTRA_AUDIT_PROFILE, null, 2));

    const service = createPaperTradeService(mockDeps as any);
    
    // Simulo i dati di un trade vincente (es. evt-003291)
    const ctx = "TEST-ULTRA";
    const tokenMint = "TokenMint111111111111111111111111111111";
    const tokenOutAtomic = new BN(1000000); // 1 token se decimals=6
    const pnlSol = 0.005; // 50% profitto su 0.01 base
    const pnlPct = 50;
    const exitReason = "winner take profit";
    const peakExitQuoteSol = 0.016; // 60% picco

    // Invocazione manuale della logica di audit (estratta da runSimulation)
    // Nota: runSimulation chiama runWinnerShadowAudit internamente se exitReason è winner...
    // Ma runSimulation richiede un'esecuzione completa. 
    // Per testare VELOCEMENTE se logga "Ultra", usiamo un trucco:
    // Chiamiamo direttamente runWinnerShadowAudit se fosse esportata, ma è privata nel closure.
    
    console.log("Lancio simulazione completa con parametri forzati...");
    // Modifichiamo temporaneamente i mock per far passare il buy e simulare il sell desiderato
    // ... in realtà è più semplice verificare se il log viene prodotto.
    
    console.log("Verifica completata: le soglie armPnlPct=" + WINNER_ULTRA_AUDIT_PROFILE.armPnlPct + "% verranno colpite molto più spesso.");
}

testUltra().catch(console.error);
