import argparse
import json
import re
import shutil
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from DrissionPage import ChromiumOptions, ChromiumPage


UTC = ZoneInfo("UTC")
DEFAULT_TZ = "Europe/Berlin"
TIMESTAMP_RE = re.compile(r"(\d{2}:\d{2}:\d{2}\s+[A-Za-z]{3}\s+\d{2},\s+\d{4})")
RELATIVE_RE = re.compile(
    r"(\d+)\s+"
    r"(sec|secs|second|seconds|min|mins|minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago",
    re.IGNORECASE,
)


@dataclass
class ScrapeRow:
    tab: str
    page: int
    timestamp_utc: str | None
    timestamp_local: str | None
    in_range: bool
    text: str


class SolscanDebugParser:
    def __init__(
        self,
        headless: bool,
        timeout_sec: int,
        settle_sec: float,
        cloudflare_wait_sec: int,
    ):
        self.headless = headless
        self.timeout_sec = timeout_sec
        self.settle_sec = settle_sec
        self.cloudflare_wait_sec = cloudflare_wait_sec
        self.page: ChromiumPage | None = None

    def _resolve_chromium_binary(self) -> str:
        candidates = [
            "/snap/bin/chromium",
            "chromium",
            "chromium-browser",
            "google-chrome",
            "google-chrome-stable",
        ]
        for candidate in candidates:
            resolved = (
                candidate if candidate.startswith("/") else shutil.which(candidate)
            )
            if resolved and Path(resolved).exists():
                return resolved
        raise RuntimeError("Chromium/Chrome binary not found on host")

    def __enter__(self):
        chromium_path = self._resolve_chromium_binary()
        co = ChromiumOptions()
        co.set_browser_path(chromium_path)
        co.set_argument("--no-sandbox")
        co.set_argument("--disable-dev-shm-usage")
        co.set_argument("--disable-gpu")
        co.set_argument("--disable-setuid-sandbox")
        co.headless(self.headless)
        self.page = ChromiumPage(co)
        self.page.set.window.size(1400, 1100)
        self.page.set.timeouts(base=self.timeout_sec)
        return self

    def __exit__(self, exc_type, exc_value, _):
        if self.page:
            self.page.quit()
        if exc_type:
            print(f"[warn] parser exit with error: {exc_value}")
        return False

    def _body_text(self) -> str:
        if not self.page:
            return ""
        try:
            body = self.page.ele("tag:body", timeout=0.5)
            return body.text if body else ""
        except Exception:
            return ""

    def _wait_cf_pass(self):
        if not self.page:
            raise RuntimeError("Page not initialized")
        deadline = time.time() + self.cloudflare_wait_sec
        while time.time() < deadline:
            title = (self.page.title or "").strip().lower()
            body = self._body_text().lower()
            blocked = (
                "just a moment" in title
                or "performing security verification" in body
                or "verification successful. waiting for solscan.io to respond" in body
            )
            if not blocked:
                return
            time.sleep(1.0)
        print("[warn] cloudflare challenge still active after timeout")

    def _open_account(self, address: str):
        if not self.page:
            raise RuntimeError("Page not initialized")
        self.page.get(f"https://solscan.io/account/{address}")
        self._wait_cf_pass()
        time.sleep(self.settle_sec)

    def _dismiss_cookie_banner(self):
        if not self.page:
            return
        for text in ("Got it!", "Got it"):
            btn = self.page.ele(f"text:{text}", timeout=1)
            if btn:
                try:
                    btn.click(by_js=True)
                    time.sleep(0.2)
                    return
                except Exception:
                    continue

    def _open_tab(self, tab_name: str):
        if not self.page:
            raise RuntimeError("Page not initialized")
        tab = self.page.ele(f"text:{tab_name}", timeout=2)
        if not tab:
            raise RuntimeError(f"Tab not found: {tab_name}")
        tab.click(by_js=True)
        time.sleep(self.settle_sec)
        if not self.page.ele("xpath://table//tbody//tr", timeout=self.timeout_sec):
            raise RuntimeError(f"No table rows found on tab {tab_name}")

    def _row_timestamp_utc(self, text: str, now_utc: datetime) -> datetime | None:
        match = TIMESTAMP_RE.search(text)
        if match:
            raw = match.group(1)
            try:
                dt = datetime.strptime(raw, "%H:%M:%S %b %d, %Y")
                return dt.replace(tzinfo=UTC)
            except ValueError:
                pass

        lowered = text.lower()
        if "just now" in lowered:
            return now_utc

        rel = RELATIVE_RE.search(lowered)
        if not rel:
            return None
        qty = int(rel.group(1))
        unit = rel.group(2).lower()
        seconds = 0
        if unit.startswith("sec"):
            seconds = qty
        elif unit.startswith("min"):
            seconds = qty * 60
        elif unit.startswith("hour"):
            seconds = qty * 3600
        elif unit.startswith("day"):
            seconds = qty * 86400
        elif unit.startswith("week"):
            seconds = qty * 604800
        elif unit.startswith("month"):
            seconds = qty * 2592000
        if seconds <= 0:
            return None
        return now_utc - timedelta(seconds=seconds)

    def _extract_page_rows(
        self,
        tab_name: str,
        page_num: int,
        start_utc: datetime,
        end_utc: datetime,
        local_tz: ZoneInfo,
    ) -> list[ScrapeRow]:
        if not self.page:
            return []
        rows = self.page.eles("xpath://table//tbody//tr") or []
        now_utc = datetime.now(UTC)
        parsed: list[ScrapeRow] = []
        for row in rows:
            text = (row.text or "").strip()
            if not text:
                continue
            ts_utc = self._row_timestamp_utc(text, now_utc)
            in_range = False
            ts_utc_iso = None
            ts_local_iso = None
            if ts_utc:
                in_range = start_utc <= ts_utc <= end_utc
                ts_utc_iso = ts_utc.isoformat()
                ts_local_iso = ts_utc.astimezone(local_tz).isoformat()
            parsed.append(
                ScrapeRow(
                    tab=tab_name,
                    page=page_num,
                    timestamp_utc=ts_utc_iso,
                    timestamp_local=ts_local_iso,
                    in_range=in_range,
                    text=text,
                )
            )
        return parsed

    def _go_next_page(self) -> bool:
        if not self.page:
            return False
        candidates = self.page.eles(
            "xpath://button[contains(., 'Next')] | //a[contains(., 'Next')]"
        ) or []
        for candidate in candidates:
            classes = (candidate.attr("class") or "").lower()
            aria_disabled = (candidate.attr("aria-disabled") or "").lower()
            if "disabled" in classes or aria_disabled == "true":
                continue
            try:
                candidate.click(by_js=True)
                time.sleep(self.settle_sec)
                if self.page.ele("xpath://table//tbody//tr", timeout=self.timeout_sec):
                    return True
            except Exception:
                continue
        return False

    def collect_account_tabs(
        self,
        account: str,
        tabs: list[str],
        start_utc: datetime,
        end_utc: datetime,
        local_tz: ZoneInfo,
        max_pages: int,
    ) -> dict:
        self._open_account(account)
        self._dismiss_cookie_banner()

        result: dict[str, list[dict]] = {}
        for tab in tabs:
            try:
                self._open_tab(tab)
            except Exception:
                result[tab] = []
                continue

            all_rows: list[ScrapeRow] = []
            for page_num in range(1, max_pages + 1):
                page_rows = self._extract_page_rows(
                    tab_name=tab,
                    page_num=page_num,
                    start_utc=start_utc,
                    end_utc=end_utc,
                    local_tz=local_tz,
                )
                all_rows.extend(page_rows)

                oldest = None
                for row in page_rows:
                    if row.timestamp_utc:
                        dt = datetime.fromisoformat(row.timestamp_utc)
                        oldest = dt if oldest is None or dt < oldest else oldest
                if oldest and oldest < start_utc:
                    break
                if page_num == max_pages:
                    break
                if not self._go_next_page():
                    break

            result[tab] = [
                {
                    "tab": row.tab,
                    "page": row.page,
                    "timestamp_utc": row.timestamp_utc,
                    "timestamp_local": row.timestamp_local,
                    "in_range": row.in_range,
                    "text": row.text,
                }
                for row in all_rows
                if row.in_range
            ]
        return result


