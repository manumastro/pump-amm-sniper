/**
 * Paper trade sulle curve stonk.fun.
 *
 * La posizione non si apre al tempo ne' al prezzo in dollari: si apre quando la raccolta
 * ATTRAVERSA una soglia, e si chiude quando ne attraversa un'altra. Sulla curva stonk
 * quella e' l'unica coordinata che conta, perche' il prezzo e' una funzione nota della
 * raccolta e non dipende dal token (docs/stonk-fun.md).
 *
 * Un attraversamento e' tale solo se la curva e' stata vista SOTTO la soglia prima di
 * superarla: incontrare una pool gia' al 30% non e' un ingresso all'1,5%.
 *
 * Su ogni ingresso si aprono piu' posizioni virtuali, una per ciascuna regola d'uscita in
 * prova: costano zero e fanno misurare tutte le uscite sulla stessa sessione invece che
 * una per sessione.
 */

import { CurvaStonk, prezzo, raccolta, tokenPerQuote, quotePerToken } from "./curva";

export type RegolaUscita = {
    /** etichetta nel report */
    nome: string;
    /** si esce quando la raccolta arriva qui */
    obiettivo: number;
    /** si esce anche se la raccolta ricade di questa frazione sotto l'ingresso */
    ricaduta: number;
    /** si esce comunque dopo questi millisecondi */
    scadenzaMs: number;
};

export type CostiCurva = {
    /** commissione di scambio, per lato (LaunchLab 1,25%) */
    scambioPerLato: number;
    /** tassa Token-2022 sui trasferimenti, per lato; 0 sui lanci standard */
    trasferimentoPerLato: number;
};

export type MotivoChiusura = "obiettivo" | "ricaduta" | "scadenza" | "migrata";

export type Posizione = {
    pool: string;
    mint: string;
    quoteMint: string;
    piattaforma: "reward" | "standard";
    regola: string;
    apertaIl: number;
    fIngresso: number;
    prezzoIngresso: number;
    quoteSpesa: number;
    tokenRicevuti: number;
    costi: CostiCurva;
    /** aggiornati a ogni campione finche' la posizione e' aperta */
    fMassima: number;
    fMassimaIl: number;
    fMinima: number;
    chiusa?: {
        il: number;
        fUscita: number;
        prezzoUscita: number;
        quoteIncassata: number;
        motivo: MotivoChiusura;
        rendimento: number;
    };
};

/** la parte di token che sopravvive alla tassa sui trasferimenti */
function netta(costi: CostiCurva): number {
    return 1 - costi.trasferimentoPerLato;
}

/**
 * Apre una posizione. La quantita' e' una frazione del bersaglio, non una cifra fissa:
 * i quote sono 21 asset diversi con scale che vanno da 11 a 31 milioni di unita', e solo
 * rapportandosi al bersaglio l'impatto sul prezzo resta lo stesso su tutti.
 */
export function apri(
    pool: string,
    c: CurvaStonk,
    regola: RegolaUscita,
    frazioneBersaglio: number,
    costi: CostiCurva,
    ora: number,
): Posizione {
    const quoteSpesa = c.bersaglio * frazioneBersaglio;
    const lordo = tokenPerQuote(c, quoteSpesa * (1 - costi.scambioPerLato));
    const f = raccolta(c);
    return {
        pool,
        mint: c.baseMint,
        quoteMint: c.quoteMint,
        piattaforma: c.piattaforma,
        regola: regola.nome,
        apertaIl: ora,
        fIngresso: f,
        prezzoIngresso: prezzo(c),
        quoteSpesa,
        tokenRicevuti: lordo * netta(costi),
        costi,
        fMassima: f,
        fMassimaIl: ora,
        fMinima: f,
    };
}

/** perche' questa posizione andrebbe chiusa adesso, o null se resta aperta */
export function motivoChiusura(
    p: Posizione,
    c: CurvaStonk,
    regola: RegolaUscita,
    ora: number,
): MotivoChiusura | null {
    if (c.stato === 2) return "migrata";
    const f = raccolta(c);
    if (f >= regola.obiettivo) return "obiettivo";
    if (f <= p.fIngresso - regola.ricaduta) return "ricaduta";
    if (ora - p.apertaIl >= regola.scadenzaMs) return "scadenza";
    return null;
}

/** aggiorna i massimi/minimi di una posizione aperta */
export function segui(p: Posizione, c: CurvaStonk, ora: number): void {
    const f = raccolta(c);
    if (f > p.fMassima) { p.fMassima = f; p.fMassimaIl = ora; }
    if (f < p.fMinima) p.fMinima = f;
}

/** chiude la posizione ai prezzi correnti della curva */
export function chiudi(
    p: Posizione,
    c: CurvaStonk,
    motivo: MotivoChiusura,
    ora: number,
): Posizione {
    const inviati = p.tokenRicevuti * netta(p.costi);
    const lordo = quotePerToken(c, inviati);
    const quoteIncassata = lordo * (1 - p.costi.scambioPerLato);
    p.chiusa = {
        il: ora,
        fUscita: raccolta(c),
        prezzoUscita: prezzo(c),
        quoteIncassata,
        motivo,
        rendimento: p.quoteSpesa > 0 ? quoteIncassata / p.quoteSpesa - 1 : 0,
    };
    return p;
}
