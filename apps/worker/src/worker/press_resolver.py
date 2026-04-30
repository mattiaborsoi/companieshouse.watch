"""Phase 4: per-company press mentions via GDELT.

GDELT DOC API (https://api.gdeltproject.org/api/v2/doc/doc) is free and
unauthenticated. We query for the exact company name (with LIMITED/LTD/PLC
suffix preserved for disambiguation), filter the results, and cache for
seven days. Empty results extend the cache to 90 days.

Tone: descriptive, never accusatory. Headlines are quoted verbatim. We
never derive sentiment or apply tags.
"""
import asyncio
import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import asyncpg
import httpx
import structlog

log = structlog.get_logger()


GDELT_ENDPOINT = "https://api.gdeltproject.org/api/v2/doc/doc"
USER_AGENT = "companieshouse.watch/1.0 (+https://ch.borsoi.co.uk/about)"

# GDELT explicitly asks for ≤1 req per 5 s — anything faster returns a
# plain-text "please limit" message in place of JSON.
_MIN_INTERVAL_SECONDS = 5.5
_FETCH_TIMEOUT = 12.0
_MAX_RECORDS = 25
_TIMESPAN = "2y"

# Domains that aren't real journalism — PR wires, content farms, scrapers.
_LOW_QUALITY_DOMAINS: frozenset[str] = frozenset({
    "prnewswire.com", "businesswire.com", "globenewswire.com",
    "marketscreener.com", "marketwatch.com",  # mostly auto-republished
    "seekingalpha.com", "stocktitan.net", "fool.com",
    "menafn.com", "zawya.com",
    "tipranks.com", "simplywall.st",
    # CH itself
    "find-and-update.company-information.service.gov.uk",
    "companieshouse.gov.uk",
    # Aggregators that just reproduce CH data
    "opencorporates.com", "endole.co.uk", "tracxn.com",
})

# Some company names — once stripped of LIMITED/LTD/PLC — are too generic to
# search reliably. The query phrase includes the suffix as a disambiguator,
# so even short brand names like "TESCO PLC" or "BP PLC" can be searched.
# Block 1-3 char stripped names ("ABC LIMITED" etc.) which would be noise.
_MIN_QUERYABLE_LENGTH = 4

_NAME_SUFFIX_RE = re.compile(
    r"\s+(LIMITED|LTD\.?|PLC|LLP|LP|UK LTD|HOLDINGS|GROUP|COMPANY)\.?$",
    re.IGNORECASE,
)


@dataclass
class PressArticle:
    url: str
    title: str
    domain: str
    seendate: str  # GDELT date string YYYYMMDDTHHMMSSZ
    language: str

    @property
    def published_at(self) -> datetime:
        return datetime.strptime(self.seendate, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)


def _short_name(name: str) -> str:
    return _NAME_SUFFIX_RE.sub("", name).strip()


def _build_query(name: str) -> str | None:
    short = _short_name(name)
    if len(short) < _MIN_QUERYABLE_LENGTH:
        return None
    # Quoted full registered name catches articles that include the suffix.
    # Add LANG:eng to keep results English-language.
    return f'"{name}" sourcelang:english'


_last_request_at: float = 0.0
_request_lock = asyncio.Lock()


async def _gdelt_get(query: str) -> dict | None:
    global _last_request_at
    import time as _t
    async with _request_lock:
        elapsed = _t.monotonic() - _last_request_at
        if elapsed < _MIN_INTERVAL_SECONDS:
            await asyncio.sleep(_MIN_INTERVAL_SECONDS - elapsed)
        try:
            async with httpx.AsyncClient(
                timeout=_FETCH_TIMEOUT, headers={"User-Agent": USER_AGENT}
            ) as client:
                resp = await client.get(
                    GDELT_ENDPOINT,
                    params={
                        "query": query,
                        "mode": "ArtList",
                        "format": "json",
                        "timespan": _TIMESPAN,
                        "maxrecords": str(_MAX_RECORDS),
                        "sort": "DateDesc",
                    },
                )
            _last_request_at = _t.monotonic()
        except (httpx.HTTPError, OSError) as e:
            log.warning("gdelt_request_error", error=str(e))
            return None

    if resp.status_code != 200:
        log.warning("gdelt_http_error", status=resp.status_code)
        return None

    # GDELT often returns valid-looking text with embedded HTML on errors;
    # try JSON parse and bail on anything weird.
    try:
        return resp.json()
    except (ValueError, json.JSONDecodeError):
        log.warning("gdelt_invalid_json")
        return None


def _domain_excluded(url: str) -> bool:
    netloc = urlparse(url).netloc.lower()
    if netloc.startswith("www."):
        netloc = netloc[4:]
    if netloc in _LOW_QUALITY_DOMAINS:
        return True
    return any(netloc.endswith("." + ex) for ex in _LOW_QUALITY_DOMAINS)


