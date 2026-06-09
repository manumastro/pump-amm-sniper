#!/usr/bin/env node
/**
 * Skip Analysis Script
 * Fetches prices for all skipped tokens and generates a comprehensive analysis table.
 * Saves results to logs/skip-analysis.json for longitudinal tracking.
 */

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const REPORT_JSON = path.join(ROOT, 'logs', 'paper-report.json');
const HISTORY_JSON = path.join(ROOT, 'logs', 'skip-analysis-history.json');
const FETCH_LOG = path.join(ROOT, 'logs', 'skip-analysis-fetch.log');

function writeFetchLog(msg) {
    const ts = new Date().toISOString();
    const line = `[${ts}] ${msg}\n`;
    fs.appendFileSync(FETCH_LOG, line);
}

function loadReport() {
    if (!fs.existsSync(REPORT_JSON)) {
        console.error(`Report not found: ${REPORT_JSON}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
}

function loadHistory() {
    if (fs.existsSync(HISTORY_JSON)) {
        try {
            return JSON.parse(fs.readFileSync(HISTORY_JSON, 'utf8'));
        } catch { return []; }
    }
    return [];
}

function saveHistory(history) {
    fs.writeFileSync(HISTORY_JSON, JSON.stringify(history, null, 2));
}

function categorize(reason) {
    if (!reason) return 'unknown';
    const r = reason.toLowerCase();
    if (r.includes('low counterparties')) return 'low_cp';
    if (r.includes('token') && r.includes('safe')) return 'token_security';
    if (r.includes('no wsol')) return 'no_wsol';
    if (r.includes('amm re-entry')) return 'amm_reentry';
    if (r.includes('cashout')) return 'cashout';
    if (r.includes('seed too small')) return 'seed_small';
    if (r.includes('funder blacklisted')) return 'funder_blacklisted';
    if (r.includes('spray')) return 'spray_outbound';
    if (r.includes('compressed')) return 'compressed';
    if (r.includes('creator risk')) return 'creator_risk_other';
    return 'other';
}

async function fetchPrices(tokens) {
    const results = {};
    const batchSize = 10;
    const notFoundTokens = [];
    let rateLimitCount = 0;
    let errorCount = 0;
    let successCount = 0;
    
    // Clear old log
    if (fs.existsSync(FETCH_LOG)) fs.unlinkSync(FETCH_LOG);
    writeFetchLog(`Starting fetch for ${tokens.length} tokens in ${Math.ceil(tokens.length/batchSize)} batches`);
    
    for (let i = 0; i < tokens.length; i += batchSize) {
        const batch = tokens.slice(i, i + batchSize);
        const addresses = batch.join(',');
        const batchNum = Math.floor(i/batchSize) + 1;
        const totalBatches = Math.ceil(tokens.length/batchSize);
        const url = `https://api.dexscreener.com/latest/dex/tokens/${addresses}`;
        
        let lastError = null;
        let retries = 0;
        const maxRetries = 3;
        
        while (retries <= maxRetries) {
            try {
                const resp = await fetch(url, {
                    headers: { 'Accept': 'application/json' },
                    signal: AbortSignal.timeout(15000)
                });
                
                if (resp.status === 429) {
                    rateLimitCount++;
                    const waitMs = Math.pow(2, retries) * 2000; // exponential backoff: 2s, 4s, 8s
                    writeFetchLog(`Batch ${batchNum}/${totalBatches}: RATE LIMITED (429) - retry ${retries+1}/${maxRetries} after ${waitMs}ms`);
                    console.log(`  ⚠️  Rate limited on batch ${batchNum}, waiting ${waitMs/1000}s...`);
                    await new Promise(r => setTimeout(r, waitMs));
                    retries++;
                    continue;
                }
                
                if (!resp.ok) {
                    errorCount++;
                    writeFetchLog(`Batch ${batchNum}/${totalBatches}: HTTP ${resp.status} ${resp.statusText}`);
                    console.error(`  ❌ Batch ${batchNum}: HTTP ${resp.status}`);
                    break;
                }
                
                const data = await resp.json();
                const pairs = data.pairs || [];
                const foundAddrs = new Set(pairs.map(p => p.baseToken?.address));
                
                // Track which tokens were found vs not found
                for (const addr of batch) {
                    if (!foundAddrs.has(addr)) {
                        notFoundTokens.push(addr);
                        writeFetchLog(`Token not found: ${addr.substring(0, 12)}...`);
                    }
                }
                
                for (const pair of pairs) {
                    const addr = pair.baseToken?.address;
                    if (!results[addr]) {
                        successCount++;
                        results[addr] = {
                            symbol: pair.baseToken?.symbol || '?',
                            name: pair.baseToken?.name || '?',
                            priceUsd: pair.priceUsd || null,
                            change24h: pair.priceChange?.h24 || null,
                            liquidityUsd: pair.liquidity?.usd || null,
                            marketCap: pair.fv || pair.fdv || null,
                            volume24h: pair.volume?.h24 || null,
                            dexId: pair.dexId || '?',
                        };
                    }
                }
                
                writeFetchLog(`Batch ${batchNum}/${totalBatches}: OK - ${pairs.length} pairs found for ${batch.length} tokens`);
                break; // success, exit retry loop
                
            } catch (err) {
                lastError = err;
                if (err.name === 'AbortError' || err.message.includes('timeout')) {
                    writeFetchLog(`Batch ${batchNum}/${totalBatches}: TIMEOUT - retry ${retries+1}/${maxRetries}`);
                    retries++;
                    await new Promise(r => setTimeout(r, 2000));
                } else if (err.message.includes('429') || err.message.includes('rate')) {
                    rateLimitCount++;
                    writeFetchLog(`Batch ${batchNum}/${totalBatches}: RATE LIMIT ERROR - ${err.message}`);
                    retries++;
                    await new Promise(r => setTimeout(r, 3000));
                } else {
                    errorCount++;
                    writeFetchLog(`Batch ${batchNum}/${totalBatches}: ERROR - ${err.message}`);
                    console.error(`  ❌ Batch ${batchNum}: ${err.message}`);
                    break;
                }
            }
        }
        
        if (retries > maxRetries && lastError) {
            errorCount++;
            writeFetchLog(`Batch ${batchNum}/${totalBatches}: FAILED after ${maxRetries} retries`);
            console.error(`  ❌ Batch ${batchNum}: Failed after ${maxRetries} retries`);
        }
        
        // Rate limit delay between batches
        if (i + batchSize < tokens.length) {
            await new Promise(r => setTimeout(r, 1200));
        }
    }
    
    // Summary
    writeFetchLog(`\n=== FETCH SUMMARY ===`);
    writeFetchLog(`Total tokens requested: ${tokens.length}`);
    writeFetchLog(`Prices found: ${Object.keys(results).length}`);
    writeFetchLog(`Not found on DexScreener: ${notFoundTokens.length}`);
    writeFetchLog(`Rate limit hits: ${rateLimitCount}`);
    writeFetchLog(`Other errors: ${errorCount}`);
    
    console.log(`\n  📊 Fetch summary: ${Object.keys(results).length}/${tokens.length} prices, ${notFoundTokens.length} not found, ${rateLimitCount} rate limits, ${errorCount} errors`);
    console.log(`  📄 Detailed log: ${FETCH_LOG}`);
    
    return results;
}

function classifyOutcome(price, liq, change) {
    if (price === null || price === undefined) return 'no_data';
    const p = parseFloat(price);
    const l = parseFloat(liq) || 0;
    const c = parseFloat(change) || 0;
    
    if (l === 0 && c < -50) return 'dead';
    if (l === 0) return 'rug_suspect';
    if (c <= -70) return 'heavy_loss';
    if (c <= -30) return 'loss';
    if (c <= 10) return 'flat';
    if (c <= 100) return 'gain';
    if (c <= 1000) return 'big_gain';
    return 'moon';
}

const OUTCOME_ICONS = {
    no_data: '❓',
    dead: '💀',
    rug_suspect: '🔴',
    heavy_loss: '📉',
    loss: '⚠️',
    flat: '➖',
    gain: '✅',
    big_gain: '🚀',
    moon: '🌙',
};

async function main() {
    const data = loadReport();
    const history = loadHistory();
    const ops = data.operations || [];
    
    // Collect all skipped tokens
    const seen = new Set();
    const tokens = [];
    
    for (const e of ops) {
        const sr = e.skipReason || '';
        const status = e.endStatus || '';
        if (!sr && !status.includes('SKIP')) continue;
        
        const token = e.tokenMint;
        if (!token || token === 'None' || seen.has(token)) continue;
        seen.add(token);
        
        const reason = sr || status;
        tokens.push({
            id: e.id,
            token,
            category: categorize(reason),
            reason: reason.substring(0, 80),
            startedAt: e.startedAt,
        });
    }
    
    console.log(`\n📊 SKIP ANALYSIS — ${tokens.length} unique tokens`);
    console.log(`Report: ${data.generatedAt}`);
    console.log(`Total events: ${data.eventsSeen} | Skipped: ${data.skipped}\n`);
    
    if (tokens.length === 0) {
        console.log('No skipped tokens found.');
        return;
    }
    
    // Fetch prices
    console.log('Fetching prices from DexScreener...');
    const tokenAddrs = tokens.map(t => t.token);
    const prices = await fetchPrices(tokenAddrs);
    console.log(`Found price data for ${Object.keys(prices).length} tokens\n`);
    
    // Build enriched results
    const enriched = tokens.map(t => {
        const p = prices[t.token] || {};
        const outcome = classifyOutcome(p.priceUsd, p.liquidityUsd, p.change24h);
        return {
            ...t,
            symbol: p.symbol || '?',
            priceUsd: p.priceUsd || null,
            change24h: p.change24h || null,
            liquidityUsd: p.liquidityUsd || null,
            marketCap: p.marketCap || null,
            dexId: p.dexId || null,
            outcome,
        };
    });
    
    // Save to history
    const snapshot = {
        timestamp: new Date().toISOString(),
        eventsSeen: data.eventsSeen,
        tokens: enriched.map(e => ({
            token: e.token,
            symbol: e.symbol,
            category: e.category,
            outcome: e.outcome,
            priceUsd: e.priceUsd,
            change24h: e.change24h,
            liquidityUsd: e.liquidityUsd,
        })),
    };
    history.push(snapshot);
    // Keep last 50 snapshots
    while (history.length > 50) history.shift();
    saveHistory(history);
    
    // ─── GROUP BY CATEGORY ───
    const categories = {};
    for (const e of enriched) {
        if (!categories[e.category]) categories[e.category] = [];
        categories[e.category].push(e);
    }
    
    const CAT_LABELS = {
        low_cp: 'LOW CP (<10)',
        token_security: 'TOKEN SECURITY',
        no_wsol: 'NO WSOL SIDE',
        amm_reentry: 'AMM RE-ENTRY',
        cashout: 'CASHOUT',
        seed_small: 'SEED TOO SMALL',
        funder_blacklisted: 'FUNDER BLACKLISTED',
        spray_outbound: 'SPRAY OUTBOUND',
        compressed: 'COMPRESSED ACTIVITY',
        creator_risk_other: 'CREATOR RISK (OTHER)',
        other: 'OTHER',
    };
    
    // ─── PRINT TABLES ───
    for (const [cat, items] of Object.entries(categories).sort((a, b) => b[1].length - a[1].length)) {
        const label = CAT_LABELS[cat] || cat;
        console.log(`\n═══ ${label} (${items.length} tokens) ═══\n`);
        console.log('Symbol'.padEnd(15) + ' | ' +
                    'Price'.padEnd(12) + ' | ' +
                    '24h%'.padEnd(10) + ' | ' +
                    'Liquidity'.padEnd(12) + ' | ' +
                    'MCap'.padEnd(12) + ' | ' +
                    'Outcome'.padEnd(15) + ' | ' +
                    'DEX');
        console.log('-'.repeat(15) + '-+-' +
                    '-'.repeat(12) + '-+-' +
                    '-'.repeat(10) + '-+-' +
                    '-'.repeat(12) + '-+-' +
                    '-'.repeat(12) + '-+-' +
                    '-'.repeat(15) + '-+-' +
                    '-'.repeat(10));
        
        for (const e of items) {
            const icon = OUTCOME_ICONS[e.outcome] || '❓';
            console.log(
                (e.symbol || '?').substring(0, 15).padEnd(15) + ' | ' +
                (e.priceUsd ? `$${parseFloat(e.priceUsd).toFixed(8)}` : '-').padEnd(12) + ' | ' +
                (e.change24h !== null ? `${e.change24h > 0 ? '+' : ''}${parseFloat(e.change24h).toFixed(1)}%` : '-').padEnd(10) + ' | ' +
                (e.liquidityUsd ? `$${Number(e.liquidityUsd).toLocaleString()}` : '-').padEnd(12) + ' | ' +
                (e.marketCap ? `$${Number(e.marketCap).toLocaleString()}` : '-').padEnd(12) + ' | ' +
                `${icon} ${e.outcome}`.padEnd(15) + ' | ' +
                (e.dexId || '-')
            );
        }
    }
    
    // ─── SUMMARY STATS ───
    console.log('\n═══ SUMMARY BY CATEGORY ═══\n');
    console.log('Category'.padEnd(20) + ' | ' +
                'Count'.padEnd(6) + ' | ' +
                'Dead/Rug'.padEnd(10) + ' | ' +
                'Loss'.padEnd(8) + ' | ' +
                'Flat'.padEnd(8) + ' | ' +
                'Gain'.padEnd(8) + ' | ' +
                'Moon'.padEnd(8) + ' | ' +
                'No Data');
    console.log('-'.repeat(20) + '-+-' +
                '-'.repeat(6) + '-+-' +
                '-'.repeat(10) + '-+-' +
                '-'.repeat(8) + '-+-' +
                '-'.repeat(8) + '-+-' +
                '-'.repeat(8) + '-+-' +
                '-'.repeat(8));
    
    for (const [cat, items] of Object.entries(categories).sort((a, b) => b[1].length - a[1].length)) {
        const label = (CAT_LABELS[cat] || cat).substring(0, 20);
        const total = items.length;
        const dead = items.filter(i => ['dead', 'rug_suspect'].includes(i.outcome)).length;
        const loss = items.filter(i => ['heavy_loss', 'loss'].includes(i.outcome)).length;
        const flat = items.filter(i => i.outcome === 'flat').length;
        const gain = items.filter(i => ['gain', 'big_gain'].includes(i.outcome)).length;
        const moon = items.filter(i => i.outcome === 'moon').length;
        const noData = items.filter(i => i.outcome === 'no_data').length;
        
        console.log(
            label.padEnd(20) + ' | ' +
            String(total).padEnd(6) + ' | ' +
            String(dead).padEnd(10) + ' | ' +
            String(loss).padEnd(8) + ' | ' +
            String(flat).padEnd(8) + ' | ' +
            String(gain).padEnd(8) + ' | ' +
            String(moon).padEnd(8) + ' | ' +
            String(noData)
        );
    }
    
    // ─── TOTAL STATS ───
    const all = enriched;
    console.log('\n═══ TOTAL STATS ═══\n');
    console.log(`Total tokens analyzed: ${all.length}`);
    console.log(`Dead/Rug: ${all.filter(i => ['dead', 'rug_suspect'].includes(i.outcome)).length} (${(all.filter(i => ['dead', 'rug_suspect'].includes(i.outcome)).length / all.length * 100).toFixed(1)}%)`);
    console.log(`Loss: ${all.filter(i => ['heavy_loss', 'loss'].includes(i.outcome)).length} (${(all.filter(i => ['heavy_loss', 'loss'].includes(i.outcome)).length / all.length * 100).toFixed(1)}%)`);
    console.log(`Flat: ${all.filter(i => i.outcome === 'flat').length} (${(all.filter(i => i.outcome === 'flat').length / all.length * 100).toFixed(1)}%)`);
    console.log(`Gain: ${all.filter(i => ['gain', 'big_gain'].includes(i.outcome)).length} (${(all.filter(i => ['gain', 'big_gain'].includes(i.outcome)).length / all.length * 100).toFixed(1)}%)`);
    console.log(`Moon: ${all.filter(i => i.outcome === 'moon').length} (${(all.filter(i => i.outcome === 'moon').length / all.length * 100).toFixed(1)}%)`);
    console.log(`No data: ${all.filter(i => i.outcome === 'no_data').length}`);
    
    // ─── FILTER EFFECTIVENESS ───
    console.log('\n═══ FILTER EFFECTIVENESS ═══\n');
    for (const [cat, items] of Object.entries(categories).sort((a, b) => b[1].length - a[1].length)) {
        const label = (CAT_LABELS[cat] || cat).padEnd(20);
        const withData = items.filter(i => i.outcome !== 'no_data');
        const bad = withData.filter(i => ['dead', 'rug_suspect', 'heavy_loss', 'loss'].includes(i.outcome));
        const rate = withData.length > 0 ? (bad.length / withData.length * 100).toFixed(1) : 'N/A';
        const saved = withData.filter(i => ['dead', 'rug_suspect'].includes(i.outcome)).length;
        console.log(`${label} | ${withData.length} with data | ${rate}% bad outcome | ${saved} rugs avoided`);
    }
    
    // ─── NO DATA ANALYSIS ───
    const noDataTokens = all.filter(i => i.outcome === 'no_data');
    if (noDataTokens.length > 0) {
        console.log('\n═══ NO DATA ANALYSIS ═══\n');
        console.log(`${noDataTokens.length} tokens have no price data. Possible reasons:`);
        console.log('  - Token was rug pulled and removed from DexScreener');
        console.log('  - Token never had liquidity (instant rug)');
        console.log('  - Token contract was renounced/invalidated');
        console.log('  - Rate limiting during fetch (check logs/skip-analysis-fetch.log)');
        console.log('\nNo data by category:');
        for (const [cat, items] of Object.entries(categories)) {
            const nd = items.filter(i => i.outcome === 'no_data');
            if (nd.length > 0) {
                console.log(`  ${(CAT_LABELS[cat] || cat).padEnd(20)}: ${nd.length} tokens`);
            }
        }
    }
    
    // ─── GAIN/MOON BLOCKED BY FILTER ───
    const gainMoon = enriched.filter(i => ['gain', 'big_gain', 'moon'].includes(i.outcome));
    const gainMoonBlocked = gainMoon.filter(i => i.outcome !== 'no_data');
    
    console.log('\n═══ GAIN/MOON BLOCKED BY FILTER ═══\n');
    
    if (gainMoonBlocked.length > 0) {
        // Group by filter category
        const byFilter = {};
        for (const t of gainMoonBlocked) {
            if (!byFilter[t.category]) byFilter[t.category] = [];
            byFilter[t.category].push(t);
        }
        
        console.log('Filter'.padEnd(20) + ' | ' + 'Count'.padEnd(6) + ' | ' + 'Tokens (change24h, mcap)');
        console.log('-'.repeat(20) + '-+-' + '-'.repeat(6) + '-+-' + '-'.repeat(60));
        
        for (const [cat, items] of Object.entries(byFilter).sort((a, b) => b[1].length - a[1].length)) {
            const label = (CAT_LABELS[cat] || cat).padEnd(20);
            const count = String(items.length).padEnd(6);
            const details = items.map(i => {
                const change = i.change24h ? `${i.change24h > 0 ? '+' : ''}${parseFloat(i.change24h).toFixed(0)}%` : '?';
                const mcap = i.marketCap ? `$${Number(i.marketCap).toLocaleString()}` : '-';
                return `${i.symbol} (${change}, ${mcap})`;
            }).join(', ');
            console.log(`${label} | ${count} | ${details}`);
        }
        
        console.log(`\nTotal gain/moon tokens SKIPPED: ${gainMoonBlocked.length}`);
        console.log('These tokens could have been captured if the filter was disabled.');
    } else {
        console.log('No gain/moon tokens were skipped.');
    }
    
    console.log('\n✅ Analysis saved to logs/skip-analysis-history.json');
    console.log('📄 Fetch log: logs/skip-analysis-fetch.log');
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
