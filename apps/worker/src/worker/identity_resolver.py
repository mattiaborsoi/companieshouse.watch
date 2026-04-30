"""Company identity resolution.

Given a company_number, find the company's real-world website (and pull title +
description + favicon URL). Strategy:

  1. Search Brave for "<COMPANY NAME>" + 'official website' (or similar).
  2. Filter out known-non-corporate domains (social media, encyclopaedias,
     data aggregators, our own site, the Companies House site).
  3. Fetch the top remaining 3 candidates' homepages.
  4. Score each by: name match in body? company number in body? prefer .co.uk
     and the company's own .com domain.
  5. Best scorer above threshold wins; otherwise mark as 'none'.

All results are upserted into public.company_identity.
"""
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import urlparse

import asyncpg
import structlog

from . import brave_search
from .http_fetcher import fetch_page

log = structlog.get_logger()


# Domains we never want to surface as a company's official website.
_EXCLUDED_DOMAINS: frozenset[str] = frozenset({
    # Our own
    "companieshouse.watch", "ch.borsoi.co.uk", "borsoi.co.uk",
    # Companies House itself
    "find-and-update.company-information.service.gov.uk",
    "companieshouse.gov.uk", "gov.uk",
    # Encyclopaedias / archives
    "wikipedia.org", "en.wikipedia.org", "wikidata.org", "wikimedia.org",
    "commons.wikimedia.org", "archive.org", "web.archive.org",
    "essexarchivesonline.co.uk",
    # Social media
    "facebook.com", "twitter.com", "x.com", "instagram.com",
    "linkedin.com", "youtube.com", "tiktok.com", "reddit.com",
    "pinterest.com", "threads.net",
    # Data brokers / aggregators
    "globaldata.com", "crunchbase.com", "bloomberg.com", "reuters.com",
    "opencorporates.com", "duedil.com", "endole.co.uk",
    "companycheck.co.uk", "company-check.co.uk", "ukdata.com",
    "companieslist.co.uk", "companysearchesmadesimple.com",
    "dnb.com", "kompass.com", "yell.com", "thomsondirectories.com",
    "tracxn.com", "pitchbook.com", "owler.com", "zoominfo.com",
    "rocketreach.co", "signalhire.com", "lusha.com",
    "creditsafe.com", "creditsafe.co.uk", "experian.com", "experian.co.uk",
    "ukbusinessforums.co.uk", "businessmagnet.co.uk", "scoot.co.uk",
    "freshbusinessthinking.com", "checkmycompany.co.uk",
    "northdata.com", "bizdb.co.uk", "corpwatch.org",
    "alfabank.com",  # appears in some search results
    "orpha.net",     # rare-disease registry, not company sites
    # Job boards
    "indeed.com", "glassdoor.com", "reed.co.uk", "totaljobs.com",
    # App stores
    "apps.apple.com", "play.google.com",
    # News (not a company's official site)
    "bbc.co.uk", "bbc.com", "theguardian.com", "ft.com", "telegraph.co.uk",
})

_RE_NAME_SUFFIXES = re.compile(
    r"\s+(LIMITED|LTD\.?|PLC|LLP|LP|UK LTD|LTD UK|HOLDINGS|GROUP)\.?$",
    re.IGNORECASE,
)

# Score thresholds for resolution_confidence
_HIGH = "high"        # name + number found on page
_MEDIUM = "medium"    # name found
_LOW = "low"          # only domain heuristic
_NONE = "none"


def _domain_excluded(url: str) -> bool:
    netloc = urlparse(url).netloc.lower()
    # Strip the literal "www." prefix only — lstrip("www.") would eat arbitrary
    # leading {w, .} chars (e.g. "wikidata.org" → "ikidata.org").
    if netloc.startswith("www."):
        netloc = netloc[4:]
    if netloc in _EXCLUDED_DOMAINS:
        return True
    return any(netloc.endswith("." + ex) for ex in _EXCLUDED_DOMAINS)


def _short_name(name: str) -> str:
    """Drop the LIMITED/PLC/LTD suffix to get a more searchable name."""
    return _RE_NAME_SUFFIXES.sub("", name).strip()


_TWO_PART_TLD_SLDS = {"co", "com", "org", "net", "gov", "ac", "edu", "ltd"}


