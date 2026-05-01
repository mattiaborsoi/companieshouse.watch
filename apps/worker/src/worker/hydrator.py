"""Phase C: company-hydration cron.

Periodically:
  1. Find distinct company_numbers that have deferred events but no row
     in public.companies.
  2. Fetch each via CH REST (rate-limit-aware, see ch_rest.get_company).
  3. On success, upsert the company and drain its deferred events.

This lets the event-processing worker stay non-blocking and gives CH calls
a separate, controllable pacing.
"""
import asyncpg
import structlog

from .ch_rest import get_company
from .deferred import drain_for_company
from .upserts import upsert_company

log = structlog.get_logger()


_PENDING_SQL = """
SELECT DISTINCT d.company_number
FROM meta.deferred_events d
LEFT JOIN public.companies c ON c.company_number = d.company_number
WHERE c.company_number IS NULL
ORDER BY d.company_number
LIMIT $1
"""


# Tunable per cron tick. With CH's 600 req/5min limit we have ~2 calls/sec.
# Picking 30 per tick * 1 tick / 2min = 15 calls/min, well under the budget,
# leaves headroom for the streamer's own _ensure (none now) and on-demand
# fetches from the web app.
_BATCH_SIZE = 30


async def hydrate_pending_companies(ctx: dict) -> None:
    """Cron: hydrate companies referenced by deferred events."""
    pool: asyncpg.Pool = ctx["pool"]
    bound = log.bind(job="hydrate_pending_companies")

    rows = await pool.fetch(_PENDING_SQL, _BATCH_SIZE)
    if not rows:
        bound.debug("nothing_to_hydrate")
        return

    hydrated = 0
    skipped = 0
    drained_total = 0

    for r in rows:
        cn = r["company_number"]
        data = await get_company(cn)
        if data is None:
            # Either CH 429-ed us (will retry next tick) or genuinely 404.
            # Either way, leave the deferred events in place.
            skipped += 1
            continue

        async with pool.acquire() as conn:
            await upsert_company(conn, data)
        hydrated += 1
        drained_total += await drain_for_company(pool, cn)

    bound.info(
        "hydrate_complete",
        hydrated=hydrated,
        skipped=skipped,
        drained_events=drained_total,
        batch_size=len(rows),
    )
