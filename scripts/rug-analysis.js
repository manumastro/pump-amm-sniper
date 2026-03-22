#!/usr/bin/env node
/**
 * Rug Analysis Script
 * Parses paper-report.json and generates a comprehensive table of rug losses
 * with all pre-entry filters and post-entry triggers.
 */

const fs = require('fs');
const path = require('path');

const REPORT_JSON = path.join(process.cwd(), 'logs', 'paper-report.json');

function loadReport() {
    if (!fs.existsSync(REPORT_JSON)) {
        console.error(`Report not found: ${REPORT_JSON}`);
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
}

function fmt(val, suffix = '') {
    if (val === null || val === undefined) return '-';
    if (typeof val === 'boolean') return val ? '✅' : '❌';
    return `${val}${suffix}`;
}

function boolIcon(val) {
    if (val === null || val === undefined) return '-';
    return val ? '✅' : '❌';
}

function printDivider(colWidths) {
    console.log(colWidths.map(w => '-'.repeat(w)).join('+'));
}

function main() {
    const data = loadReport();
    const rugs = data.rugPullEvents || [];

    if (rugs.length === 0) {
        console.log('No rug losses found.');
        return;
    }

    console.log(`\n📊 RUG ANALYSIS — ${rugs.length} rug loss(es)`);
    console.log(`Generated: ${data.generatedAt}`);
    console.log(`Total events: ${data.eventsSeen} | Checks passed: ${data.checksPassed} | Rug losses: ${data.rugLossCount}\n`);

    // ─── PRE-ENTRY TABLE ───
    console.log('═══ PRE-ENTRY FILTERS ═══\n');

    const preHeaders = ['Event', 'Liq', 'Top10', 'CP', 'Seed', 'Fresh', 'funderBL', 'precreate', 'funderCluster', 'allPassed', 'blocked'];
    const preWidths = [12, 8, 8, 8, 8, 8, 10, 10, 12, 10, 30];

    console.log(preHeaders.map((h, i) => h.padEnd(preWidths[i])).join(' | '));
    printDivider(preWidths);

    for (const e of rugs) {
        const ef = e.entryFilters || {};
        const cr_bl = ef.cr_funderBlacklisted || {};
        const cr_pb = ef.cr_precreateBurst || {};
        const cr_fc = ef.cr_funderCluster || {};
        const cr_seed = ef.cr_creatorSeed || {};
        const cr_fresh = ef.cr_freshFundedHighSeed || {};
        const cr_cp = ef.cr_uniqueCounterparties || {};
        const top10 = ef.top10 || {};
        const liq = ef.liquidity || {};

        const row = [
            e.id,
            boolIcon(liq.pass),
            boolIcon(top10.pass),
            boolIcon(cr_cp.pass),
            boolIcon(cr_seed.pass),
            boolIcon(cr_fresh.pass),
            cr_bl.inRugHistory === undefined ? '-' : (cr_bl.inRugHistory ? 'IN HISTORY' : 'new'),
            cr_pb.deepChecksComplete === undefined ? '-' :
                (cr_pb.triggered ? 'TRIGGERED' : (cr_pb.deepChecksComplete ? 'ok' : 'timeout')),
            cr_fc.historicalRugCount === undefined ? '-' :
                (cr_fc.triggered ? `h=${cr_fc.historicalRugCount} r=${cr_fc.recentCreatorCount}` : 'ok'),
            boolIcon(ef.cr_allPassed),
            ef.cr_entryBlocked || '-'
        ];

        console.log(row.map((v, i) => String(v).padEnd(preWidths[i])).join(' | '));
    }

    // ─── PRE-ENTRY DETAILS ───
    console.log('\n═══ PRE-ENTRY DETAILS (per rug) ═══\n');

    for (const e of rugs) {
        const ef = e.entryFilters || {};
        console.log(`--- ${e.id} (${e.tokenMint || '-'}) ---`);

        // Liquidity
        const liq = ef.liquidity || {};
        console.log(`  liquidity: ${fmt(liq.observed)} SOL (need >=${fmt(liq.threshold)}) ${boolIcon(liq.pass)}`);

        // Top10
        const top = ef.top10 || {};
        console.log(`  top10: ${fmt(top.observed)}% (need <=${fmt(top.threshold)}) ${boolIcon(top.pass)}`);

        // Creator risk summary
        console.log(`  cr_allPassed: ${boolIcon(ef.cr_allPassed)} | cr_entryBlocked: ${fmt(ef.cr_entryBlocked)}`);

        // The 3 key filters
        const cr_bl = ef.cr_funderBlacklisted || {};
        const cr_pb = ef.cr_precreateBurst || {};
        const cr_fc = ef.cr_funderCluster || {};

        console.log(`  funderBlacklisted: funder=${fmt(cr_bl.observed)} inRugHistory=${fmt(cr_bl.inRugHistory)} ${boolIcon(cr_bl.pass)}`);
        console.log(`  precreateBurst: deepChecksComplete=${fmt(cr_pb.deepChecksComplete)} transfers=${fmt(cr_pb.observedTransfers)}/${fmt(cr_pb.thresholdTransfers)} triggered=${fmt(cr_pb.triggered)} ${boolIcon(cr_pb.pass)}`);
        console.log(`  funderCluster: histRug=${fmt(cr_fc.historicalRugCount)}/${fmt(cr_fc.thresholdHistorical)} recentCreators=${fmt(cr_fc.recentCreatorCount)}/${fmt(cr_fc.thresholdRecent)} triggered=${fmt(cr_fc.triggered)} ${boolIcon(cr_fc.pass)}`);
        console.log('');
    }

    // ─── POST-ENTRY TABLE ───
    console.log('\n═══ POST-ENTRY HOLDLOG ═══\n');

    const postHeaders = ['Event', 'exitReason', 'holdMs', 'peakPnl%', 'winnerArmed', 'trailing', 'triggers fired'];
    const postWidths = [12, 20, 10, 10, 12, 10, 40];

    console.log(postHeaders.map((h, i) => h.padEnd(postWidths[i])).join(' | '));
    printDivider(postWidths);

    for (const e of rugs) {
        const lg = e.holdLog;
        const triggers = lg ? Object.entries(lg.triggers || {}).filter(([, v]) => v.triggered).map(([k]) => k) : [];

        const row = [
            e.id,
            lg ? lg.exitReason : '-',
            lg ? lg.actualDurationMs : '-',
            lg ? `${lg.peakPnlPct}%` : '-',
            lg ? boolIcon(lg.winnerArmed) : '-',
            lg ? boolIcon(lg.trailingActive) : '-',
            triggers.length > 0 ? triggers.join(', ') : '-'
        ];

        console.log(row.map((v, i) => String(v).padEnd(postWidths[i])).join(' | '));
    }

    // ─── POST-ENTRY GUARDS STATUS ───
    console.log('\n═══ POST-ENTRY GUARDS (per rug) ═══\n');

    for (const e of rugs) {
        const lg = e.holdLog;
        if (!lg) {
            console.log(`--- ${e.id}: no holdLog ---\n`);
            continue;
        }

        console.log(`--- ${e.id} (exit: ${lg.exitReason}, hold: ${lg.actualDurationMs}ms, peak: ${lg.peakPnlPct}%) ---`);

        // Triggers fired
        const triggers = lg.triggers || {};
        const fired = Object.entries(triggers).filter(([, v]) => v.triggered);
        if (fired.length > 0) {
            console.log('  TRIGGERS FIRED:');
            for (const [name, t] of fired) {
                console.log(`    [FIRED] ${name}: ${t.detail || '-'}`);
            }
        }

        // All guards
        const guards = lg.guards || {};
        console.log('  GUARDS:');
        for (const [name, g] of Object.entries(guards)) {
            const enabled = g.enabled ? 'ON' : 'OFF';
            const details = [];
            if (g.armPct !== undefined) details.push(`arm=${g.armPct}%`);
            if (g.trailingPct !== undefined) details.push(`trail=${g.trailingPct}%`);
            if (g.hardTpPct !== undefined) details.push(`TP=${g.hardTpPct}%`);
            if (g.dropPct !== undefined) details.push(`drop=${g.dropPct}%`);
            if (g.minHoldMs !== undefined) details.push(`minHold=${g.minHoldMs}ms`);
            console.log(`    ${name}: ${enabled}${details.length > 0 ? ' (' + details.join(', ') + ')' : ''}`);
        }
        console.log('');
    }

    // ─── SUMMARY ───
    console.log('═══ SUMMARY ═══\n');

    const withHoldLog = rugs.filter(r => r.holdLog);
    const withoutHoldLog = rugs.filter(r => !r.holdLog);
    const allFunderNew = rugs.every(r => {
        const ef = r.entryFilters || {};
        const cr_bl = ef.cr_funderBlacklisted || {};
        return cr_bl.inRugHistory === false;
    });
    const allPrecreateOk = rugs.every(r => {
        const ef = r.entryFilters || {};
        const cr_pb = ef.cr_precreateBurst || {};
        return !cr_pb.triggered;
    });
    const allClusterOk = rugs.every(r => {
        const ef = r.entryFilters || {};
        const cr_fc = ef.cr_funderCluster || {};
        return !cr_fc.triggered;
    });

    console.log(`Total rugs: ${rugs.length}`);
    console.log(`  With holdLog: ${withHoldLog.length} | Without: ${withoutHoldLog.length}`);
    console.log(`  All funders new (not in rug history): ${allFunderNew ? 'YES' : 'NO'}`);
    console.log(`  All precreate burst not triggered: ${allPrecreateOk ? 'YES' : 'NO'}`);
    console.log(`  All funder cluster not triggered: ${allClusterOk ? 'YES' : 'NO'}`);

    const exitReasons = {};
    for (const r of rugs) {
        const reason = r.holdLog?.exitReason || 'unknown';
        exitReasons[reason] = (exitReasons[reason] || 0) + 1;
    }
    console.log('\nExit reasons:');
    for (const [reason, count] of Object.entries(exitReasons)) {
        console.log(`  ${reason}: ${count}`);
    }
}

main();
