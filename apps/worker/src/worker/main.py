"""
arq worker. Run with: arq worker.main.WorkerSettings

Each job processes one Companies House stream event, logging it to audit.events
and upserting the relevant entity into Postgres.
"""
import json
import logging

import asyncpg
import structlog
from arq.connections import RedisSettings

from .ch_rest import get_company
from .config import settings
from .db import close_pool, get_pool
from .upserts import (
    upsert_company,
    upsert_filing,
    upsert_officer_appointment,
    upsert_psc,
)

log = structlog.get_logger()

# Maps stream name → resource_kind values we expect from that stream
_STREAM_KINDS = {
    "companies": {"company"},
    "filing-history": {"filing"},
    "officers": {"officer"},
    "persons-with-significant-control": {"persons-with-significant-control", "psc"},
}


async def _ensure_company(pool: asyncpg.Pool, company_number: str) -> bool:
    """Return True if the company exists; hydrate via REST if it doesn't."""
    exists = await pool.fetchval(
        "SELECT 1 FROM public.companies WHERE company_number = $1",
        company_number,
    )
    if exists:
        return True

    data = await get_company(company_number)
    if data is None:
        return False

    async with pool.acquire() as conn:
        await upsert_company(conn, data)
    return True


async def process_event(ctx: dict, stream_name: str, event: dict) -> None:
    pool: asyncpg.Pool = ctx["pool"]

    resource_kind = event.get("resource_kind", "")
    resource_id = event.get("resource_id", "")
    published_at = event.get("published_at")
    timepoint = event.get("timepoint")
    data = event.get("data") or {}

    bound_log = log.bind(
        stream=stream_name,
        resource_kind=resource_kind,
        resource_id=resource_id,
    )

    async with pool.acquire() as conn:
        # 1. Log to audit.events (always, regardless of what happens next)
        event_row_id = await conn.fetchval(
            """
            INSERT INTO audit.events (
                source, resource_kind, resource_id, resource_uri,
                ch_timepoint, published_at, payload, received_at
            ) VALUES ($1, $2, $3, $4, $5, $6::timestamptz, $7::jsonb, now())
            RETURNING id
            """,
            f"stream:{stream_name}",
            resource_kind,
            resource_id,
            event.get("resource_uri"),
            timepoint,
            published_at,
            json.dumps(event),
        )

        # 2. Route to entity upsert
        company_number = (
            data.get("company_number")
            or (data.get("appointed_to") or {}).get("company_number")
        )

        try:
            if resource_kind == "company":
                await upsert_company(conn, data)

            elif resource_kind == "filing":
                if company_number:
                    await _ensure_company(pool, company_number)
                await upsert_filing(conn, data)

            elif resource_kind == "officer":
                if company_number:
                    await _ensure_company(pool, company_number)
                await upsert_officer_appointment(conn, data)

            elif resource_kind in ("persons-with-significant-control", "psc"):
                if company_number:
                    await _ensure_company(pool, company_number)
                await upsert_psc(conn, data)

            else:
                bound_log.debug("unhandled_resource_kind")

            # 3. Mark processed
            await conn.execute(
                "UPDATE audit.events SET processed_at = now() WHERE id = $1",
                event_row_id,
            )
            bound_log.debug("processed")

        except Exception as exc:
            await conn.execute(
                "UPDATE audit.events SET processing_error = $1 WHERE id = $2",
                str(exc)[:500],
                event_row_id,
            )
            bound_log.exception("processing_failed", error=str(exc))
            raise  # arq will retry


async def startup(ctx: dict) -> None:
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.log_level.upper(), logging.INFO)
        ),
    )
    ctx["pool"] = await get_pool()
    log.info("worker_started")


async def shutdown(ctx: dict) -> None:
    await close_pool()
    log.info("worker_stopped")


class WorkerSettings:
    functions = [process_event]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 20
    job_timeout = 60
    keep_result = 3600
