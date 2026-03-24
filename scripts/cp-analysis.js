#!/usr/bin/env node
/**
 * CP Analysis Script
 * Analyzes skipped tokens by CP value and shows good/bad outcomes.
 * Fetches prices from DexScreener to determine which CP values are worth keeping.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, 'logs', 'paper-report.json');

function loadReport() {
    if (!fs.existsSync(REPORT_JSON)) {
        console.error(`Report not found: ${REPORT_JSON}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
}

async function fetchPrices(tokens) {
    const results = {};
    const batchSize = 10;
    
    for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        const addresses = batch.join(',');
        const url = `https://api.dexscreener.com/latest/dex/tokens/${addresses}`;
        
        try {
            const resp = await fetch(url, {
                headers: { 'Accept': 'application/json' },
                signal: AbortSignal.timeout(15000)
            });
            
            if (resp.ok) {
                const data = await resp.json();
                for (const pair of (data.pairs || [])) {
                    const addr = pair.baseToken?.address;
                    if (addr && !results[addr]) {
                        results[addr] = {
                            symbol: pair.baseToken?.symbol || '?',
                            priceUsd: pair.priceUsd || null,
                            change24h: pair.priceChange?.h24 || null,
                            liquidityUsd: pair.liquidity?.usd || null,
                            marketCap: pair.fv || pair.fdv || null,
                        };
                    }
                }
            }
        } catch (err) {
            console.error(`  Fetch error: ${err.message}`);
        }
        
        if (i + batchSize < tokens.length) {
            await new Promise(r => setTimeout(r, 1200));
        }
    }
    
    return results;
}

function classifyOutcome(change, liq) {
    const c = parseFloat(change) || 0;
    const l = parseFloat(liq) || 0;
    
    if (l === 0) return '💀 dead';
    if (c <= -50) return '💀 dead';
    if (c <= -30) return '📉 heavy_loss';
    if (c <= -10) return '⚠️ loss';
    if (c <= 10) return '➖ flat';
    if (c <= 100) return '✅ gain';
    if (c <= 1000) return '🚀 big_gain';
    return '🌙 moon';
}

function shortMint(mint) {
    if (!mint) return '-';
    if (mint.length <= 12) return mint;
    return `${mint.slice(0, 6)}...${mint.slice(-6)}`;
}

async function main() {
    const data = loadReport();
    const ops = data.operations || [];
    
    // Group tokens by CP
    const cpTokens = {};
    
    for (const e of ops) {
        const sr = e.skipReason || '';
        if (!sr.includes('counterparties')) continue;
        
        // Match both formats: "low counterparties X < 10" and "unique counterparties X >= Y"
        const match = sr.match(/counterparties (\d+)/);
        if (!match) continue;
        
        const cp = parseInt(match[1]);
        const token = e.tokenMint;
        if (!token || token === 'None') continue;
        
        if (!cpTokens[cp]) cpTokens[cp] = new Set();
        cpTokens[cp].add(token);
    }
    
    // Convert sets to arrays
    const cpTokenArrays = {};
    for (const [cp, tokens] of Object.entries(cpTokens)) {
        cpTokenArrays[cp] = [...tokens];
    }
    
    const totalTokens = Object.values(cpTokenArrays).reduce((a, b) => a + b.length, 0);
    
    console.log(`\n📊 CC ANALYSIS`);
    console.log(`Report: ${data.generatedAt}`);
    console.log(`Total CC tokens: ${totalTokens}`);
    console.log(`CC values: ${Object.keys(cpTokenArrays).sort((a, b) => a - b).join(', ')}\n`);
    
    // Fetch prices for all tokens
    const allTokens = Object.values(cpTokenArrays).flat();
    console.log(`Fetching prices for ${allTokens.length} tokens...`);
    const prices = await fetchPrices(allTokens);
    console.log(`Found ${Object.keys(prices).length} prices\n`);
    
    // Analyze each CC value
    const cpStats = {};
    
    for (const [cp, tokens] of Object.entries(cpTokenArrays)) {
        let good = 0;
        let bad = 0;
        let noData = 0;
        const goodTokens = [];
        const badTokens = [];
        const tokenRows = [];
        
        for (const token of tokens) {
            const p = prices[token];
            if (!p) {
                noData++;
                continue;
            }
            
            const outcome = classifyOutcome(p.change24h, p.liquidityUsd);
            const change = p.change24h ? `${p.change24h > 0 ? '+' : ''}${parseFloat(p.change24h).toFixed(0)}%` : '?';
            const mcap = p.marketCap ? `$${(Number(p.marketCap) / 1000).toFixed(0)}K` : '-';
            const entry = `${p.symbol} (${change}, ${mcap})`;
            const liq = p.liquidityUsd ? `$${(Number(p.liquidityUsd) / 1000).toFixed(0)}K` : '-';

            tokenRows.push({
                token,
                symbol: p.symbol || '?',
                outcome,
                changeNum: Number.parseFloat(p.change24h) || 0,
                change,
                mcap,
                liq,
            });
            
            if (outcome.includes('gain') || outcome.includes('moon')) {
                good++;
                goodTokens.push(entry);
            } else if (outcome.includes('dead') || outcome.includes('loss')) {
                bad++;
                badTokens.push(entry);
            } else {
                // flat = neutral, count as neither good nor bad
            }
        }
        
        tokenRows.sort((a, b) => b.changeNum - a.changeNum);
        cpStats[cp] = { good, bad, noData, total: tokens.length, goodTokens, badTokens, tokenRows };
    }
    
    // Print summary table
    console.log('═══ CC vs GOOD/BAD SUMMARY ═══\n');
    console.log('CC  | Total | ✅ Good | 🔴 Bad | ❓ NoData | %Good | Risultato');
    console.log('----+-------+---------+--------+-----------+-------+----------');
    
    for (const cp of Object.keys(cpStats).sort((a, b) => a - b)) {
        const s = cpStats[cp];
        const withData = s.good + s.bad;
        const pctGood = withData > 0 ? (s.good / withData * 100).toFixed(0) : '?';
        const result = parseFloat(pctGood) >= 50 ? '✅ CONVIENE' : '❌ RISCHIOSO';
        
        console.log(
            `${cp.padEnd(3)}| ${String(s.total).padEnd(5)}| ${String(s.good).padEnd(7)}| ${String(s.bad).padEnd(6)}| ${String(s.noData).padEnd(9)}| ${pctGood.padEnd(5)}| ${result}`
        );
    }
    
    // Detailed breakdown for each CC with token lists
    console.log('\n═══ DETTAGLIO PER CC (TOKEN) ═══');
    
    for (const cp of Object.keys(cpStats).sort((a, b) => a - b)) {
        const s = cpStats[cp];
        console.log(`\nCC=${cp} (${s.total} token, ${s.good} good, ${s.bad} bad, ${s.noData} nodata):`);

        if (s.tokenRows.length > 0) {
            for (const row of s.tokenRows) {
                console.log(
                    `  - ${row.symbol.padEnd(10)} ${shortMint(row.token)} | ${row.change.padStart(7)} | liq ${row.liq.padStart(6)} | mcap ${row.mcap.padStart(6)} | ${row.outcome}`
                );
            }
        }
        
        if (s.goodTokens.length > 0) {
            console.log(`  ✅ Buoni: ${s.goodTokens.join(' | ')}`);
        }
        if (s.badTokens.length > 0) {
            console.log(`  🔴 Cattivi: ${s.badTokens.join(' | ')}`);
        }
        if (s.noData > 0) {
            console.log(`  ❓ No data: ${s.noData} token (likely rugged/removed)`);
        }
    }
    
    // Recommendation
    console.log('\n═══ RACCOMANDAZIONE ═══\n');
    
    const passable = [];
    const risky = [];
    
    for (const [cp, s] of Object.entries(cpStats)) {
        const withData = s.good + s.bad;
        if (withData === 0) continue;
        
        const pctGood = s.good / withData * 100;
        if (pctGood >= 50) {
            passable.push(`CC=${cp} (${pctGood.toFixed(0)}% good)`);
        } else {
            risky.push(`CC=${cp} (${pctGood.toFixed(0)}% good)`);
        }
    }
    
    if (passable.length > 0) {
        console.log(`✅ CC che CONVIENE far passare: ${passable.join(', ')}`);
    }
    if (risky.length > 0) {
        console.log(`❌ CC che conviene BLOCCARE: ${risky.join(', ')}`);
    }
    
    console.log('\n✅ Done');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
