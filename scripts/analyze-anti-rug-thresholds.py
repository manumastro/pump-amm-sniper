#!/usr/bin/env python3
"""
Analyze anti-rug filter effectiveness against historical rug loss data.

This script:
1. Loads paper-report.json with completed trade history
2. Tests proposed funding pattern thresholds against all rug losses
3. Calculates coverage rate and breakdown by detection method
4. Identifies unblocked rugs for further analysis

Usage:
    python scripts/analyze-anti-rug-thresholds.py [--config <path>] [--report <path>]

Config thresholds (from src/app/config.ts):
    - CREATOR_RISK_FUNDING_PATTERN_BLOCK_ENABLED: true
    - CREATOR_RISK_FUNDING_PATTERN_MICRO_MIN_TRANSFERS: 2
    - CREATOR_RISK_FUNDING_PATTERN_MICRO_MIN_SOURCES: 2
    - CREATOR_RISK_FUNDING_PATTERN_RELAY_INBOUND_MAX_SOL: 3.0
    - CREATOR_RISK_FUNDING_PATTERN_RELAY_OUTBOUND_MIN_SOL: 10.0
    - CREATOR_RISK_FUNDING_PATTERN_RELAY_ASYMMETRY_RATIO: 10.0
"""

import json
import sys
import argparse
from pathlib import Path
from typing import Dict, List, Tuple

def load_report(path: str) -> Dict:
    """Load paper report JSON file."""
    with open(path) as f:
        return json.load(f)

def analyze_thresholds(
    operations: List[Dict],
    micro_min_transfers: int,
    micro_min_sources: int,
    relay_inbound_max: float,
    relay_outbound_min: float,
    relay_asymmetry_ratio: float,
) -> Tuple[int, int, Dict]:
    """
    Test thresholds against all rug losses.
    
    Returns:
        (blocked_count, total_rug_count, breakdown_dict)
    """
    rug_losses = [e for e in operations if e.get('rugLoss')]
    blocked_count = 0
    breakdown = {
        'micro_only': 0,
        'relay_only': 0,
        'both': 0,
        'unblocked': 0,
    }
    unblocked_rugs = []

    for evt in rug_losses:
        evt_id = evt['id']
        micro_transfers = evt.get('creatorRiskMicroTransfers', 0) or 0
        micro_sources = evt.get('creatorRiskMicroSources', 0) or 0
        relay_inbound = float(evt.get('relayFundingInboundSol') or 0)
        relay_outbound = float(evt.get('relayFundingOutboundSol') or 0)
        saw_relay = evt.get('sawRelayFunding', False)

        micro_match = (
            micro_transfers >= micro_min_transfers and
            micro_sources >= micro_min_sources
        )

        relay_match = (
            saw_relay and
            relay_inbound > 0 and
            relay_inbound <= relay_inbound_max and
            relay_outbound >= relay_outbound_min and
            (relay_outbound / relay_inbound) > relay_asymmetry_ratio
        )

        if micro_match or relay_match:
            blocked_count += 1
            if micro_match and relay_match:
                breakdown['both'] += 1
            elif micro_match:
                breakdown['micro_only'] += 1
            else:
                breakdown['relay_only'] += 1
        else:
            breakdown['unblocked'] += 1
            unblocked_rugs.append({
                'id': evt_id,
                'micro': micro_transfers,
                'sources': micro_sources,
                'relay_in': relay_inbound,
                'relay_out': relay_outbound,
            })

    return blocked_count, len(rug_losses), breakdown, unblocked_rugs

