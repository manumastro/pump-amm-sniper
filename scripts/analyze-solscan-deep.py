#!/usr/bin/env python3
"""
Deep analysis of Solscan rug patterns from JSON exports.

Parses actual transaction/transfer data to identify:
1. Timing patterns (pre-pool, pool creation, rug timing)
2. Funding patterns (inbound sources, amounts, micro transfers)
3. Rug mechanics (liquidity removal, creator sells, price collapse)
4. Wallet relationships (funding sources, dispersal destinations)

Usage:
    python scripts/analyze-solscan-deep.py [--verbose] [--output <file>]
"""

import json
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Tuple, Optional
from datetime import datetime
from collections import defaultdict
import re

def parse_amount(text: str) -> float:
    """Extract amount from transaction text."""
    parts = text.split('\n')
    for part in parts:
        # Look for amount patterns like "89.15" or "0.2711"
        match = re.search(r'(\d+\.?\d*)\s*(?:SOL)?(?:\s|$)', part.strip())
        if match:
            try:
                return float(match.group(1))
            except:
                pass
    return 0.0

def parse_address(text: str) -> Optional[str]:
    """Extract wallet address from transaction text."""
    # Match abbreviated addresses like "3683526wgR...gCKVpJcAPS" or full ones
    match = re.search(r'([A-Za-z0-9]{20,}(?:\.\.\.[A-Za-z0-9]{6})?)', text)
    if match:
        return match.group(1)
    return None

def parse_timestamp(ts_str: str) -> int:
    """Parse ISO timestamp."""
    try:
        dt = datetime.fromisoformat(ts_str.replace('+00:00', ''))
        return int(dt.timestamp())
    except:
        return 0

def analyze_solscan_file(filepath: str) -> Dict:
    """Analyze a single Solscan JSON export."""
    with open(filepath) as f:
        data = json.load(f)
    
    creator = data.get('account', '')
    token = data.get('query', {}).get('token', '')
    results = data.get('results', {}).get('creator', {})
    
    # Parse transactions
    transactions = results.get('Transactions', {}).get('rows_seen', [])
    
    # Key events
    pool_create_time = None
    pool_create_amount = 0
    remove_liq_events = []
    creator_sells = []
    creator_buys = []
    
    amm_buy_count = 0
    amm_sell_count = 0
    
    timeline = []
    
    for tx in transactions:
        ts = parse_timestamp(tx.get('timestamp_utc', ''))
        text = tx.get('text', '')
        amount = parse_amount(text)
        
        if 'Pool: Create' in text:
            pool_create_time = ts
            pool_create_amount = amount
            timeline.append(('pool_create', ts, amount))
        elif 'Liquidity: Remove' in text:
            remove_liq_events.append({'time': ts, 'amount': amount})
            timeline.append(('remove_liq', ts, amount))
        elif 'AMM: Sell' in text:
            creator_sells.append({'time': ts, 'amount': amount})
            amm_sell_count += 1
            timeline.append(('amm_sell', ts, amount))
        elif 'AMM: Buy' in text:
            creator_buys.append({'time': ts, 'amount': amount})
            amm_buy_count += 1
            timeline.append(('amm_buy', ts, amount))
    
    # Timing analysis
    time_to_first_remove = None
    time_to_last_sell = None
    if pool_create_time and remove_liq_events:
        time_to_first_remove = remove_liq_events[0]['time'] - pool_create_time
    if pool_create_time and creator_sells:
        time_to_last_sell = max(s['time'] for s in creator_sells) - pool_create_time
    
    # Quick removal pattern
    quick_remove_and_sell = False
    if remove_liq_events and creator_sells:
        first_remove = remove_liq_events[0]['time']
        first_sell = min(s['time'] for s in creator_sells)
        if abs(first_remove - first_sell) < 10:  # Within 10 seconds
            quick_remove_and_sell = True
    
    # Rug signature patterns
    has_buy_before_remove = False
    if remove_liq_events and creator_buys:
        first_remove = remove_liq_events[0]['time']
        buys_before = [b for b in creator_buys if b['time'] < first_remove]
        has_buy_before_remove = len(buys_before) > 0
    
    # Analyze transfers for funding sources
    transfers = results.get('Transfers', {}).get('rows_seen', [])
    inbound_transfers = {}  # source -> [amounts]
    
    for transfer in transfers:
        text = transfer.get('text', '')
        ts = parse_timestamp(transfer.get('timestamp_utc', ''))
        amount = parse_amount(text)
        
        # Very basic parsing - look for transfer amounts
        if amount > 0 and amount < 1.0:  # Micro transfer
            source = parse_address(text) or "unknown"
            if source not in inbound_transfers:
                inbound_transfers[source] = []
            inbound_transfers[source].append(amount)
    
    micro_transfer_count = sum(1 for transfers_list in inbound_transfers.values() for _ in transfers_list if sum(inbound_transfers[src] for src in inbound_transfers) < 2)
    micro_sources = len([s for s in inbound_transfers if sum(inbound_transfers[s]) < 2])
    
    return {
        'file': Path(filepath).name,
        'creator': creator,
        'token': token,
        'pool_create_time': pool_create_time,
        'pool_create_amount': pool_create_amount,
        'remove_liq_count': len(remove_liq_events),
        'first_remove_amount': remove_liq_events[0]['amount'] if remove_liq_events else 0,
        'time_to_first_remove_sec': time_to_first_remove,
        'creator_buy_count': amm_buy_count,
        'creator_sell_count': amm_sell_count,
        'time_to_last_sell_sec': time_to_last_sell,
        'quick_remove_and_sell': quick_remove_and_sell,
        'buy_before_remove': has_buy_before_remove,
        'total_remove_amount': sum(e['amount'] for e in remove_liq_events),
        'total_sell_amount': sum(e['amount'] for e in creator_sells),
        'micro_transfer_count': micro_transfer_count,
        'micro_sources': micro_sources,
        'inbound_sources_count': len(inbound_transfers),
        'timeline_events': len(timeline),
        'tx_count': len(transactions),
    }

