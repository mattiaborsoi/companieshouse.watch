"""Phase C: deferred-event helpers.

When the streamer sends a filing/officer/PSC event for a company we don't yet
have locally, the event handler stashes it here instead of blocking a worker
slot waiting for CH. A separate hydrator cron later fetches the missing
company and drains all its deferred events at once.

Public functions:
  - defer_event(...): called by process_event for entity events whose
    company is missing.
  - drain_for_company(...): called after a company-profile event upserts
    a company, OR by the hydrator cron after it pulls a company from CH.
"""
import json
from typing import Awaitable, Callable

import asyncpg
import structlog

from .upserts import upsert_filing, upsert_officer_appointment, upsert_psc

log = structlog.get_logger()


_DEFER_SQL = """
INSERT INTO meta.deferred_events
    (company_number, resource_kind, resource_id, payload)
VALUES ($1, $2, $3, $4::jsonb)
ON CONFLICT (resource_kind, resource_id) DO UPDATE SET
    attempts = meta.deferred_events.attempts + 1,
    last_attempt_at = now(),
    payload = EXCLUDED.payload
"""

_FETCH_FOR_COMPANY_SQL = """
SELECT id, resource_kind, resource_id, payload
FROM meta.deferred_events
WHERE company_number = $1
ORDER BY deferred_at
LIMIT 200
"""

_DELETE_BY_ID_SQL = "DELETE FROM meta.deferred_events WHERE id = $1"

_MARK_FAILURE_SQL = """
UPDATE meta.deferred_events
SET attempts = attempts + 1,
    last_attempt_at = now(),
    last_error = $2
WHERE id = $1
"""


async def defer_event(
    conn: asyncpg.Connection,
    company_number: str,
    resource_kind: str,
    resource_id: str,
    event: dict,
) -> None:
    """Stash an event whose company is missing for later hydration."""
    await conn.execute(
        _DEFER_SQL,
        company_number,
        resource_kind,
        resource_id,
        json.dumps(event),
    )


# Map resource_kind to the upsert function that handles it.
def _upsert_for(kind: str) -> Callable[[asyncpg.Connection, dict], Awaitable[None]] | None:
    if kind == "filing-history":
        return upsert_filing
    if kind == "company-officers":
        return upsert_officer_appointment
    if kind.startswith("company-psc"):
        return upsert_psc
    return None


async def drain_for_company(pool: asyncpg.Pool, company_number: str) -> int:
    """Replay all deferred events for a now-existing company. Returns count
    successfully processed. Failures are left in place for the next attempt.
    """
    bound = log.bind(job="drain_deferred", company_number=company_number)
    rows = await pool.fetch(_FETCH_FOR_COMPANY_SQL, company_number)
    if not rows:
        return 0

    drained = 0
    for r in rows:
        kind = r["resource_kind"]
        upsert = _upsert_for(kind)
        if upsert is None:
            # Unknown kind — drop the deferred entry (event is still in audit.events)
            await pool.execute(_DELETE_BY_ID_SQL, r["id"])
            continue

        # payload is the raw event with .data nested
        try:
            event = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"])
        except (TypeError, ValueError) as e:
            await pool.execute(_MARK_FAILURE_SQL, r["id"], f"payload_parse: {e}")
            continue

        data = (event.get("data") or {})
        # Officer/PSC events don't include company_number in data; inject it.
        if "company_number" not in data:
            data = {**data, "company_number": company_number}

        try:
            async with pool.acquire() as conn:
                await upsert(conn, data)
            await pool.execute(_DELETE_BY_ID_SQL, r["id"])
            drained += 1
        except (asyncpg.PostgresError, KeyError, ValueError) as e:
            err = str(e)[:500]
            await pool.execute(_MARK_FAILURE_SQL, r["id"], err)
            bound.warning("deferred_replay_failed", kind=kind, error=err)

    if drained:
        bound.info("deferred_drained", count=drained)
    return drained
