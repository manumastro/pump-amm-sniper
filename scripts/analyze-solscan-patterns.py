#!/usr/bin/env python3
"""
Analyze rug patterns from Solscan parser JSON output.

This script:
1. Loads Solscan JSON files from rug_analysis/ directory
2. Parses transaction/transfer/activity data
3. Detects funding patterns (micro transfers, relay funding, timing)
4. Compares with paper-report.json to validate pattern detection

Usage:
    python scripts/analyze-solscan-patterns.py [--solscan-dir rug_analysis] [--report logs/paper-report.json]

Pattern Detection:
    - Micro transfers: multiple small transfers from different sources
    - Relay funding: asymmetric in/out cash flow through relayers
    - Timing: window between funding and pool create/rug
"""

import json
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Tuple, Set
from datetime import datetime
import re

def parse_timestamp(ts_str: str) -> int:
    """Parse Solscan timestamp and return unix timestamp."""
    try:
        # Format: "22:08:18 Mar 19, 2026" (UTC implied in Solscan)
        dt = datetime.strptime(ts_str.strip(), "%H:%M:%S %b %d, %Y")
        return int(dt.timestamp())
    except:
        return 0

def extract_amount(text: str) -> float:
    """Extract SOL amount from transaction text."""
    # Look for patterns like "89.15" followed by nothing or operation type
    match = re.search(r'(\d+\.?\d*)\s*(?:SOL)?(?:\s|$)', text)
    if match:
        try:
            return float(match.group(1))
        except:
            return 0.0
    return 0.0

def analyze_solscan_file(filepath: str) -> Dict:
    """
    Analyze a single Solscan JSON file.
    
    Returns dict with detected patterns.
    """
    with open(filepath) as f:
        data = json.load(f)
    
    creator = data.get('account', '')
    results = data.get('results', {}).get('creator', {})
    
    # Extract transactions
    transactions = results.get('Transactions', {}).get('rows_seen', [])
    transfers = results.get('Transfers', {}).get('rows_seen', [])
    
    # Analyze transfers for micro-transfer pattern
    inbound_transfers = []
    outbound_transfers = []
    
    for transfer in transfers:
        text = transfer.get('text', '')
        # Basic parsing: look for From/To patterns
        if 'From' in text or 'To' in text:
            amount = extract_amount(text)
            if amount > 0:
                # Assume format with From -> inbound, To -> outbound
                if 'To' in text:
                    outbound_transfers.append(amount)
                else:
                    inbound_transfers.append(amount)
    
    # Analyze transactions for relay/timing patterns
    remove_liq_events = []
    sell_events = []
    buy_events = []
    create_pool_event = None
    
    for tx in transactions:
        text = tx.get('text', '')
        ts = tx.get('timestamp_utc', '')
        
        if 'Liquidity: Remove' in text:
            remove_liq_events.append(ts)
        elif 'AMM: Sell' in text:
            sell_events.append(ts)
        elif 'AMM: Buy' in text:
            buy_events.append(ts)
        elif 'Create Pool' in text:
            create_pool_event = ts
    
    # Detect patterns
    micro_transfer_count = len(inbound_transfers)
    micro_sources = len(set(inbound_transfers))  # Rough estimate
    
    has_quick_remove_sell = False
    if remove_liq_events and sell_events:
        # Check if remove_liq and sell happened close together
        has_quick_remove_sell = True  # Simplified check
    
    return {
        'creator': creator,
        'file': Path(filepath).name,
        'inbound_transfers': inbound_transfers,
        'outbound_transfers': outbound_transfers,
        'total_inbound': sum(inbound_transfers),
        'total_outbound': sum(outbound_transfers),
        'inbound_count': len(inbound_transfers),
        'outbound_count': len(outbound_transfers),
        'remove_liq_events': len(remove_liq_events),
        'sell_events': len(sell_events),
        'buy_events': len(buy_events),
        'has_quick_remove_sell': has_quick_remove_sell,
        'micro_transfers': micro_transfer_count,
        'micro_sources': micro_sources,
    }

