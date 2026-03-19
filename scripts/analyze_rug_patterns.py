
import json
import os
import glob
from collections import defaultdict
import math

def get_stats(values):
    if not values: return {}
    sorted_v = sorted(values)
    n = len(sorted_v)
    return {
        'min': sorted_v[0],
        'max': sorted_v[-1],
        'median': sorted_v[n // 2],
        'mean': sum(sorted_v) / n,
        'p90': sorted_v[int(n * 0.9)] if n > 0 else 0
    }

def analyze_file(filepath):
    try:
        with open(filepath, 'r') as f:
            data = json.load(f)
    except: return None
    
    results = data.get('results', {}).get('creator', {})
    if not results:
        return None

    metrics = {
        'outbound_transfers': 0,
        'unique_destinations': set(),
        'setup_ops': 0,
    }

    # Analyze Activities for setup burst
    activities = results.get('Activities', {}).get('rows_in_range', [])
    for act in activities:
        text = act.get('text', '').lower()
        if 'create' in text or 'mint' in text:
            metrics['setup_ops'] += 1

    # Analyze Transfers for spray/dispersal
    transfers = results.get('Transfers', {}).get('rows_in_range', [])
    for tr in transfers:
        text = tr.get('text', '')
        lines = text.split('\n')
        is_out = False
        dest = ""
        
        # Simple heuristic for direction and destination
        if '-' in text or 'out' in text.lower():
            is_out = True
        
        for line in lines:
            line = line.strip()
            if len(line) > 30 and not ' ' in line: # Likely a pubkey
                dest = line

        if is_out:
            metrics['outbound_transfers'] += 1
            if dest: metrics['unique_destinations'].add(dest)

    metrics['unique_destinations'] = len(metrics['unique_destinations'])
    return metrics

def main():
    files = glob.glob('last_rugpulls/*wide.json')
    all_metrics = []
    
    for f in files:
        m = analyze_file(f)
        if m:
            all_metrics.append(m)

    if not all_metrics:
        print("No valid metrics found.")
        return

    summary_keys = ['outbound_transfers', 'unique_destinations', 'setup_ops']
    
    print(f"--- RUG PATTERN ANALYSIS ({len(all_metrics)} samples) ---")
    for key in summary_keys:
        values = [m[key] for m in all_metrics]
        stats = get_stats(values)
        print(f"\nMetric: {key}")
        print(f"  Min:    {stats['min']:.2f}")
        print(f"  Max:    {stats['max']:.2f}")
        print(f"  Median: {stats['median']:.2f}")
        print(f"  Mean:   {stats['mean']:.2f}")
        print(f"  P10 (Potential Block): {sorted(values)[int(len(values)*0.1)] if len(values)>0 else 0}")
        print(f"  Suggested Lower Bound (block): {max(1, stats['median'] * 0.5):.2f}")

if __name__ == "__main__":
    main()