def _domain_root(domain: str) -> str:
    """Extract the meaningful label from a domain.

      www.greggs.com    → greggs
      greggs.co.uk      → greggs
      monzo.com         → monzo
      sub.example.co.uk → example
    """
    domain = domain.lower()
    if domain.startswith("www."):
        domain = domain[4:]
    parts = [p for p in domain.split(".") if p]
    if len(parts) < 2:
        return ""
    # Two-part TLDs like .co.uk, .com.au — back up one more component
    if len(parts) >= 3 and parts[-2] in _TWO_PART_TLD_SLDS:
        return parts[-3]
    return parts[-2]


def _domain_matches_name(domain: str, company_name: str) -> bool:
    """True if the domain's root looks related to the company name.

    Used as a backstop for medium-confidence matches: a real corporate website
    typically uses a domain derived from the company name. An aggregator's
    domain (tracxn.com, crunchbase.com, etc.) does not.
    """
    import re
    domain_alpha = re.sub(r"[^a-z]", "", _domain_root(domain))
    name_alpha = re.sub(r"[^a-z]", "", _short_name(company_name).lower())
    if not domain_alpha or not name_alpha or len(domain_alpha) < 3:
        return False
    if domain_alpha in name_alpha or name_alpha in domain_alpha:
        return True
    # Token overlap (e.g. domain "monzo" matches name "MONZO BANK")
    name_tokens = set(re.findall(r"[a-z]{3,}", _short_name(company_name).lower()))
    if domain_alpha in name_tokens:
        return True
    return False


def _score_match(
    page_text_lower: str,
    company_name: str,
    company_number: str,
    final_url: str,
) -> str:
    short = _short_name(company_name).lower()
    name_match = bool(short) and short in page_text_lower
    number_match = company_number.lower() in page_text_lower
    domain = urlparse(final_url).netloc
    domain_match = _domain_matches_name(domain, company_name)

    if name_match and number_match:
        return _HIGH
    # Medium = name on page AND domain looks like company name.
    # Without domain-match we'd accept aggregators; without name-match we'd accept random pages.
    if name_match and domain_match:
        return _MEDIUM
    # Domain-only match is weak — only accept if the page has the name too.
    return _LOW


async def _build_query(company_name: str) -> str:
    short = _short_name(company_name)
    return f'"{short}" official website'


async def resolve_company_identity(
    pool: asyncpg.Pool,
    company_number: str,
) -> dict:
    """Resolve a single company. Upserts into public.company_identity.

    Returns the upserted row (as a dict). Safe to call multiple times — uses
    next_check_at to back off failures.
    """
    bound = log.bind(job="resolve_identity", company_number=company_number)

    company = await pool.fetchrow(
        "SELECT name, status FROM public.companies WHERE company_number = $1",
        company_number,
    )
    if not company:
        bound.warning("company_not_found")
        return {"resolution_method": _NONE, "resolution_confidence": _NONE}

    name = company["name"]
    short = _short_name(name)
    if len(short) < 4:
        # "ABC LTD" or similar very-generic names won't search usefully.
        # Mark as resolved-with-no-result and back off.
        await _upsert_none(pool, company_number, reason="name_too_short")
        return {"resolution_method": _NONE, "resolution_confidence": _NONE}

    query = await _build_query(name)
    bound.info("brave_search_query", query=query)
    results = await brave_search.search(query, count=10)

    candidates = [r for r in results if r.url and not _domain_excluded(r.url)]
    candidates = candidates[:3]

    if not candidates:
        bound.info("no_candidates_after_filter")
        await _upsert_none(pool, company_number, reason="no_candidates")
        return {"resolution_method": _NONE, "resolution_confidence": _NONE}

    best = None
    best_confidence = _NONE
    for c in candidates:
        page = await fetch_page(c.url)
        if not page:
            continue

        # Re-check after redirects — a result might redirect to an excluded domain
        # (e.g. find-and-update.company-information... CH redirects).
        if _domain_excluded(page.final_url):
            bound.info("excluded_after_redirect", url=c.url, final_url=page.final_url)
            continue

        confidence = _score_match(page.body_text_lower, name, company_number, page.final_url)
        bound.info(
            "candidate_fetched",
            url=c.url,
            final_url=page.final_url,
            confidence=confidence,
        )

        # Prefer higher confidence; on ties, prefer the first (Brave's ranking).
        if _confidence_rank(confidence) > _confidence_rank(best_confidence):
            best = (page, confidence)
            best_confidence = confidence
            if confidence == _HIGH:
                break  # can't beat high

    # Reject low-confidence matches outright. "low" means we found a candidate
    # whose page doesn't even contain the company name — that's not a match,
    # that's a guess. Mark as 'none' and back off.
    if not best or best_confidence in (_NONE, _LOW):
        await _upsert_none(pool, company_number, reason="no_confident_match")
        return {"resolution_method": _NONE, "resolution_confidence": _NONE}

    page, confidence = best

    # Cache for: 180 days for high, 60 for medium
    next_check_days = {"high": 180, "medium": 60}[confidence]
    next_check_at = datetime.now(timezone.utc) + timedelta(days=next_check_days)

    row = await pool.fetchrow("""
        INSERT INTO public.company_identity (
            company_number, website_url, website_title, website_description,
            favicon_url, resolution_method, resolution_confidence,
            resolved_at, next_check_at, failure_count
        ) VALUES (
            $1, $2, $3, $4, $5, 'search', $6, now(), $7, 0
        )
        ON CONFLICT (company_number) DO UPDATE SET
            website_url           = EXCLUDED.website_url,
            website_title         = EXCLUDED.website_title,
            website_description   = EXCLUDED.website_description,
            favicon_url           = EXCLUDED.favicon_url,
            resolution_method     = EXCLUDED.resolution_method,
            resolution_confidence = EXCLUDED.resolution_confidence,
            resolved_at           = now(),
            next_check_at         = EXCLUDED.next_check_at,
            failure_count         = 0,
            last_failure_at       = NULL
        WHERE NOT public.company_identity.override_locked
        RETURNING *
    """, company_number, page.final_url, page.title, page.description,
        page.favicon_url, confidence, next_check_at)

    bound.info(
        "identity_resolved",
        url=page.final_url,
        confidence=confidence,
    )
    return dict(row) if row else {}


