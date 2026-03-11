import argparse
import json
import re
import shutil
import time
from dataclasses import asdict, dataclass
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
ITEM_RANGE_RE = re.compile(r"Item\s+(\d+)\s+to\s+(\d+)", re.IGNORECASE)
SHORT_ADDRESS_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{8,12}\.\.\.[1-9A-HJ-NP-Za-km-z]{8,12}\b")


def short_account_variants(address: str) -> set[str]:
    variants = {address}
    if len(address) >= 14:
        variants.add(f"{address[:10]}...{address[-10:]}")
    if len(address) >= 12:
        variants.add(f"{address[:8]}...{address[-8:]}")
    return variants


@dataclass
class ScrapeRow:
    tab: str
    page: int
    timestamp_utc: str | None
    timestamp_local: str | None
    timestamp_source: str
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
        self._try_enable_absolute_timestamps()
        if not self.page.ele("xpath://table//tbody//tr", timeout=self.timeout_sec):
            raise RuntimeError(f"No table rows found on tab {tab_name}")

    def _try_enable_absolute_timestamps(self):
        if not self.page:
            return

        selectors = [
            "xpath://th[.//*[contains(normalize-space(.), 'Time')]]//*[name()='svg' and contains(@class, 'lucide-clock')]/parent::*",
            "xpath://th[.//*[contains(normalize-space(.), 'Time')]]//*[name()='svg' and contains(@class, 'lucide-clock')]",
            "xpath://th[.//*[contains(normalize-space(.), 'Time')]]//*[contains(@class, 'cursor-pointer')][1]",
        ]

        for selector in selectors:
            try:
                control = self.page.ele(selector, timeout=1)
                if not control:
                    continue
                before = (self.page.ele("xpath://table//tbody//tr[1]", timeout=1).text or "").strip()
                control.click(by_js=True)
                time.sleep(0.5)
                after = (self.page.ele("xpath://table//tbody//tr[1]", timeout=1).text or "").strip()
                if after and after != before:
                    return
            except Exception:
                continue

    def _row_timestamp_utc(
        self, text: str, now_utc: datetime
    ) -> tuple[datetime | None, str]:
        match = TIMESTAMP_RE.search(text)
        if match:
            raw = match.group(1)
            try:
                dt = datetime.strptime(raw, "%H:%M:%S %b %d, %Y")
                return dt.replace(tzinfo=UTC), "absolute"
            except ValueError:
                pass

        lowered = text.lower()
        if "just now" in lowered:
            return now_utc, "relative"

        rel = RELATIVE_RE.search(lowered)
        if not rel:
            return None, "unknown"
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
            return None, "unknown"
        return now_utc - timedelta(seconds=seconds), "relative"

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
            ts_utc, timestamp_source = self._row_timestamp_utc(text, now_utc)
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
                    timestamp_source=timestamp_source,
                    in_range=in_range,
                    text=text,
                )
            )
        return parsed

    def _rows_conflict_with_account(self, rows: list[ScrapeRow], account: str) -> bool:
        variants = short_account_variants(account)
        found_short_addresses = {
            match.group(0)
            for row in rows
            for match in SHORT_ADDRESS_RE.finditer(row.text)
        }
        if not found_short_addresses:
            return False
        if found_short_addresses & variants:
            return False
        return True

    def _current_page_matches_account(self, account: str) -> bool:
        if not self.page:
            return False
        try:
            current_url = (self.page.url or "").strip()
        except Exception:
            return False
        return f"/account/{account}" in current_url

    def _current_item_range(self) -> str | None:
        body = self._body_text()
        match = ITEM_RANGE_RE.search(body)
        if not match:
            return None
        return f"{match.group(1)}-{match.group(2)}"

    def _pagination_footer(self):
        if not self.page:
            return None
        selectors = [
            "xpath://div[contains(@class, 'bg-neutral0') and contains(@class, 'border-t') and contains(., 'per page') and contains(., 'Item ')]",
            "xpath://div[contains(., 'per page') and contains(., 'Item ') and .//button]",
        ]
        for selector in selectors:
            try:
                footer = self.page.ele(selector, timeout=1)
                if footer:
                    return footer
            except Exception:
                continue
        return None

    def _footer_pager_buttons(self):
        footer = self._pagination_footer()
        if not footer:
            return []
        try:
            buttons = footer.eles("tag:button") or []
        except Exception:
            return []
        pager_buttons = []
        for button in buttons:
            text = (button.text or "").strip()
            classes = (button.attr("class") or "").lower()
            if text.isdigit() or "combobox" in classes:
                continue
            pager_buttons.append(button)
        return pager_buttons

    def _click_visible_next_pager(self) -> bool:
        if not self.page:
            return False
        try:
            return bool(
                self.page.run_js(
                    """
                    function isVisible(el) {
                      return !!(el && el.offsetParent !== null && el.getClientRects().length);
                    }
                    const footers = [...document.querySelectorAll('div')]
                      .filter(el => {
                        const text = (el.innerText || '').trim();
                        return text.includes('per page') && text.includes('Item ') && isVisible(el);
                      })
                      .sort((a, b) => a.innerText.length - b.innerText.length);
                    const footer = footers[0];
                    if (!footer) return false;
                    const buttons = [...footer.querySelectorAll('button')];
                    const pager = buttons.filter(button => !/^\\d+$/.test((button.innerText || '').trim()));
                    const next = [...pager]
                      .reverse()
                      .find(button => !button.disabled && button.getAttribute('aria-disabled') !== 'true');
                    if (!next) return false;
                    ['pointerdown', 'mousedown', 'mouseup', 'click'].forEach(type =>
                      next.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }))
                    );
                    return true;
                    """
                )
            )
        except Exception:
            return False

    def _go_next_page(
        self,
        previous_first_row: str | None,
        previous_item_range: str | None,
    ) -> tuple[bool, str | None]:
        if not self.page:
            return False, "page_not_initialized"
        if self._click_visible_next_pager():
            time.sleep(self.settle_sec)
            first_row = self.page.ele("xpath://table//tbody//tr[1]", timeout=self.timeout_sec)
            first_row_text = (first_row.text or "").strip() if first_row else ""
            item_range = self._current_item_range()
            if first_row_text:
                row_unchanged = previous_first_row and first_row_text == previous_first_row
                range_unchanged = previous_item_range and item_range == previous_item_range
                if not (row_unchanged and (previous_item_range is None or range_unchanged)):
                    return True, None

        candidates = []
        pager_buttons = self._footer_pager_buttons()
        if pager_buttons:
            candidates.extend(reversed(pager_buttons))
        text_candidates = self.page.eles(
            "xpath://button[contains(., 'Next')] | //a[contains(., 'Next')]"
        ) or []
        candidates.extend(text_candidates)
        for candidate in candidates:
            classes = (candidate.attr("class") or "").lower()
            aria_disabled = (candidate.attr("aria-disabled") or "").lower()
            disabled = candidate.attr("disabled")
            if (
                "disabled" in classes
                or aria_disabled == "true"
                or disabled is not None
            ):
                continue
            try:
                candidate.click(by_js=True)
                time.sleep(self.settle_sec)
                first_row = self.page.ele("xpath://table//tbody//tr[1]", timeout=self.timeout_sec)
                first_row_text = (first_row.text or "").strip() if first_row else ""
                item_range = self._current_item_range()
                if not first_row_text:
                    continue
                row_unchanged = previous_first_row and first_row_text == previous_first_row
                range_unchanged = previous_item_range and item_range == previous_item_range
                if row_unchanged and (previous_item_range is None or range_unchanged):
                    continue
                return True, None
            except Exception:
                continue
        return False, "pagination_stalled"

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

        result: dict[str, dict] = {}
        for tab in tabs:
            try:
                self._open_tab(tab)
            except Exception as exc:
                result[tab] = {
                    "rows_seen": [],
                    "rows_in_range": [],
                    "diagnostics": {
                        "status": "tab_open_failed",
                        "error": str(exc),
                        "rows_seen_count": 0,
                        "rows_in_range_count": 0,
                        "rows_with_parsed_timestamp_count": 0,
                        "rows_without_parsed_timestamp_count": 0,
                    },
                }
                continue

            all_rows: list[ScrapeRow] = []
            pagination_warning: str | None = None
            for page_num in range(1, max_pages + 1):
                page_rows = self._extract_page_rows(
                    tab_name=tab,
                    page_num=page_num,
                    start_utc=start_utc,
                    end_utc=end_utc,
                    local_tz=local_tz,
                )
                if (
                    page_rows
                    and self._rows_conflict_with_account(page_rows, account)
                    and not self._current_page_matches_account(account)
                ):
                    all_rows = page_rows
                    pagination_warning = "account_mismatch"
                    break
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
                previous_first_row = page_rows[0].text if page_rows else None
                previous_item_range = self._current_item_range()
                moved, move_warning = self._go_next_page(previous_first_row, previous_item_range)
                if not moved:
                    pagination_warning = move_warning
                    break

            rows_seen = [asdict(row) for row in all_rows]
            rows_in_range = [asdict(row) for row in all_rows if row.in_range]
            rows_with_parsed_timestamp = sum(1 for row in all_rows if row.timestamp_utc)
            rows_without_parsed_timestamp = len(all_rows) - rows_with_parsed_timestamp
            rows_with_relative_timestamp = sum(
                1 for row in all_rows if row.timestamp_source == "relative"
            )
            rows_with_absolute_timestamp = sum(
                1 for row in all_rows if row.timestamp_source == "absolute"
            )

            status = "ok"
            if not all_rows:
                status = "no_rows_seen"
            elif pagination_warning == "account_mismatch":
                status = "rows_seen_account_mismatch"
            elif not rows_in_range and rows_without_parsed_timestamp == len(all_rows):
                status = "rows_seen_but_timestamps_unparsed"
            elif not rows_in_range and rows_with_relative_timestamp > 0:
                status = "rows_seen_but_none_in_range_relative_time_only"
            elif not rows_in_range:
                status = "rows_seen_but_none_in_range"
            elif pagination_warning == "pagination_stalled":
                status = "ok_pagination_stalled"

            result[tab] = {
                "rows_seen": rows_seen,
                "rows_in_range": rows_in_range,
                "diagnostics": {
                    "status": status,
                    "pagination_warning": pagination_warning,
                    "rows_seen_count": len(rows_seen),
                    "rows_in_range_count": len(rows_in_range),
                    "rows_with_parsed_timestamp_count": rows_with_parsed_timestamp,
                    "rows_without_parsed_timestamp_count": rows_without_parsed_timestamp,
                    "rows_with_relative_timestamp_count": rows_with_relative_timestamp,
                    "rows_with_absolute_timestamp_count": rows_with_absolute_timestamp,
                },
            }
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


