"""
arq worker. Run with: arq worker.main.WorkerSettings

Each job processes one Companies House stream event, logging it to audit.events
and upserting the relevant entity into Postgres.
"""
import json
import logging
import re
from datetime import datetime

import asyncpg
import structlog
from arq import Retry
from arq.connections import RedisSettings

from arq.cron import cron

from .anomaly_detector import detect_anomalies
from .director_velocity import detect_director_velocity
from .social_poster import post_daily_anomaly
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

_COMPANY_NUMBER_RE = re.compile(r"/company/([^/]+)/")

# How long to wait before retrying a job whose company hasn't appeared yet (seconds)
_COMPANY_NOT_FOUND_RETRY_DELAY = 30


def _extract_company_number(event: dict) -> str | None:
    """Try data.company_number first; fall back to parsing resource_uri."""
    data = event.get("data") or {}
    cn = data.get("company_number")
    if cn:
        return cn
    uri = event.get("resource_uri") or ""
    m = _COMPANY_NUMBER_RE.search(uri)
    return m.group(1) if m else None


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
    job_try: int = ctx.get("job_try", 1)

    resource_kind = event.get("resource_kind", "")
    resource_id = event.get("resource_id", "")
    # CH nests timepoint and published_at under event.event, not at top level
    event_meta = event.get("event") or {}
    _pa = event_meta.get("published_at")
    try:
        published_at: datetime | None = datetime.fromisoformat(_pa) if _pa else None
    except (ValueError, TypeError):
        published_at = None
    timepoint = event_meta.get("timepoint")
    data = event.get("data") or {}

    # Inject company_number into data if absent (officers/PSC don't include it)
    company_number = _extract_company_number(event)
    if company_number and not data.get("company_number"):
        data = {**data, "company_number": company_number}

    bound_log = log.bind(
        stream=stream_name,
        resource_kind=resource_kind,
        resource_id=resource_id,
        attempt=job_try,
    )

    async with pool.acquire() as conn:
        # 1. Log to audit.events on first attempt only (avoid duplicate rows on retry)
        if job_try == 1:
            event_row_id = await conn.fetchval(
                """
                INSERT INTO audit.events (
                    source, resource_kind, resource_id, resource_uri,
                    ch_timepoint, published_at, payload, received_at
                ) VALUES ($1, $2, $3, $4, $5, COALESCE($6, now()), $7::jsonb, now())
                ON CONFLICT DO NOTHING
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
        else:
            event_row_id = await conn.fetchval(
                "SELECT id FROM audit.events WHERE source = $1 AND resource_id = $2 AND ch_timepoint = $3",
                f"stream:{stream_name}",
                resource_id,
                timepoint,
            )

        try:
            cn = data.get("company_number")

            if resource_kind == "company-profile":
                await upsert_company(conn, data)

            elif resource_kind == "filing-history":
                if cn and not await _ensure_company(pool, cn):
                    # Company not in REST API yet — retry after a delay (max 3 times)
                    if job_try < 3:
                        raise Retry(defer=_COMPANY_NOT_FOUND_RETRY_DELAY * job_try)
                    bound_log.warning("company_not_found_giving_up", company_number=cn)
                    return
                await upsert_filing(conn, data)

            elif resource_kind == "company-officers":
                if cn and not await _ensure_company(pool, cn):
                    if job_try < 3:
                        raise Retry(defer=_COMPANY_NOT_FOUND_RETRY_DELAY * job_try)
                    bound_log.warning("company_not_found_giving_up", company_number=cn)
                    return
                await upsert_officer_appointment(conn, data)

            elif resource_kind.startswith("company-psc"):
                if cn and not await _ensure_company(pool, cn):
                    if job_try < 3:
                        raise Retry(defer=_COMPANY_NOT_FOUND_RETRY_DELAY * job_try)
                    bound_log.warning("company_not_found_giving_up", company_number=cn)
                    return
                await upsert_psc(conn, data)

            else:
                bound_log.debug("unhandled_resource_kind")

            if event_row_id:
                await conn.execute(
                    "UPDATE audit.events SET processed_at = now(), processing_error = NULL WHERE id = $1",
                    event_row_id,
                )
            bound_log.debug("processed")

        except Retry:
            bound_log.info("retrying_company_not_found_yet", company_number=cn)
            raise

        except Exception as exc:
            if event_row_id:
                await conn.execute(
                    "UPDATE audit.events SET processing_error = $1 WHERE id = $2",
                    str(exc)[:500],
                    event_row_id,
                )
            bound_log.exception("processing_failed", error=str(exc))
            raise


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
    cron_jobs = [
        cron(detect_anomalies, minute={0, 10, 20, 30, 40, 50}),
        cron(detect_director_velocity, minute={5, 15, 25, 35, 45, 55}),
        cron(post_daily_anomaly, hour={9}, minute={0}),
    ]
    on_startup = startup
    on_shutdown = shutdown
    redis_settings = RedisSettings.from_dsn(settings.redis_url)
    max_jobs = 10
    job_timeout = 300
    keep_result = 3600
    max_tries = 3
