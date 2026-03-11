export function toSubscriptDigits(value: number): string {
    const map = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];
    return String(value).split("").map((c) => (c >= "0" && c <= "9") ? map[Number(c)] : c).join("");
}

export function formatSolCompact(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "0 SOL";
    if (value >= 0.001) return `${value.toFixed(6)} SOL`;

    const s = value.toFixed(12);
    const frac = s.split(".")[1] || "";
    const firstNonZero = frac.search(/[1-9]/);
    if (firstNonZero <= 0) return `${value.toFixed(12)} SOL`;

    const zeros = firstNonZero;
    const significant = frac.slice(firstNonZero, firstNonZero + 4).replace(/0+$/, "") || "0";
    return `0.0${toSubscriptDigits(zeros)}${significant} SOL`;
}

export function formatSolDecimal(value: number): string {
    if (!Number.isFinite(value)) return "0.000000 SOL";
    return `${value.toFixed(6)} SOL`;
}

export function formatLiquiditySol(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return "0.000000";
    if (value >= 1) return value.toFixed(2);
    if (value >= 0.01) return value.toFixed(4);
    return value.toFixed(6);
}

export function formatQuoteMovePct(baseline: number, current: number): string {
    if (!Number.isFinite(baseline) || baseline <= 0 || !Number.isFinite(current)) {
        return "n/a";
    }
    const changePct = ((current - baseline) / baseline) * 100;
    if (Math.abs(changePct) < 0.005) return "flat 0.00%";
    if (changePct > 0) return `gain +${changePct.toFixed(2)}%`;
    return `drop ${Math.abs(changePct).toFixed(2)}%`;
}
