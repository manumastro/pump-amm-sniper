import json
import sys
import subprocess
import os
import time

def get_rugcheck(token):
    """
    Fetches token data from GMGN via curl and checks for ruggedness or high price.
    """
    url = f"https://gmgn.ai/defi/quotation/v1/rank/multi/h24?orderby=volume&direction=desc&limit=1&chain=sol&token={token}"
    # GMGN doesn't have a public API, we'll try a simpler check or assume we need to parse a different source.
    # For now, let's use a mock or fallback if we can't easily scrape.
    # A better approach is to use DexScreener or Birdeye public APIs if available, or just GMGN if we can figure it out.
    
    # Let's try to use a public Birdeye/DexScreener endpoint or just check GMGN if possible.
    # DexScreener API is free and reliable for price data.
    url_dexscreener = f"https://api.dexscreener.com/latest/dex/tokens/{token}"
    
    try:
        result = subprocess.run(['curl', '-s', '-L', url_dexscreener], capture_output=True, text=True, timeout=10)
        data = json.loads(result.stdout)
        
        if data.get('pairs'):
            pair = data['pairs'][0]
            price_usd = float(pair.get('priceUsd', 0))
            txns = pair.get('txns', {}).get('h24', {})
            volume = pair.get('volume', {}).get('h24', 0)
            price_change = pair.get('priceChange', {}).get('h24', 0)
            liquidity = pair.get('liquidity', {}).get('usd', 0)
            
            return {
                "found": True,
                "price_usd": price_usd,
                "price_change_h24": price_change,
                "volume_h24": volume,
                "txns_h24": txns,
                "liquidity_usd": liquidity,
                "url": f"https://dexscreener.com/solana/{pair.get('pairAddress')}"
            }
            
        return {"found": False}
        
    except Exception as e:
        return {"found": False, "error": str(e)}

def main():
    report_path = "logs/paper-report.json"
    
    if not os.path.exists(report_path):
        print(f"❌ Report file not found at {report_path}")
        return

    with open(report_path, 'r') as f:
        data = json.load(f)

    operations = data.get('operations', [])
    
    # Target categories
    target_categories = {
        "suspicious funding": 0,
        "funder blacklisted": 0,
        "setup burst": 0
    }
    
    samples = []
    
    for op in operations:
        skip_reason = str(op.get('skipReason') or '').lower()
        
        category = None
        if "suspicious funding" in skip_reason:
            category = "suspicious funding"
        elif "funder blacklisted" in skip_reason:
            category = "funder blacklisted"
        elif "setup burst" in skip_reason:
            category = "setup burst"
            
        if category and target_categories[category] < 10:
            if op.get('tokenMint'):
                samples.append({
                    "category": category,
                    "token": op['tokenMint'],
                    "creator": op.get('creator', 'unknown'),
                    "startedAt": op.get('startedAt'),
                    "skipReason": op.get('skipReason')
                })
                target_categories[category] += 1
                
    print(f"Found {len(samples)} samples to analyze.")
    
    results = []
    
    for sample in samples:
        print(f"🔍 Analyzing {sample['token']} ({sample['category']})...")
        analysis = get_rugcheck(sample['token'])
        
        res = {
            **sample,
            "analysis": analysis
        }
        results.append(res)
        time.sleep(1) # Rate limit

    print("\n📊 Analysis Results:")
    for res in results:
        print("-" * 40)
        print(f"Token: {res['token']}")
        print(f"Category: {res['category']}")
        print(f"Creator: {res['creator']}")
        print(f"Reason: {res['skipReason']}")
        
        if res['analysis']['found']:
            print(f"✅ Data found on DexScreener")
            print(f"Price Change 24h: {res['analysis']['price_change_h24']}%")
            print(f"Liquidity: ${res['analysis']['liquidity_usd']:.2f}")
            print(f"Volume 24h: ${res['analysis']['volume_h24']:.2f}")
            
            # Simple logic to determine if it was a "good" trade missed
            # If price went up significantly (>50%) and liquidity is decent (>5k), maybe it was a good one?
            # If liquidity is 0 or extremely low (<100), it's definitely a rug/failed.
            
            liq = res['analysis']['liquidity_usd']
            change = res['analysis']['price_change_h24']
            
            if liq < 100:
                print("❌ Verdict: Likely Rugged or Dead (Liquidity < $100)")
            elif change > 50:
                print("📈 Verdict: Would have been a good trade! (Price up > 50%)")
            else:
                print("➖ Verdict: Not a significant move or minor dump.")
        else:
            print("❌ No data found on DexScreener (likely Rugged/Caught Immediately or not listed)")
            
if __name__ == "__main__":
    main()