def _parse_articles(raw: dict) -> list[PressArticle]:
    items = raw.get("articles") or []
    out: list[PressArticle] = []
    for it in items:
        url = (it.get("url") or "").strip()
        title = (it.get("title") or "").strip()
        seendate = (it.get("seendate") or "").strip()
        if not url or not title or not seendate:
            continue
        if _domain_excluded(url):
            continue
        domain = (it.get("domain") or "").lower().strip()
        if domain.startswith("www."):
            domain = domain[4:]
        out.append(PressArticle(
            url=url,
            title=title[:500],
            domain=domain[:100],
            seendate=seendate,
            language=(it.get("language") or "eng").lower(),
        ))
    return out


# ── DB upserts ───────────────────────────────────────────────


_UPSERT_ARTICLE_SQL = """
INSERT INTO public.company_press
    (company_number, headline, url, source_domain, published_at, language, raw)
VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
ON CONFLICT (company_number, url) DO UPDATE SET
    headline      = EXCLUDED.headline,
    source_domain = EXCLUDED.source_domain,
    published_at  = EXCLUDED.published_at
"""


_UPSERT_RESOLUTION_SQL = """
INSERT INTO public.company_press_resolutions
    (company_number, last_searched_at, next_search_at, result_count, consecutive_empties, last_error)
VALUES ($1, now(), $2, $3, $4, $5)
ON CONFLICT (company_number) DO UPDATE SET
    last_searched_at    = now(),
    next_search_at      = EXCLUDED.next_search_at,
    result_count        = EXCLUDED.result_count,
    consecutive_empties = EXCLUDED.consecutive_empties,
    last_error          = EXCLUDED.last_error
"""


async def resolve_company_press(pool: asyncpg.Pool, company_number: str) -> dict:
    bound = log.bind(job="resolve_press", company_number=company_number)

    company = await pool.fetchrow(
        "SELECT name, status FROM public.companies WHERE company_number = $1",
        company_number,
    )
    if not company:
        return {"status": "no_company"}

    name = company["name"]
    query = _build_query(name)
    if not query:
        # Name too short to query usefully — back off for 90 days.
        await pool.execute(
            _UPSERT_RESOLUTION_SQL,
            company_number,
            datetime.now(timezone.utc) + timedelta(days=90),
            0, 99, "name_too_short",
        )
        return {"status": "name_too_short"}

    raw = await _gdelt_get(query)
    if raw is None:
        await pool.execute(
            _UPSERT_RESOLUTION_SQL,
            company_number,
            datetime.now(timezone.utc) + timedelta(days=1),
            0, 0, "gdelt_error",
        )
        return {"status": "gdelt_error"}

    articles = _parse_articles(raw)

    inserted = 0
    for a in articles:
        try:
            await pool.execute(
                _UPSERT_ARTICLE_SQL,
                company_number, a.title, a.url, a.domain,
                a.published_at, a.language,
                json.dumps({"seendate": a.seendate, "domain": a.domain}),
            )
            inserted += 1
        except asyncpg.PostgresError as e:
            bound.warning("press_upsert_failed", url=a.url, error=str(e))

    # Cache: 7 days when we found something, 90 days after 3 consecutive empties.
    if articles:
        next_at = datetime.now(timezone.utc) + timedelta(days=7)
        empties = 0
    else:
        prev = await pool.fetchval(
            "SELECT consecutive_empties FROM public.company_press_resolutions WHERE company_number = $1",
            company_number,
        )
        empties = (prev or 0) + 1
        next_at = datetime.now(timezone.utc) + timedelta(days=90 if empties >= 3 else 7)

    await pool.execute(_UPSERT_RESOLUTION_SQL, company_number, next_at, len(articles), empties, None)
    bound.info("press_resolve_complete", articles=len(articles), inserted=inserted)
    return {"status": "ok", "articles": len(articles), "inserted": inserted}


# ── Cron: process a batch ──────────────────────────────────────


_BATCH_SQL = """
    SELECT c.company_number
    FROM public.companies c
    LEFT JOIN public.company_press_resolutions r ON r.company_number = c.company_number
    WHERE c.status = 'active'
      AND length(regexp_replace(c.name, '\\s+(LIMITED|LTD|PLC|LLP|LP|HOLDINGS|GROUP|COMPANY)\\.?$', '', 'i')) >= 4
      AND (r.company_number IS NULL OR r.next_search_at < now())
    ORDER BY c.last_event_at DESC NULLS LAST
    LIMIT $1
"""

# GDELT requires ≥5.5 s between requests. 5.5 s × 8 = 44 s per cron tick,
# safely within the 1-min cron window. Hourly tick × 8 = 192/day.
_BATCH_SIZE = 8


async def resolve_press_batch(ctx: dict) -> None:
    pool: asyncpg.Pool = ctx["pool"]
    bound = log.bind(job="resolve_press_batch")

    rows = await pool.fetch(_BATCH_SQL, _BATCH_SIZE)
    if not rows:
        bound.info("nothing_to_resolve")
        return

    resolved = 0
    failed = 0
    for r in rows:
        try:
            await resolve_company_press(pool, r["company_number"])
            resolved += 1
        except Exception as e:
            bound.warning("resolve_press_failed", company_number=r["company_number"], error=str(e))
            failed += 1

    bound.info("press_batch_complete", resolved=resolved, failed=failed, batch_size=len(rows))