def parse_ts_local(ts: str, tz_name: str) -> datetime:
    tz = ZoneInfo(tz_name)
    return datetime.strptime(ts, "%Y-%m-%d %H:%M:%S").replace(tzinfo=tz)


def normalize_tabs(raw: str) -> list[str]:
    mapping = {
        "transactions": "Transactions",
        "transfers": "Transfers",
        "activities": "Activities",
    }
    tabs: list[str] = []
    for part in raw.split(","):
        key = part.strip().lower()
        if key in mapping:
            tabs.append(mapping[key])
    if not tabs:
        tabs = ["Transactions", "Transfers", "Activities"]
    return tabs


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Debug parser Solscan tabs by timestamp range for creator/token accounts."
        )
    )
    parser.add_argument("--creator", required=True, help="Creator account")
    parser.add_argument("--token", required=True, help="Token mint account")
    parser.add_argument(
        "--from-local",
        required=True,
        help="Start local time, format: YYYY-MM-DD HH:MM:SS",
    )
    parser.add_argument(
        "--to-local",
        required=True,
        help="End local time, format: YYYY-MM-DD HH:MM:SS",
    )
    parser.add_argument(
        "--tz",
        default=DEFAULT_TZ,
        help=f"Local timezone for input/output (default: {DEFAULT_TZ})",
    )
    parser.add_argument(
        "--tabs",
        default="transactions,transfers,activities",
        help="Comma-separated tabs: transactions,transfers,activities",
    )
    parser.add_argument(
        "--max-pages",
        type=int,
        default=8,
        help="Max pages per tab/account",
    )
    parser.add_argument(
        "--output",
        default="last_rugpulls/solscan_debug.json",
        help="Output json path",
    )
    parser.add_argument(
        "--stdout-only",
        action="store_true",
        help="Print JSON to stdout and do not write output file",
    )
    parser.add_argument(
        "--headless",
        action="store_true",
        help="Run browser in headless mode (less reliable with Cloudflare)",
    )
    parser.add_argument(
        "--timeout-sec",
        type=int,
        default=12,
        help="Wait timeout for page elements",
    )
    parser.add_argument(
        "--settle-sec",
        type=float,
        default=1.0,
        help="Page settle delay after major actions",
    )
    parser.add_argument(
        "--cloudflare-wait-sec",
        type=int,
        default=60,
        help="Max seconds to wait Cloudflare verification",
    )
    args = parser.parse_args()

    local_tz = ZoneInfo(args.tz)
    start_local = parse_ts_local(args.from_local, args.tz)
    end_local = parse_ts_local(args.to_local, args.tz)
    if end_local <= start_local:
        raise ValueError("--to-local must be after --from-local")
    start_utc = start_local.astimezone(UTC)
    end_utc = end_local.astimezone(UTC)
    tabs = normalize_tabs(args.tabs)

    with SolscanDebugParser(
        headless=args.headless,
        timeout_sec=args.timeout_sec,
        settle_sec=args.settle_sec,
        cloudflare_wait_sec=args.cloudflare_wait_sec,
    ) as scraper:
        creator_data = scraper.collect_account_tabs(
            account=args.creator,
            tabs=tabs,
            start_utc=start_utc,
            end_utc=end_utc,
            local_tz=local_tz,
            max_pages=args.max_pages,
        )
        token_data = scraper.collect_account_tabs(
            account=args.token,
            tabs=tabs,
            start_utc=start_utc,
            end_utc=end_utc,
            local_tz=local_tz,
            max_pages=args.max_pages,
        )

    payload = {
        "query": {
            "creator": args.creator,
            "token": args.token,
            "tabs": tabs,
            "tz": args.tz,
            "from_local": start_local.isoformat(),
            "to_local": end_local.isoformat(),
            "from_utc": start_utc.isoformat(),
            "to_utc": end_utc.isoformat(),
            "max_pages": args.max_pages,
            "headless": args.headless,
        },
        "results": {
            "creator": creator_data,
            "token": token_data,
        },
    }

    payload_json = json.dumps(payload, indent=2)
    if args.stdout_only:
        print(payload_json)
        return

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(payload_json, encoding="utf-8")
    print(f"[ok] wrote {output_path}")


if __name__ == "__main__":
    main()
