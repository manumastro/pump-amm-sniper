#!/usr/bin/env python3
import subprocess
import json
import re
from collections import defaultdict

def get_skip_reasons_and_tokens(report_path):
    """Extract skip reasons and tokens from paper report"""
    tokens_by_reason = defaultdict(list)
    
    with open(report_path, 'r') as f:
        content = f.read()
    
    # Match lines like: 0077. evt-000077 4JUHV6ocndg1Kyjrz2vd9hc7XZSFsbaXpeBScLXyeuoN ... skip=creator risk (fresh-funded high-seed creator ...
    pattern = r'(\w{40,44})\s+.*?skip=([^\s]+(?:\s+[^\s]+){0,10})'
    
    for match in re.finditer(pattern, content):
        token = match.group(1)
        reason_full = match.group(2).strip()
        
        # Normalize reason
        if 'fresh-funded' in reason_full:
            reason = 'fresh-funded'
        elif 'micro transfers' in reason_full:
            reason = 'micro-transfers'
        elif 'AMM re-entry' in reason_full:
            reason = 'amm-reentry'
        elif 'no WSOL side' in reason_full:
            reason = 'no-wsol-side'
        elif 'unique counterparties' in reason_full:
            reason = 'unique-counterparties'
        elif 'burner profile' in reason_full:
            reason = 'burner-profile'
        elif 'top10' in reason_full or 'top 10' in reason_full:
            reason = 'top10-concentration'
        elif 'creator seed too small' in reason_full:
            reason = 'seed-too-small'
        elif 'funder blacklisted' in reason_full:
            reason = 'funder-blacklisted'
        elif 'suspicious funding' in reason_full:
            reason = 'suspicious-funding'
        elif 'standard pool micro burst' in reason_full:
            reason = 'standard-micro-burst'
        else:
            reason = reason_full.split('(')[0].strip() if '(' in reason_full else reason_full[:30]
        
        tokens_by_reason[reason].append(token)
    
    return tokens_by_reason

def check_dexscreener(token):
    """Check DexScreener API for token liquidity"""
    try:
        result = subprocess.run(
            ['curl', '-s', f'https://api.dexscreener.com/latest/dex/tokens/{token}'],
            capture_output=True, text=True, timeout=10
        )
        data = json.loads(result.stdout)
        pairs = [p for p in data.get('pairs', []) if p.get('chainId') == 'solana']
        
        if pairs:
            p = pairs[0]
            liq = p.get('liquidity', {})
            if isinstance(liq, dict):
                liq_usd = liq.get('usd', 0) or 0
            else:
                liq_usd = float(liq) if liq else 0
            return {
                'price_usd': p.get('priceUsd', 'N/A'),
                'liquidity': liq_usd,
                'url': f"https://dexscreener.com/solana/{p.get('baseToken', {}).get('address', token)}"
            }
    except Exception as e:
        pass
    
    return {'price_usd': 'N/A', 'liquidity': 0, 'url': f'https://dexscreener.com/solana/{token}'}

def main():
    report_path = 'logs/paper-report.txt'
    tokens_by_reason = get_skip_reasons_and_tokens(report_path)
    
    print("=" * 80)
    print("SKIPPED TOKENS ANALYSIS BY SKIP REASON")
    print("=" * 80)
    
    total_tokens = 0
    total_with_liq = 0
    grand_total_liq = 0
    
    for reason, tokens in sorted(tokens_by_reason.items(), key=lambda x: -len(x[1])):
        total_tokens += len(tokens)
        print(f"\n{'=' * 80}")
        print(f"REASON: {reason} ({len(tokens)} tokens)")
        print(f"{'=' * 80}")
        
        reason_liq = 0
        reason_with_liq = 0
        tokens_checked = 0
        
        for token in tokens[:50]:  # Limit to 50 per reason to avoid rate limits
            result = check_dexscreener(token)
            liq = result['liquidity']
            reason_liq += liq
            if liq > 0:
                reason_with_liq += 1
            tokens_checked += 1
            
            if liq > 10000:
                print(f"  [HIGH LIQ ${liq:,.0f}] {token}")
                print(f"    {result['url']}")
            elif liq > 0:
                print(f"  [LOW LIQ  ${liq:,.0f}] {token}")
            # Don't print dead tokens to reduce noise
        
        if tokens_checked < len(tokens):
            print(f"  ... and {len(tokens) - tokens_checked} more tokens (not checked)")
        
        print(f"\n  SUMMARY: {reason_with_liq}/{tokens_checked} with liquidity, total ${reason_liq:,.0f}")
        total_with_liq += reason_with_liq
        grand_total_liq += reason_liq
    
    print(f"\n{'=' * 80}")
    print(f"GRAND TOTAL: {total_tokens} skipped tokens, {total_with_liq} with liquidity, ${grand_total_liq:,.0f}")
    print(f"{'=' * 80}")

if __name__ == '__main__':
    main()