def build_warnings(results: dict) -> list[str]:
    warnings: list[str] = []
    for tab, tab_data in results.items():
        diagnostics = tab_data["diagnostics"]
        status = diagnostics["status"]
        if status != "ok":
            warnings.append(
                f"{tab}: {status} "
                f"(seen={diagnostics['rows_seen_count']}, in_range={diagnostics['rows_in_range_count']}, "
                f"unparsed_ts={diagnostics['rows_without_parsed_timestamp_count']})"
            )
    return warnings


def write_payload_file(output_path: Path, payload: dict):
    payload_json = json.dumps(payload, indent=2)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(payload_json, encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Debug parser Solscan creator account tabs by timestamp range."
        )
    )
    parser.add_argument("--creator", required=True, help="Creator account")
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
        "--scope",
        choices=["creator"],
        default="creator",
        help="Creator-only scrape scope",
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

    payload = {
        "query": {
            "creator": args.creator,
            "tabs": tabs,
            "scope": "creator",
            "tz": args.tz,
            "from_local": start_local.isoformat(),
            "to_local": end_local.isoformat(),
            "from_utc": start_utc.isoformat(),
            "to_utc": end_utc.isoformat(),
            "max_pages": args.max_pages,
            "headless": args.headless,
        },
        "account": args.creator,
        "results": {},
        "warnings": [],
        "partial": False,
    }
    if args.stdout_only:
        with SolscanDebugParser(
            headless=args.headless,
            timeout_sec=args.timeout_sec,
            settle_sec=args.settle_sec,
            cloudflare_wait_sec=args.cloudflare_wait_sec,
        ) as scraper:
            payload["results"] = scraper.collect_account_tabs(
                account=args.creator,
                tabs=tabs,
                start_utc=start_utc,
                end_utc=end_utc,
                local_tz=local_tz,
                max_pages=args.max_pages,
            )
        payload["warnings"] = build_warnings(payload["results"])
        for warning in payload["warnings"]:
            print(f"[warn] {warning}")
        print(json.dumps(payload, indent=2))
        return

    output_path = Path(args.output)
    creator_data: dict = {}
    payload["partial"] = True
    payload["warnings"] = ["bootstrap: scrape started, results may be incomplete if Solscan stalls"]
    write_payload_file(output_path=output_path, payload=payload)
    print(f"[ok] wrote bootstrap {output_path}")

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

    payload["results"] = creator_data
    payload["partial"] = False
    payload["warnings"] = build_warnings(payload["results"])
    write_payload_file(output_path=output_path, payload=payload)
    print(f"[ok] wrote {output_path}")
    for warning in payload["warnings"]:
        print(f"[warn] {warning}")


if __name__ == "__main__":
    main()
