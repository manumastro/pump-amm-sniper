import argparse
import json
import re
import signal
import socket
import shutil
import tempfile
import time
import traceback
from dataclasses import asdict, dataclass
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

from DrissionPage import ChromiumOptions, ChromiumPage


UTC = ZoneInfo("UTC")
DEFAULT_TZ = "Europe/Berlin"
TIMESTAMP_RE = re.compile(r"(\d{2}:\d{2}:\d{2}\s+[A-Za-z]{3}\s+\d{2},\s+\d{4})")
RELATIVE_RE = re.compile(
    r"(\d+)\s+"
    r"(sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours|day|days|week|weeks|month|months)\s+ago",
    re.IGNORECASE,
)
ITEM_RANGE_RE = re.compile(r"Item\s+(\d+)\s+to\s+(\d+)", re.IGNORECASE)
SHORT_ADDRESS_RE = re.compile(r"\b[1-9A-HJ-NP-Za-km-z]{8,12}\.\.\.[1-9A-HJ-NP-Za-km-z]{8,12}\b")
TOKEN_SUMMARY_FIELDS = [
    "Token name",
    "Current Supply",
    "Holders",
    "Decimals",
    "Authority",
    "Creator",
    "First Mint",
    "Token address",
    "Owner Program",
]


class StepTimeoutError(TimeoutError):
    pass


@contextmanager
def time_limit(seconds: int | float | None, label: str):
    if not seconds or seconds <= 0 or not hasattr(signal, "SIGALRM"):
        yield
        return

    def _handle_timeout(_signum, _frame):
        raise StepTimeoutError(f"{label} exceeded {seconds}s")

    previous_handler = signal.getsignal(signal.SIGALRM)
    signal.signal(signal.SIGALRM, _handle_timeout)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)


def short_account_variants(address: str) -> set[str]:
    variants = {address}
    if len(address) >= 14:
        variants.add(f"{address[:10]}...{address[-10:]}")
    if len(address) >= 12:
        variants.add(f"{address[:8]}...{address[-8:]}")
    return variants