def _confidence_rank(c: str) -> int:
    return {"none": 0, "low": 1, "medium": 2, "high": 3}.get(c, 0)


async def _upsert_none(pool: asyncpg.Pool, company_number: str, reason: str) -> None:
    """Mark a company as 'tried, found nothing'. Back off retry by 180 days."""
    next_check_at = datetime.now(timezone.utc) + timedelta(days=180)
    await pool.execute("""
        INSERT INTO public.company_identity (
            company_number, resolution_method, resolution_confidence,
            resolved_at, next_check_at, failure_count, notes
        ) VALUES (
            $1, 'none', 'none', now(), $2, 0, $3
        )
        ON CONFLICT (company_number) DO UPDATE SET
            resolution_method     = 'none',
            resolution_confidence = 'none',
            resolved_at           = now(),
            next_check_at         = $2,
            notes                 = $3
        WHERE NOT public.company_identity.override_locked
    """, company_number, next_check_at, f"resolved_to_none:{reason}")


# ── Cron job: resolve a batch of unresolved active companies ─────────────────

# Pick the most-recently-active companies first — they're the most likely
# to be viewed and to actually have a website.
_BATCH_SQL = """
    SELECT c.company_number
    FROM public.companies c
    LEFT JOIN public.company_identity ci ON ci.company_number = c.company_number
    WHERE c.status = 'active'
      AND (ci.company_number IS NULL OR ci.next_check_at < now())
      AND (ci.override_locked IS NULL OR ci.override_locked = false)
    ORDER BY c.last_event_at DESC NULLS LAST
    LIMIT $1
"""

# Brave free tier: 2000/month = ~67/day. We run hourly with batch of 2 = 48/day,
# leaving ~28% headroom for retries and bursts.
_BATCH_SIZE = 2


async def resolve_batch(ctx: dict) -> None:
    """Cron: resolve identity for up to N active companies that need it."""
    pool: asyncpg.Pool = ctx["pool"]
    bound = log.bind(job="resolve_batch")

    rows = await pool.fetch(_BATCH_SQL, _BATCH_SIZE)
    if not rows:
        bound.info("nothing_to_resolve")
        return

    resolved = 0
    failed = 0
    for r in rows:
        try:
            await resolve_company_identity(pool, r["company_number"])
            resolved += 1
        except Exception as e:
            bound.warning("resolve_failed", company_number=r["company_number"], error=str(e))
            failed += 1

    bound.info("resolve_batch_complete", resolved=resolved, failed=failed, batch_size=len(rows))
