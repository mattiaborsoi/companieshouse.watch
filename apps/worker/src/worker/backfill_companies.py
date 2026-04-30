"""One-off backfill for a specific list of company numbers.

Pulls full profile + officers + PSCs + filing history from the CH REST API,
upserts everything into Postgres, and triggers identity resolution + pattern
detection so the company page renders the Phase 1/2/3 features immediately.

Usage:
    docker compose run --rm worker python -m worker.backfill_companies \\
        09446231 12345678 ...

Or programmatically:
    from worker.backfill_companies import backfill_one
    await backfill_one(pool, "09446231")
"""
import asyncio
import logging
import re
import sys
from base64 import b64encode

import asyncpg
import httpx
import structlog

from .config import settings
from .db import close_pool, get_pool
from .identity_resolver import resolve_company_identity
from .pattern_detector import detect_patterns
from .upserts import upsert_company, upsert_filing, upsert_officer_appointment, upsert_psc

CH_REST_BASE = "https://api.company-information.service.gov.uk"
RATE_LIMIT_DELAY = 0.7  # 600/5min ≈ 2/s; stay safely under
PAGE_SIZE = 100         # CH REST max for filings, officers, PSCs

log = structlog.get_logger()


def _client() -> httpx.AsyncClient:
    token = b64encode(f"{settings.ch_rest_key}:".encode()).decode()
    return httpx.AsyncClient(
        base_url=CH_REST_BASE,
        headers={"Authorization": f"Basic {token}"},
        timeout=30.0,
    )


async def _get(client: httpx.AsyncClient, path: str, _retries_left: int = 3) -> dict | None:
    try:
        resp = await client.get(path)
        await asyncio.sleep(RATE_LIMIT_DELAY)
        if resp.status_code == 404:
            return None
        if resp.status_code == 429:
            # Respect X-Ratelimit-Reset and retry once it expires.
            if _retries_left <= 0:
                log.warning("ch_rest_429_giving_up", path=path)
                return None
            import time
            reset_ts = int(resp.headers.get("X-Ratelimit-Reset", "0"))
            wait_s = max(2, reset_ts - int(time.time()) + 2)
            wait_s = min(wait_s, 305)  # cap at 5 min so we don't block forever
            log.info("ch_rest_429_waiting", path=path, wait_s=wait_s)
            await asyncio.sleep(wait_s)
            return await _get(client, path, _retries_left=_retries_left - 1)
        resp.raise_for_status()
        return resp.json()
    except httpx.HTTPStatusError as exc:
        log.warning("ch_rest_error", path=path, status=exc.response.status_code)
        return None
    except httpx.RequestError as exc:
        log.warning("ch_rest_request_error", path=path, error=str(exc))
        return None


async def _paginated(client: httpx.AsyncClient, base_path: str, max_pages: int = 10) -> list[dict]:
    """Walk paginated CH endpoints (filing-history, officers, PSCs)."""
    items: list[dict] = []
    start = 0
    for _ in range(max_pages):
        sep = "&" if "?" in base_path else "?"
        page = await _get(client, f"{base_path}{sep}items_per_page={PAGE_SIZE}&start_index={start}")
        if not page:
            break
        page_items = page.get("items") or []
        items.extend(page_items)
        total = page.get("total_count") or page.get("total_results") or 0
        start += PAGE_SIZE
        if start >= total or len(page_items) < PAGE_SIZE:
            break
    return items