def get_free_local_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


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
        step_timeout_sec: int,
    ):
        self.headless = headless
        self.timeout_sec = timeout_sec
        self.settle_sec = settle_sec
        self.cloudflare_wait_sec = cloudflare_wait_sec
        self.step_timeout_sec = step_timeout_sec
        self.page: ChromiumPage | None = None
        self.current_entity_type: str | None = None
        self.current_entity_address: str | None = None
        self._profile_dir: str | None = None

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
        self._profile_dir = tempfile.mkdtemp(prefix="solscan-debug-")
        co = ChromiumOptions()
        co.set_browser_path(chromium_path)
        co.set_local_port(get_free_local_port())
        co.set_user_data_path(self._profile_dir)
        co.set_tmp_path(self._profile_dir)
        co.set_cache_path(str(Path(self._profile_dir) / "cache"))
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
        if self._profile_dir:
            shutil.rmtree(self._profile_dir, ignore_errors=True)
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

    def _page_debug_state(self) -> dict:
        if not self.page:
            return {"status": "page_not_initialized"}
        try:
            title = (self.page.title or "").strip()
        except Exception:
            title = ""
        try:
            url = (self.page.url or "").strip()
        except Exception:
            url = ""
        body = self._body_text()
        return {
            "status": "ok",
            "title": title[:200],
            "url": url[:500],
            "body_excerpt": body[:1000],
        }

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

    def _open_entity(self, entity_type: str, address: str):
        if not self.page:
            raise RuntimeError("Page not initialized")
        route = "account" if entity_type == "account" else "token"

        # Allow more time for Cloudflare checks. Some pages can take a long time to load.
        open_timeout = max(self.step_timeout_sec, self.cloudflare_wait_sec + 30)

        attempts = 0
        while True:
            attempts += 1
            try:
                with time_limit(open_timeout, f"open {entity_type} {address}"):
                    self.page.get(f"https://solscan.io/{route}/{address}")
                    self._wait_cf_pass()
                    time.sleep(self.settle_sec)
                break
            except StepTimeoutError:
                # If the page takes too long, retry once more before giving up.
                if attempts >= 2:
                    raise
                print(f"[warn] retrying open {entity_type} {address} after timeout (attempt {attempts})")
                time.sleep(1)

        self.current_entity_type = entity_type
        self.current_entity_address = address

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

    def _ensure_entity_page(self, entity_type: str | None = None, address: str | None = None):
        target_entity_type = entity_type or self.current_entity_type
        target_address = address or self.current_entity_address
        if not target_entity_type or not target_address:
            return
        if self._current_page_matches_entity(target_entity_type, target_address):
            return
        self._open_entity(target_entity_type, target_address)
        self._dismiss_cookie_banner()

    def _find_tab(self, tab_name: str):
        if not self.page:
            return None
        selectors = [
            (
                "xpath://*[self::a or self::button]"
                f"[normalize-space(.)='{tab_name}']"
                "[ancestor::*[contains(normalize-space(.), 'Transactions') and "
                "contains(normalize-space(.), 'Transfers') and contains(normalize-space(.), 'Activities')]]"
            ),
            f"xpath://*[self::a or self::button][normalize-space(.)='{tab_name}']",
            f"text:{tab_name}",
        ]
        for selector in selectors:
            try:
                tab = self.page.ele(selector, timeout=1.5)
                if tab:
                    return tab
            except Exception:
                continue
        return None

    def _open_tab(self, tab_name: str, entity_type: str | None = None, address: str | None = None):
        if not self.page:
            raise RuntimeError("Page not initialized")
        with time_limit(self.step_timeout_sec, f"open tab {tab_name}"):
            self._ensure_entity_page(entity_type, address)
            tab = self._find_tab(tab_name)
            if not tab:
                raise RuntimeError(f"Tab not found: {tab_name}")
            tab.click(by_js=True)
            time.sleep(self.settle_sec)
            self._ensure_entity_page(entity_type, address)
            if not self._current_page_matches_entity(entity_type or self.current_entity_type, address or self.current_entity_address):
                raise RuntimeError(f"Tab navigation left target entity: {tab_name}")
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
        elif unit.startswith("hour") or unit.startswith("hr"):
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

    def _current_page_matches_entity(self, entity_type: str, address: str) -> bool:
        if not self.page:
            return False
        try:
            current_url = (self.page.url or "").strip()
        except Exception:
            return False
        route = "account" if entity_type == "account" else "token"
        return f"/{route}/{address}" in current_url

    def _extract_token_summary(self, token: str) -> dict:
        try:
            with time_limit(self.step_timeout_sec, f"token summary {token}"):
                self._open_entity("token", token)
                self._dismiss_cookie_banner()
                body = self._body_text()
                lines = [line.strip() for line in body.splitlines() if line.strip()]
                summary: dict[str, str] = {}
                for index, line in enumerate(lines):
                    if line in TOKEN_SUMMARY_FIELDS:
                        if index + 1 < len(lines):
                            summary[line] = lines[index + 1]
                status = "ok" if summary else "summary_not_found"
                return {
                    "address": token,
                    "summary": summary,
                    "diagnostics": {
                        "status": status,
                        "lines_seen": len(lines),
                        "page": self._page_debug_state(),
                    },
                }
        except Exception as exc:
            return {
                "address": token,
                "summary": {},
                "diagnostics": {
                    "status": "summary_failed",
                    "error": str(exc),
                    "page": self._page_debug_state(),
                },
            }

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

    def collect_entity_tabs(
        self,
        entity_type: str,
        address: str,
        tabs: list[str],
        start_utc: datetime,
        end_utc: datetime,
        local_tz: ZoneInfo,
        max_pages: int,
        progress_cb=None,
    ) -> dict:
        self._open_entity(entity_type, address)
        self._dismiss_cookie_banner()

        result: dict[str, dict] = {}
        for tab in tabs:
            if progress_cb:
                progress_cb(
                    {
                        "entity_type": entity_type,
                        "address": address,
                        "tab": tab,
                        "stage": "opening_tab",
                    }
                )
            try:
                self._open_tab(tab, entity_type, address)
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
                        "page": self._page_debug_state(),
                    },
                }
                if progress_cb:
                    progress_cb(
                        {
                            "entity_type": entity_type,
                            "address": address,
                            "tab": tab,
                            "stage": "tab_open_failed",
                            "error": str(exc),
                        },
                        result[tab],
                    )
                continue

            all_rows: list[ScrapeRow] = []
            pagination_warning: str | None = None
            for page_num in range(1, max_pages + 1):
                try:
                    with time_limit(
                        self.step_timeout_sec, f"extract rows {entity_type}:{address}:{tab}:page{page_num}"
                    ):
                        page_rows = self._extract_page_rows(
                            tab_name=tab,
                            page_num=page_num,
                            start_utc=start_utc,
                            end_utc=end_utc,
                            local_tz=local_tz,
                        )
                except Exception as exc:
                    pagination_warning = f"page_extract_failed:{exc}"
                    break
                if (
                    page_rows
                    and entity_type == "account"
                    and self._rows_conflict_with_account(page_rows, address)
                    and not self._current_page_matches_entity(entity_type, address)
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
                try:
                    with time_limit(
                        self.step_timeout_sec, f"paginate {entity_type}:{address}:{tab}:page{page_num}"
                    ):
                        moved, move_warning = self._go_next_page(previous_first_row, previous_item_range)
                except Exception as exc:
                    moved, move_warning = False, f"page_advance_failed:{exc}"
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
                    "page": self._page_debug_state(),
                },
            }
            if progress_cb:
                progress_cb(
                    {
                        "entity_type": entity_type,
                        "address": address,
                        "tab": tab,
                        "stage": "tab_complete",
                        "status": status,
                        "rows_seen_count": len(rows_seen),
                        "rows_in_range_count": len(rows_in_range),
                    },
                    result[tab],
                )
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
    if results and "creator" in results and isinstance(results.get("creator"), dict):
        scopes = results.items()
    else:
        scopes = [("creator", results)]

    for scope_name, scope_results in scopes:
        for tab, tab_data in scope_results.items():
            diagnostics = tab_data["diagnostics"]
            status = diagnostics["status"]
            if status != "ok":
                warnings.append(
                    f"{scope_name}.{tab}: {status} "
                    f"(seen={diagnostics['rows_seen_count']}, in_range={diagnostics['rows_in_range_count']}, "
                    f"unparsed_ts={diagnostics['rows_without_parsed_timestamp_count']})"
                )
    return warnings


