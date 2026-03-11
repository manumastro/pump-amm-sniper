export function shortSig(sig: string): string {
    if (sig.length <= 14) return sig;
    return `${sig.slice(0, 6)}...${sig.slice(-6)}`;
}

export function pubkeyToBase58(value: any): string | null {
    if (!value) return null;
    if (typeof value === "string") return value;
    if (typeof value?.toBase58 === "function") {
        try {
            return value.toBase58();
        } catch {
            return null;
        }
    }
    if (value?.pubkey) {
        return pubkeyToBase58(value.pubkey);
    }
    return null;
}

export function instructionProgramIdToBase58(ix: any, accountKeys: any[]): string | null {
    if (ix?.programId) {
        const direct = pubkeyToBase58(ix.programId);
        if (direct) return direct;
    }
    if (typeof ix?.programIdIndex === "number") {
        return pubkeyToBase58(accountKeys[ix.programIdIndex]);
    }
    return null;
}

export function instructionAccountToBase58(accountRef: any, accountKeys: any[]): string | null {
    if (typeof accountRef === "number") {
        return pubkeyToBase58(accountKeys[accountRef]);
    }
    return pubkeyToBase58(accountRef);
}