async def backfill_one(
    pool: asyncpg.Pool,
    company_number: str,
    follow_directors: bool = False,
    max_companies_per_director: int = 10,
) -> dict:
    """Pull full company + officers + PSCs + filings into Postgres.

    follow_directors=True ALSO pulls the company-list for each active director
    of this company AND backfills (profile only, no filings) the first
    `max_companies_per_director` companies they're appointed at. This is what
    makes the 'Directors also run' section populate for big-name companies
    whose directors sit on many other boards.
    """
    bound = log.bind(company_number=company_number)
    summary = {"company": False, "filings": 0, "officers": 0, "pscs": 0, "linked_companies": 0}

    async with _client() as client:
        # 1. Company profile
        profile = await _get(client, f"/company/{company_number}")
        if not profile:
            bound.warning("company_not_found_or_rate_limited")
            return summary

        async with pool.acquire() as conn:
            await upsert_company(conn, profile)
        summary["company"] = True

        # 2. Filing history
        filings = await _paginated(client, f"/company/{company_number}/filing-history")
        for f in filings:
            f.setdefault("company_number", company_number)
            try:
                async with pool.acquire() as conn:
                    await upsert_filing(conn, f)
                summary["filings"] += 1
            except (asyncpg.PostgresError, KeyError) as e:
                bound.warning("filing_upsert_failed", error=str(e), txn=f.get("transaction_id"))

        # 3. Officers (and capture officer slugs so we can follow them)
        officers = await _paginated(client, f"/company/{company_number}/officers")
        active_officer_slugs: list[str] = []
        for o in officers:
            o.setdefault("company_number", company_number)
            try:
                async with pool.acquire() as conn:
                    await upsert_officer_appointment(conn, o)
                summary["officers"] += 1
                # Collect active directors only. CH REST puts the officer's
                # full appointment list at links.officer.appointments
                # (links.self points to this company's appointment, not the
                # officer profile).
                if not o.get("resigned_on"):
                    links = o.get("links") or {}
                    appts_link = (links.get("officer") or {}).get("appointments")
                    if appts_link:
                        m = re.search(r"/officers/([^/]+)/", appts_link)
                        if m:
                            active_officer_slugs.append(m.group(1))
            except (asyncpg.PostgresError, KeyError) as e:
                bound.warning("officer_upsert_failed", error=str(e))

        # 4. PSCs
        pscs = await _paginated(client, f"/company/{company_number}/persons-with-significant-control")
        for p in pscs:
            p.setdefault("company_number", company_number)
            try:
                async with pool.acquire() as conn:
                    await upsert_psc(conn, p)
                summary["pscs"] += 1
            except (asyncpg.PostgresError, KeyError) as e:
                bound.warning("psc_upsert_failed", error=str(e))

        # 5. Optionally follow each active director's other companies. We pull
        # the full appointment list per officer (which gives us their other
        # company numbers) and then backfill those companies' profile + officers
        # so person_match_key cross-matches work in the UI.
        if follow_directors and active_officer_slugs:
            seen_companies: set[str] = {company_number}
            for slug in active_officer_slugs:
                appts = await _get(client, f"/officers/{slug}/appointments?items_per_page=50")
                if not appts:
                    continue
                items = appts.get("items") or []
                for it in items[:max_companies_per_director]:
                    appointed_to = (it.get("appointed_to") or {})
                    other_cn = appointed_to.get("company_number")
                    if not other_cn or other_cn in seen_companies:
                        continue
                    seen_companies.add(other_cn)
                    # Pull the other company's profile + officers (no filings — keeps it cheap)
                    other_profile = await _get(client, f"/company/{other_cn}")
                    if not other_profile:
                        continue
                    async with pool.acquire() as conn:
                        try:
                            await upsert_company(conn, other_profile)
                        except (asyncpg.PostgresError, KeyError) as e:
                            bound.warning("linked_company_upsert_failed", company=other_cn, error=str(e))
                            continue
                    # Pull officers so person_match_key matches across companies
                    other_officers = await _paginated(client, f"/company/{other_cn}/officers", max_pages=1)
                    for oo in other_officers:
                        oo.setdefault("company_number", other_cn)
                        try:
                            async with pool.acquire() as conn:
                                await upsert_officer_appointment(conn, oo)
                        except (asyncpg.PostgresError, KeyError) as e:
                            bound.warning("linked_officer_upsert_failed", error=str(e))
                    summary["linked_companies"] += 1

    bound.info("backfill_one_complete", **summary)
    return summary


async def backfill_many(
    company_numbers: list[str],
    resolve_identity: bool = True,
    follow_directors: bool = False,
) -> None:
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    )
    pool = await get_pool()
    try:
        for cn in company_numbers:
            await backfill_one(pool, cn, follow_directors=follow_directors)
            if resolve_identity:
                try:
                    await resolve_company_identity(pool, cn)
                except Exception as e:
                    log.warning("identity_resolve_failed", company_number=cn, error=str(e))
        # Recompute patterns so the new companies' badges populate
        log.info("running_pattern_detection")
        await detect_patterns({"pool": pool})
    finally:
        await close_pool()


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args:
        print(
            "Usage: python -m worker.backfill_companies [--follow-directors] <company_number> [...]\n"
            "  --follow-directors  also backfill (profile + officers) for each director's other companies\n"
            "                      so the 'Directors also run' UI section populates",
            file=sys.stderr,
        )
        sys.exit(1)
    follow = "--follow-directors" in args
    args = [a for a in args if not a.startswith("--")]
    asyncio.run(backfill_many(args, follow_directors=follow))