def compare_with_paper_report(solscan_analysis: Dict, paper_report: Dict) -> Dict:
    """
    Compare Solscan analysis with paper-report data.
    
    Returns comparison dict.
    """
    # Extract token/creator from Solscan
    creator = solscan_analysis.get('creator', '')
    
    # Find matching event in paper report by creator
    matching_event = None
    for evt in paper_report.get('operations', []):
        if creator in evt.get('signature', ''):
            matching_event = evt
            break
    
    if not matching_event:
        # Try by token
        token = solscan_analysis.get('token', '')
        for evt in paper_report.get('operations', []):
            if evt.get('tokenMint', '') == token:
                matching_event = evt
                break
    
    return {
        'solscan_file': solscan_analysis.get('file'),
        'found_in_report': matching_event is not None,
        'event_id': matching_event.get('id') if matching_event else None,
        'solscan_micro_transfers': solscan_analysis.get('micro_transfers'),
        'solscan_micro_sources': solscan_analysis.get('micro_sources'),
        'report_micro_transfers': matching_event.get('creatorRiskMicroTransfers') if matching_event else None,
        'report_micro_sources': matching_event.get('creatorRiskMicroSources') if matching_event else None,
        'solscan_total_inbound': solscan_analysis.get('total_inbound'),
        'solscan_total_outbound': solscan_analysis.get('total_outbound'),
        'report_relay_inbound': matching_event.get('relayFundingInboundSol') if matching_event else None,
        'report_relay_outbound': matching_event.get('relayFundingOutboundSol') if matching_event else None,
        'solscan_quick_remove_sell': solscan_analysis.get('has_quick_remove_sell'),
        'report_rug_loss': matching_event.get('rugLoss') if matching_event else None,
    }

def main():
    parser = argparse.ArgumentParser(
        description='Analyze rug patterns from Solscan data',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        '--solscan-dir',
        default='rug_analysis',
        help='Directory with Solscan JSON files (default: rug_analysis)'
    )
    parser.add_argument(
        '--report',
        default='logs/paper-report.json',
        help='Paper report JSON for comparison (default: logs/paper-report.json)'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Show detailed per-file analysis'
    )

    args = parser.parse_args()

    # Load paper report
    try:
        with open(args.report) as f:
            paper_report = json.load(f)
    except FileNotFoundError:
        print(f"Warning: Report not found: {args.report}", file=sys.stderr)
        paper_report = {'operations': []}

    # Find and analyze Solscan files
    solscan_dir = Path(args.solscan_dir)
    if not solscan_dir.exists():
        print(f"Error: Directory not found: {args.solscan_dir}", file=sys.stderr)
        sys.exit(1)

    json_files = sorted(solscan_dir.glob('*.json'))
    if not json_files:
        print(f"Error: No JSON files found in {args.solscan_dir}", file=sys.stderr)
        sys.exit(1)

    print("Solscan Pattern Analysis")
    print("=" * 80)
    print(f"Directory:     {args.solscan_dir}")
    print(f"Files found:   {len(json_files)}")
    print()

    # Analyze each file
    results = []
    for json_file in json_files:
        try:
            solscan_data = analyze_solscan_file(json_file)
            comparison = compare_with_paper_report(solscan_data, paper_report)
            results.append(comparison)
            
            if args.verbose:
                print(f"\n{json_file.name}:")
                print(f"  Event ID:          {comparison.get('event_id', 'not found')}")
                print(f"  Rug Loss:          {comparison.get('report_rug_loss', 'unknown')}")
                print(f"  Micro (Solscan):   {solscan_data.get('micro_transfers')} transfers from {solscan_data.get('micro_sources')} sources")
                print(f"  Micro (Report):    {comparison.get('report_micro_transfers')} transfers from {comparison.get('report_micro_sources')} sources")
                print(f"  In/Out (Solscan):  {comparison.get('solscan_total_inbound'):.3f} / {comparison.get('solscan_total_outbound'):.1f} SOL")
                print(f"  In/Out (Report):   {comparison.get('report_relay_inbound', 0):.3f} / {comparison.get('report_relay_outbound', 0):.1f} SOL")
                print(f"  Quick Remove+Sell: {solscan_data.get('has_quick_remove_sell')}")
        
        except Exception as e:
            print(f"Error parsing {json_file.name}: {e}", file=sys.stderr)
            continue

    # Summary
    print()
    print("Summary:")
    print(f"  Analyzed:     {len(results)}")
    print(f"  In report:    {sum(1 for r in results if r['found_in_report'])}")
    print(f"  Rug losses:   {sum(1 for r in results if r['report_rug_loss'])}")
    
    # Show comparison table
    print()
    print("Solscan vs Paper Report Comparison:")
    print(f"  {'File':<20} {'Event':<12} {'Rug':<5} {'Micro':<12} {'In SOL':<12} {'Quick':<6}")
    print(f"  {'-'*80}")
    for r in results:
        file_name = r['solscan_file'][:16] + '..' if len(r['solscan_file']) > 16 else r['solscan_file']
        event_id = r['event_id'] or '?'
        rug = '✓' if r['report_rug_loss'] else '✗'
        micro_cmp = 'match' if (r['solscan_micro_transfers'] == r['report_micro_transfers']) else 'diff'
        in_sol = r['report_relay_inbound'] or 0
        quick = '✓' if r['solscan_quick_remove_sell'] else '✗'
        
        print(f"  {file_name:<20} {event_id:<12} {rug:<5} {micro_cmp:<12} {in_sol:<12.2f} {quick:<6}")

    return 0

if __name__ == '__main__':
    sys.exit(main())
