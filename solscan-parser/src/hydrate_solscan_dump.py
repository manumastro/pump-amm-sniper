import argparse
import json
import os
import re
import time
import urllib.error
import urllib.request
from pathlib import Path


SIG_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{80,100}$")
BATCH_SIZE = 100
PUBLIC_RPC_URL = "https://api.mainnet-beta.solana.com"


def find_repo_env(start: Path) -> Path | None:
    for parent in [start, *start.parents]:
        candidate = parent / ".env"
        if candidate.exists():
            return candidate
    return None


def load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def resolve_helius_api_key(script_path: Path, explicit: str | None) -> str:
    if explicit:
        return explicit
    if os.getenv("HELIUS_API_KEY"):
        return os.environ["HELIUS_API_KEY"]
    env_path = find_repo_env(script_path.resolve().parent)
    if env_path:
        values = load_dotenv(env_path)
        if values.get("HELIUS_API_KEY"):
            return values["HELIUS_API_KEY"]
    raise RuntimeError("HELIUS_API_KEY not found in env or .env")


def extract_signature(row: dict) -> str | None:
    text = (row.get("text") or "").strip()
    if not text:
        return None
    first_line = text.splitlines()[0].strip()
    if SIG_RE.fullmatch(first_line):
        return first_line
    return None


def iter_rows(payload: dict) -> list[tuple[str, str, dict]]:
    rows: list[tuple[str, str, dict]] = []
    results = payload.get("results", {})
    if results and "creator" in results and "token" in results:
        scopes = results
    else:
        scope_name = payload.get("scope", "unknown")
        scopes = {scope_name: results}

    for scope, scope_results in scopes.items():
        for tab, tab_data in scope_results.items():
            for row in tab_data.get("rows_seen", []):
                rows.append((scope, tab, row))
    return rows


def post_parse_transactions(api_key: str, signatures: list[str]) -> list[dict]:
    url = f"https://api.helius.xyz/v0/transactions/?api-key={api_key}"
    body = json.dumps({"transactions": signatures}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def rpc_get_transactions(signatures: list[str], rpc_url: str) -> dict[str, dict]:
    batch = [
        {
            "jsonrpc": "2.0",
            "id": index,
            "method": "getTransaction",
            "params": [
                signature,
                {
                    "encoding": "jsonParsed",
                    "maxSupportedTransactionVersion": 0,
                    "commitment": "confirmed",
                },
            ],
        }
        for index, signature in enumerate(signatures, start=1)
    ]
    req = urllib.request.Request(
        rpc_url,
        data=json.dumps(batch).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        response = json.loads(resp.read().decode("utf-8"))

    by_id = {item["id"]: item for item in response}
    results: dict[str, dict] = {}
    for index, signature in enumerate(signatures, start=1):
        item = by_id.get(index, {})
        if item.get("result") is not None:
            results[signature] = item["result"]
    return results


def rpc_get_transactions_with_backoff(
    signatures: list[str], rpc_url: str, attempts: int = 3
) -> dict[str, dict]:
    delay = 1.0
    for attempt in range(1, attempts + 1):
        try:
            return rpc_get_transactions(signatures, rpc_url)
        except urllib.error.HTTPError as exc:
            if exc.code != 429 or attempt == attempts:
                raise
            time.sleep(delay)
            delay *= 2
    return {}


def chunked(items: list[str], size: int) -> list[list[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def main():
    parser = argparse.ArgumentParser(
        description="Hydrate Solscan dump signatures with Helius parsed transactions."
    )
    parser.add_argument("--input", required=True, help="Input Solscan JSON dump")
    parser.add_argument(
        "--output",
        help="Output hydrated JSON path (default: <input>_hydrated.json)",
    )
    parser.add_argument(
        "--api-key",
        help="Optional Helius API key override (otherwise env/.env is used)",
    )
    parser.add_argument(
        "--rpc-url",
        default=PUBLIC_RPC_URL,
        help=f"RPC URL fallback for getTransaction hydration (default: {PUBLIC_RPC_URL})",
    )
    args = parser.parse_args()

    input_path = Path(args.input)
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    api_key = None
    try:
        api_key = resolve_helius_api_key(Path(__file__), args.api_key)
    except Exception:
        api_key = None

    row_refs: dict[str, list[dict]] = {}
    ordered_signatures: list[str] = []
    for scope, tab, row in iter_rows(payload):
        signature = extract_signature(row)
        if not signature:
            continue
        row_refs.setdefault(signature, []).append(
            {
                "scope": scope,
                "tab": tab,
                "timestamp_utc": row.get("timestamp_utc"),
                "timestamp_local": row.get("timestamp_local"),
                "timestamp_source": row.get("timestamp_source"),
                "in_range": row.get("in_range"),
                "text": row.get("text"),
            }
        )
        if signature not in ordered_signatures:
            ordered_signatures.append(signature)

    hydrated_by_signature: dict[str, dict] = {}
    failed_batches: list[dict] = []
    for batch in chunked(ordered_signatures, BATCH_SIZE):
        try:
            used_fallback = False
            if api_key:
                try:
                    for tx in post_parse_transactions(api_key, batch):
                        signature = tx.get("signature")
                        if signature:
                            hydrated_by_signature[signature] = {
                                "method": "helius_enhanced",
                                "data": tx,
                            }
                except urllib.error.HTTPError as exc:
                    if exc.code == 403:
                        used_fallback = True
                    else:
                        failed_batches.append(
                            {
                                "signatures": batch,
                                "error": f"helius_enhanced HTTP {exc.code}",
                            }
                        )
                        continue
            else:
                used_fallback = True

            if used_fallback:
                rpc_results = rpc_get_transactions_with_backoff(batch, args.rpc_url)
                for signature, tx in rpc_results.items():
                    hydrated_by_signature[signature] = {
                        "method": "rpc_getTransaction",
                        "data": tx,
                    }
        except Exception as exc:
            failed_batches.append(
                {
                    "signatures": batch,
                    "error": str(exc),
                }
            )

    missing_signatures = [
        signature
        for signature in ordered_signatures
        if signature not in hydrated_by_signature
    ]

    output_payload = {
        "source_file": str(input_path),
        "signature_count": len(ordered_signatures),
        "hydrated_count": len(hydrated_by_signature),
        "missing_count": len(missing_signatures),
        "failed_batches": failed_batches,
        "signatures": [
            {
                "signature": signature,
                "rows": row_refs.get(signature, []),
                "helius": hydrated_by_signature.get(signature),
            }
            for signature in ordered_signatures
        ],
        "missing_signatures": missing_signatures,
    }

    output_path = (
        Path(args.output)
        if args.output
        else input_path.with_name(f"{input_path.stem}_hydrated.json")
    )
    output_path.write_text(json.dumps(output_payload, indent=2), encoding="utf-8")
    print(f"[ok] wrote {output_path}")
    print(
        f"[ok] hydrated {len(hydrated_by_signature)}/{len(ordered_signatures)} signatures"
    )
    if missing_signatures:
        print(f"[warn] missing signatures: {len(missing_signatures)}")


if __name__ == "__main__":
    main()