def main():
    parser = argparse.ArgumentParser(
        description='Analyze anti-rug filter effectiveness',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        '--report',
        default='logs/paper-report.json',
        help='Path to paper report JSON (default: logs/paper-report.json)'
    )
    parser.add_argument(
        '--micro-min-transfers',
        type=int,
        default=2,
        help='Min micro transfers threshold (default: 2)'
    )
    parser.add_argument(
        '--micro-min-sources',
        type=int,
        default=2,
        help='Min micro sources threshold (default: 2)'
    )
    parser.add_argument(
        '--relay-inbound-max',
        type=float,
        default=3.0,
        help='Max relay inbound SOL threshold (default: 3.0)'
    )
    parser.add_argument(
        '--relay-outbound-min',
        type=float,
        default=10.0,
        help='Min relay outbound SOL threshold (default: 10.0)'
    )
    parser.add_argument(
        '--relay-asymmetry-ratio',
        type=float,
        default=10.0,
        help='Min relay asymmetry ratio threshold (default: 10.0)'
    )
    parser.add_argument(
        '--verbose',
        action='store_true',
        help='Show detailed table of all rugs'
    )

    args = parser.parse_args()

    # Load report
    try:
        report = load_report(args.report)
    except FileNotFoundError:
        print(f"Error: Report file not found: {args.report}", file=sys.stderr)
        sys.exit(1)
    except json.JSONDecodeError as e:
        print(f"Error: Invalid JSON in {args.report}: {e}", file=sys.stderr)
        sys.exit(1)

    operations = report.get('operations', [])
    if not operations:
        print("Error: No operations found in report", file=sys.stderr)
        sys.exit(1)

    # Analyze
    blocked, total, breakdown, unblocked = analyze_thresholds(
        operations,
        args.micro_min_transfers,
        args.micro_min_sources,
        args.relay_inbound_max,
        args.relay_outbound_min,
        args.relay_asymmetry_ratio,
    )

    # Report
    print("Anti-Rug Filter Analysis")
    print("=" * 80)
    print(f"Report:        {args.report}")
    print(f"Total rugs:    {total}")
    print(f"Blocked:       {blocked} ({100*blocked/total:.0f}%)")
    print()
    print("Thresholds:")
    print(f"  Micro transfers:      ≥ {args.micro_min_transfers}")
    print(f"  Micro sources:        ≥ {args.micro_min_sources}")
    print(f"  Relay inbound max:    ≤ {args.relay_inbound_max} SOL")
    print(f"  Relay outbound min:   ≥ {args.relay_outbound_min} SOL")
    print(f"  Relay asymmetry:      > {args.relay_asymmetry_ratio}x")
    print()
    print("Breakdown:")
    print(f"  Micro pattern only:   {breakdown['micro_only']}")
    print(f"  Relay pattern only:   {breakdown['relay_only']}")
    print(f"  Both patterns:        {breakdown['both']}")
    print(f"  Unblocked:            {breakdown['unblocked']}")
    print()

    if unblocked:
        print(f"Unblocked rugs ({len(unblocked)}):")
        print(f"  {'ID':<12} {'Micro':<8} {'Sources':<8} {'In SOL':<8} {'Out SOL':<8}")
        print(f"  {'-'*52}")
        for rug in sorted(unblocked, key=lambda x: x['id']):
            print(f"  {rug['id']:<12} {rug['micro']:<8} {rug['sources']:<8} {rug['relay_in']:<8.2f} {rug['relay_out']:<8.1f}")
        print()

    if args.verbose:
        print("Detailed table (all rugs):")
        print(f"  {'ID':<12} {'Status':<10} {'Micro':<8} {'Src':<5} {'In':<7} {'Out':<7} {'Reason'}")
        print(f"  {'-'*75}")
        
        all_rugs = [e for e in operations if e.get('rugLoss')]
        for evt in all_rugs:
            evt_id = evt['id']
            micro = evt.get('creatorRiskMicroTransfers', 0) or 0
            sources = evt.get('creatorRiskMicroSources', 0) or 0
            in_sol = float(evt.get('relayFundingInboundSol') or 0)
            out_sol = float(evt.get('relayFundingOutboundSol') or 0)
            
            micro_match = micro >= args.micro_min_transfers and sources >= args.micro_min_sources
            relay_match = (
                evt.get('sawRelayFunding', False) and in_sol > 0 and
                in_sol <= args.relay_inbound_max and out_sol >= args.relay_outbound_min and
                (out_sol / in_sol) > args.relay_asymmetry_ratio
            )
            
            status = "✓ BLOCK" if (micro_match or relay_match) else "✗ PASS"
            reason = []
            if micro_match:
                reason.append("micro")
            if relay_match:
                reason.append("relay")
            reason_str = "+".join(reason) if reason else "-"
            
            print(f"  {evt_id:<12} {status:<10} {micro:<8} {sources:<5} {in_sol:<7.2f} {out_sol:<7.1f} {reason_str}")

    return 0 if blocked == total else 1

if __name__ == '__main__':
    sys.exit(main())