def write_payload_file(output_path: Path, payload: dict):
    payload_json = json.dumps(payload, indent=2)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(payload_json, encoding="utf-8")


def update_progress_payload(
    payload: dict,
    *,
    output_path: Path | None,
    stdout_only: bool,
    warning: str | None = None,
    progress: dict | None = None,
    partial_result: dict | None = None,
):
    payload["updated_at_utc"] = datetime.now(UTC).isoformat()
    if progress is not None:
        payload["progress"] = progress
    if partial_result is not None:
        entity_type = partial_result["entity_type"]
        address = partial_result["address"]
        tab = partial_result["tab"]
        tab_data = partial_result["tab_data"]
        scope = payload.setdefault("results", {}).setdefault(entity_type, {})
        if scope.get("_address") != address:
            scope["_address"] = address
        scope[tab] = tab_data
    if warning:
        warnings = payload.setdefault("warnings", [])
        if warning not in warnings:
            warnings.append(warning)
    if output_path and not stdout_only:
        write_payload_file(output_path=output_path, payload=payload)


def main():
    parser = argparse.ArgumentParser(
        description=(
            "Debug parser Solscan creator account tabs by timestamp range."
        )
    )
    parser.add_argument("--creator", required=True, help="Creator account")
    parser.add_argument("--token", help="Optional token mint to scrape token page too")
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
    parser.add_argument(
        "--step-timeout-sec",
        type=int,
        default=45,
        help="Hard timeout per browser step/tab/page",
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
            "token": args.token,
            "tabs": tabs,
            "scope": "creator" if not args.token else "creator+token",
            "tz": args.tz,
            "from_local": start_local.isoformat(),
            "to_local": end_local.isoformat(),
            "from_utc": start_utc.isoformat(),
            "to_utc": end_utc.isoformat(),
            "max_pages": args.max_pages,
            "headless": args.headless,
        },
        "account": args.creator,
        "token_summary": None,
        "results": {},
        "warnings": [],
        "partial": False,
        "progress": {"stage": "initialized"},
    }
    if args.stdout_only:
        with SolscanDebugParser(
            headless=args.headless,
            timeout_sec=args.timeout_sec,
            settle_sec=args.settle_sec,
            cloudflare_wait_sec=args.cloudflare_wait_sec,
            step_timeout_sec=args.step_timeout_sec,
        ) as scraper:
            payload["results"]["creator"] = scraper.collect_entity_tabs(
                entity_type="account",
                address=args.creator,
                tabs=tabs,
                start_utc=start_utc,
                end_utc=end_utc,
                local_tz=local_tz,
                max_pages=args.max_pages,
            )
            if args.token:
                payload["results"]["token"] = scraper.collect_entity_tabs(
                    entity_type="token",
                    address=args.token,
                    tabs=tabs,
                    start_utc=start_utc,
                    end_utc=end_utc,
                    local_tz=local_tz,
                    max_pages=args.max_pages,
                )
                payload["token_summary"] = scraper._extract_token_summary(args.token)
        payload["warnings"] = build_warnings(payload["results"])
        for warning in payload["warnings"]:
            print(f"[warn] {warning}")
        print(json.dumps(payload, indent=2))
        return

    output_path = Path(args.output)
    creator_data: dict = {}
    payload["partial"] = True
    payload["warnings"] = ["bootstrap: scrape started, results may be incomplete if Solscan stalls"]
    update_progress_payload(
        payload,
        output_path=output_path,
        stdout_only=args.stdout_only,
        progress={"stage": "bootstrap_written"},
    )
    print(f"[ok] wrote bootstrap {output_path}")
    try:
        with SolscanDebugParser(
            headless=args.headless,
            timeout_sec=args.timeout_sec,
            settle_sec=args.settle_sec,
            cloudflare_wait_sec=args.cloudflare_wait_sec,
            step_timeout_sec=args.step_timeout_sec,
        ) as scraper:
            creator_data = scraper.collect_entity_tabs(
                entity_type="account",
                address=args.creator,
                tabs=tabs,
                start_utc=start_utc,
                end_utc=end_utc,
                local_tz=local_tz,
                max_pages=args.max_pages,
                progress_cb=lambda progress, tab_data=None: update_progress_payload(
                    payload,
                    output_path=output_path,
                    stdout_only=args.stdout_only,
                    progress=progress,
                    partial_result=(
                        None
                        if tab_data is None
                        else {
                            "entity_type": progress["entity_type"],
                            "address": progress["address"],
                            "tab": progress["tab"],
                            "tab_data": tab_data,
                        }
                    ),
                ),
            )
            payload["results"] = {"creator": creator_data}
            update_progress_payload(
                payload,
                output_path=output_path,
                stdout_only=args.stdout_only,
                progress={"stage": "creator_complete"},
            )
            if args.token:
                payload["results"]["token"] = scraper.collect_entity_tabs(
                    entity_type="token",
                    address=args.token,
                    tabs=tabs,
                    start_utc=start_utc,
                    end_utc=end_utc,
                    local_tz=local_tz,
                    max_pages=args.max_pages,
                    progress_cb=lambda progress, tab_data=None: update_progress_payload(
                        payload,
                        output_path=output_path,
                        stdout_only=args.stdout_only,
                        progress=progress,
                        partial_result=(
                            None
                            if tab_data is None
                            else {
                                "entity_type": progress["entity_type"],
                                "address": progress["address"],
                                "tab": progress["tab"],
                                "tab_data": tab_data,
                            }
                        ),
                    ),
                )
                update_progress_payload(
                    payload,
                    output_path=output_path,
                    stdout_only=args.stdout_only,
                    progress={"stage": "token_tabs_complete"},
                )
                payload["token_summary"] = scraper._extract_token_summary(args.token)
                update_progress_payload(
                    payload,
                    output_path=output_path,
                    stdout_only=args.stdout_only,
                    progress={"stage": "token_summary_complete"},
                )
    except Exception as exc:
        if not payload["results"]:
            payload["results"] = {"creator": creator_data}
        payload["partial"] = True
        update_progress_payload(
            payload,
            output_path=output_path,
            stdout_only=args.stdout_only,
            warning=f"scrape_failed: {exc}",
            progress={
                "stage": "failed",
                "error": str(exc),
                "traceback": traceback.format_exc(limit=5),
            },
        )
        print(f"[warn] scrape failed: {exc}")
        return

    if not payload["results"]:
        payload["results"] = {"creator": creator_data}
    payload["partial"] = False
    payload["warnings"] = build_warnings(payload["results"])
    update_progress_payload(
        payload,
        output_path=output_path,
        stdout_only=args.stdout_only,
        progress={"stage": "completed"},
    )
    print(f"[ok] wrote {output_path}")
    for warning in payload["warnings"]:
        print(f"[warn] {warning}")


if __name__ == "__main__":
    main()
