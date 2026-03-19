
import json
import os
import glob
from datetime import datetime
from collections import defaultdict

def parse_solscan_ts(ts_str):
    try:
        return datetime.fromisoformat(ts_str.replace('Z', '+00:00')).timestamp()
    except:
        return None

def analyze_forensics(filepath):
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
        if not data: return None
    except: return None
    
    results = data.get('results', {}).get('creator', {})
    if not results: return None

    token_addr = 'unknown'
    token_sum = data.get('token_summary')
    if token_sum:
        token_addr = token_sum.get('address', 'unknown')

    # Forensics structure
    forensics = {
        'token': token_addr,
        'setup_burst': {
            'creates': 0,
            'mints': 0,
            'lookups': 0,
            'window': 0,
            'timestamps': []
        },
        'spray_outbound': {
            'txs': 0,
            'dests': set(),
            'total_sol': 0.0,
            'median_sol': 0.0,
            'amounts': []
        },
        'inbound_funding': {
            'txs': 0,
            'sources': set(),
            'total_sol': 0.0,
            'micro_bursts': 0 # < 0.01 SOL
        },
        'lifecycle': {
            'first_act': None,
            'last_act': None,
            'duration': 0
        }
    }

    # 1. Activities Analysis (Setup & Lifecycle)
    activities = results.get('Activities', {}).get('rows_in_range', [])
    for act in activities:
        text = act.get('text', '').lower()
        ts = parse_solscan_ts(act.get('timestamp_utc'))
        if ts:
            forensics['setup_burst']['timestamps'].append(ts)
            if forensics['lifecycle']['first_act'] is None or ts < forensics['lifecycle']['first_act']:
                forensics['lifecycle']['first_act'] = ts
            if forensics['lifecycle']['last_act'] is None or ts > forensics['lifecycle']['last_act']:
                forensics['lifecycle']['last_act'] = ts
        
        if 'create' in text: forensics['setup_burst']['creates'] += 1
        if 'mint' in text: forensics['setup_burst']['mints'] += 1
        if 'lookuptable' in text: forensics['setup_burst']['lookups'] += 1

    # 2. Transfers Analysis (Spray & Funding)
    transfers = results.get('Transfers', {}).get('rows_in_range', [])
    for tr in transfers:
        text = tr.get('text', '')
        lines = text.split('\n')
        is_out = '-' in text or 'out' in text.lower()
        amount = 0.0
        addr = ""
        
        for line in lines:
            line = line.strip()
            if 'SOL' in line:
                try: amount = float(line.replace('SOL', '').replace(',', '').strip())
                except: pass
            if len(line) > 30 and ' ' not in line: addr = line

        if is_out:
            forensics['spray_outbound']['txs'] += 1
            if addr: forensics['spray_outbound']['dests'].add(addr)
            forensics['spray_outbound']['total_sol'] += amount
            forensics['spray_outbound']['amounts'].append(amount)
        else:
            forensics['inbound_funding']['txs'] += 1
            if addr: forensics['inbound_funding']['sources'].add(addr)
            forensics['inbound_funding']['total_sol'] += amount
            if amount < 0.01: forensics['inbound_funding']['micro_bursts'] += 1

    # Finalize metrics
    if forensics['setup_burst']['timestamps']:
        forensics['setup_burst']['window'] = max(forensics['setup_burst']['timestamps']) - min(forensics['setup_burst']['timestamps'])
    
    if forensics['lifecycle']['first_act'] and forensics['lifecycle']['last_act']:
        forensics['lifecycle']['duration'] = forensics['lifecycle']['last_act'] - forensics['lifecycle']['first_act']

    forensics['spray_outbound']['dests'] = len(forensics['spray_outbound']['dests'])
    forensics['inbound_funding']['sources'] = len(forensics['inbound_funding']['sources'])
    
    return forensics

def get_stats(vals):
    if not vals: return "N/A"
    s = sorted(vals)
    return f"Med: {s[len(s)//2]:.2f} | P90: {s[int(len(s)*0.9)]:.2f} | Max: {s[-1]:.2f}"

def main():
    files = glob.glob('last_rugpulls/*wide.json')
    reports = []
    for f in files:
        rep = analyze_forensics(f)
        if rep: reports.append(rep)

    if not reports:
        print("No rug data found.")
        return

    print(f"=== DEEP RUG FORENSICS REPORT ({len(reports)} cases) ===")
    
    # Aggregated Stats
    metrics = {
        'Setup Operations': [r['setup_burst']['creates'] + r['setup_burst']['mints'] for r in reports],
        'Setup Window (sec)': [r['setup_burst']['window'] for r in reports if r['setup_burst']['window'] > 0],
        'Outbound Spray (Dests)': [r['spray_outbound']['dests'] for r in reports],
        'Inbound Funding (Sources)': [r['inbound_funding']['sources'] for r in reports],
        'Micro Inbound Bursts': [r['inbound_funding']['micro_bursts'] for r in reports],
        'Total Outbound SOL': [r['spray_outbound']['total_sol'] for r in reports],
        'Total Inbound SOL': [r['inbound_funding']['total_sol'] for r in reports]
    }

    for name, vals in metrics.items():
        print(f"\n{name.upper()}:")
        print(f"  {get_stats(vals)}")

    print("\n=== SUGGESTED OPTIMIZED THRESHOLDS ===")
    print(f"CREATOR_RISK_SETUP_BURST_MIN_CREATES:      {int(np_median([r['setup_burst']['creates'] + r['setup_burst']['mints'] for r in reports]) * 1.5)}")
    print(f"CREATOR_RISK_SPRAY_OUTBOUND_MIN_DESTS:     {int(np_median([r['spray_outbound']['dests'] for r in reports]) + 1)}")
    print(f"CREATOR_RISK_MICRO_INBOUND_MIN_TRANSFERS:  {max(4, int(np_median([r['inbound_funding']['micro_bursts'] for r in reports])))}")

def np_median(v):
    if not v: return 0
    s = sorted(v)
    return s[len(s)//2]

if __name__ == "__main__":
    main()