def main():
    parser = argparse.ArgumentParser(description='Deep analysis of Solscan rug patterns')
    parser.add_argument('--solscan-dir', default='rug_analysis', help='Directory with Solscan JSON')
    parser.add_argument('--verbose', action='store_true', help='Detailed output')
    parser.add_argument('--output', help='Save results to JSON file')
    
    args = parser.parse_args()
    
    solscan_dir = Path(args.solscan_dir)
    if not solscan_dir.exists():
        print(f"Error: {args.solscan_dir} not found", file=sys.stderr)
        sys.exit(1)
    
    files = sorted(solscan_dir.glob('*.json'))
    if not files:
        print(f"No JSON files in {args.solscan_dir}", file=sys.stderr)
        sys.exit(1)
    
    print("=" * 100)
    print("SOLSCAN RUG PATTERN ANALYSIS")
    print("=" * 100)
    print()
    
    results = []
    for filepath in files:
        try:
            analysis = analyze_solscan_file(str(filepath))
            results.append(analysis)
            
            if args.verbose:
                print(f"\n{analysis['file']}")
                print(f"  Creator:              {analysis['creator'][:20]}...")
                print(f"  Pool Created:         {analysis['pool_create_time']} (amount: {analysis['pool_create_amount']:.2f})")
                print(f"  Remove Liq Events:    {analysis['remove_liq_count']} (first: {analysis['first_remove_amount']:.2f}, total: {analysis['total_remove_amount']:.2f})")
                print(f"  Time to 1st Remove:   {analysis['time_to_first_remove_sec'] or 'N/A'}s")
                print(f"  Creator Buys:         {analysis['creator_buy_count']}")
                print(f"  Creator Sells:        {analysis['creator_sell_count']} (total: {analysis['total_sell_amount']:.2f})")
                print(f"  Time to Last Sell:    {analysis['time_to_last_sell_sec'] or 'N/A'}s")
                print(f"  Quick Remove+Sell:    {'✓' if analysis['quick_remove_and_sell'] else '✗'}")
                print(f"  Buy Before Remove:    {'✓' if analysis['buy_before_remove'] else '✗'}")
                print(f"  Micro Transfers:      {analysis['micro_transfer_count']} from {analysis['micro_sources']} sources")
                print(f"  Total Inbound Sources: {analysis['inbound_sources_count']}")
                print(f"  Total Transactions:   {analysis['tx_count']}")
        
        except Exception as e:
            print(f"Error: {filepath.name}: {e}", file=sys.stderr)
    
    # Summary table
    print()
    print("SUMMARY TABLE")
    print("=" * 100)
    print(f"{'File':<20} {'Pool':<8} {'Removes':<8} {'Time':<8} {'B/S':<8} {'Q-Rug':<6} {'Micro':<10} {'Sources':<8}")
    print("-" * 100)
    
    for r in results:
        file_short = r['file'][:16] + '..' if len(r['file']) > 16 else r['file']
        pool = f"{r['pool_create_amount']:.1f}"
        removes = r['remove_liq_count']
        time_sec = r['time_to_first_remove_sec'] or '-'
        bs = f"{r['creator_buy_count']}/{r['creator_sell_count']}"
        quick_rug = '✓' if r['quick_remove_and_sell'] else '✗'
        micro = r['micro_transfer_count']
        sources = r['micro_sources']
        
        print(f"{file_short:<20} {pool:<8} {removes:<8} {str(time_sec):<8} {bs:<8} {quick_rug:<6} {micro:<10} {sources:<8}")
    
    # Save if requested
    if args.output:
        with open(args.output, 'w') as f:
            json.dump(results, f, indent=2)
        print()
        print(f"Results saved to {args.output}")
    
    print()
    print("KEY FINDINGS")
    print("=" * 100)
    
    # Pattern detection
    quick_rug_count = sum(1 for r in results if r['quick_remove_and_sell'])
    buy_before_count = sum(1 for r in results if r['buy_before_remove'])
    micro_pattern_count = sum(1 for r in results if r['micro_transfer_count'] >= 2 and r['micro_sources'] >= 2)
    
    print(f"Quick Remove + Sell pattern: {quick_rug_count}/{len(results)} (immediate liquidity removal + creator sells)")
    print(f"Buy Before Remove pattern:   {buy_before_count}/{len(results)} (creator buys before draining pool)")
    print(f"Micro Transfer pattern:      {micro_pattern_count}/{len(results)} (2+ micro transfers from 2+ sources)")
    print()

if __name__ == '__main__':
    sys.exit(main())
