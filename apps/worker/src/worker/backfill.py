"""
Backfill script: pull a representative sample of companies via the CH REST API
and upsert them into Postgres so the UI has data to display during development.

Usage (inside the worker container via Makefile):
    docker compose run --rm worker python -m worker.backfill
"""
import asyncio
import logging
from base64 import b64encode

import asyncpg
import httpx
import structlog

from .config import settings
from .db import close_pool, get_pool
from .upserts import upsert_company

CH_REST_BASE = "https://api.company-information.service.gov.uk"
BATCH_SIZE = 100
TARGET_TOTAL = 1000
RATE_LIMIT_DELAY = 0.7  # 600/5min ≈ 2/s; stay safely under

log = structlog.get_logger()


def _client() -> httpx.AsyncClient:
    token = b64encode(f"{settings.ch_rest_key}:".encode()).decode()
    return httpx.AsyncClient(
        base_url=CH_REST_BASE,
        headers={"Authorization": f"Basic {token}"},
        timeout=30.0,
    )


async def _search_page(
    client: httpx.AsyncClient, start_index: int, company_status: str = "active"
) -> list[dict]:
    """Fetch one page of results from /advanced-search/companies."""
    try:
        resp = await client.get(
            "/advanced-search/companies",
            params={
                "company_status": company_status,
                "size": BATCH_SIZE,
                "start_index": start_index,
            },
        )
        resp.raise_for_status()
        await asyncio.sleep(RATE_LIMIT_DELAY)
        return resp.json().get("items", [])
    except httpx.HTTPStatusError as exc:
        log.warning("search_error", status=exc.response.status_code, start_index=start_index)
        return []
    except httpx.RequestError as exc:
        log.warning("search_request_error", error=str(exc))
        return []


async def _fetch_company(client: httpx.AsyncClient, company_number: str) -> dict | None:
    """Fetch full company profile (search results lack some fields)."""
    try:
        resp = await client.get(f"/company/{company_number}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        await asyncio.sleep(RATE_LIMIT_DELAY)
        return resp.json()
    except (httpx.HTTPStatusError, httpx.RequestError) as exc:
        log.warning("company_fetch_error", company_number=company_number, error=str(exc))
        return None


async def backfill() -> None:
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(logging.INFO),
    )

    pool = await get_pool()
    upserted = 0
    failed = 0

    try:
        async with _client() as client:
            # Pull in pages across two statuses for variety
            for status in ("active", "dissolved"):
                if upserted >= TARGET_TOTAL:
                    break

                start_index = 0
                while upserted < TARGET_TOTAL:
                    items = await _search_page(client, start_index, status)
                    if not items:
                        break

                    for item in items:
                        cn = item.get("company_number")
                        if not cn:
                            continue

                        data = await _fetch_company(client, cn)
                        if data is None:
                            failed += 1
                            continue

                        async with pool.acquire() as conn:
                            try:
                                await upsert_company(conn, data)
                                upserted += 1
                            except asyncpg.PostgresError as exc:
                                log.warning("upsert_error", company_number=cn, error=str(exc))
                                failed += 1

                        if upserted % 50 == 0:
                            log.info("progress", upserted=upserted, failed=failed, status=status)

                        if upserted >= TARGET_TOTAL:
                            break

                    start_index += BATCH_SIZE

    finally:
        await close_pool()

    log.info("backfill_complete", upserted=upserted, failed=failed)


if __name__ == "__main__":
    asyncio.run(backfill())
