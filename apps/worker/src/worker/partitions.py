"""Monthly partition maintenance for the audit.* range-partitioned tables.

Why this exists: audit.events, audit.llm_calls and audit.searches are
PARTITION BY RANGE on a timestamptz. Their partitions were created by hand in
the Alembic migrations (0001 and 0010), three months at a time, and nothing
ever created more. When the last one lapsed on 2026-07-01 every insert began
failing with

    CheckViolationError: no partition of relation "events" found for row

and because process_event logs to audit.events inside the same transaction as
the entity upsert, the whole pipeline stopped: no events, no company/officer/
PSC updates. It ran that way for six weeks before anyone noticed, because the
streamer stayed connected and the site kept serving stale rows quite happily.

So: create partitions well ahead of time, every day, idempotently. Cheap
(a catalogue lookup per table) and self-healing after any outage.
"""
from datetime import date, timedelta

import structlog

from .db import get_pool

log = structlog.get_logger()

# (schema, table) — all three share a monthly RANGE layout.
PARTITIONED_TABLES = [
    ("audit", "events"),
    ("audit", "llm_calls"),
    ("audit", "searches"),
]

# How far ahead to keep partitions. Six months means even a totally unattended
# instance has a wide margin, and a daily cron only ever creates one at a time.
MONTHS_AHEAD = 6


def _add_month(d: date) -> date:
    """First day of the month after d (d must already be a month start)."""
    return date(d.year + (d.month // 12), (d.month % 12) + 1, 1)


async def ensure_partitions(ctx: dict | None = None) -> int:
    """Create any missing monthly partitions up to MONTHS_AHEAD. Returns count."""
    pool = await get_pool()
    today = date.today()
    start = date(today.year, today.month, 1)

    created = 0
    for schema, table in PARTITIONED_TABLES:
        month = start
        for _ in range(MONTHS_AHEAD + 1):
            nxt = _add_month(month)
            name = f"{table}_{month:%Y_%m}"

            exists = await pool.fetchval(
                """
                SELECT EXISTS (
                    SELECT 1 FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = $1 AND c.relname = $2
                )
                """,
                schema, name,
            )
            if not exists:
                # Postgres propagates the parent's indexes to new partitions
                # automatically, so no index DDL is needed here.
                await pool.execute(
                    f'CREATE TABLE {schema}.{name} '
                    f'PARTITION OF {schema}.{table} '
                    f"FOR VALUES FROM ('{month}') TO ('{nxt}')"
                )
                created += 1
                log.info("partition_created", schema=schema, partition=name)

            month = nxt

    if created:
        log.info("partition_maintenance_done", created=created)
    return created


async def check_partition_coverage(ctx: dict | None = None) -> dict[str, str]:
    """Report the newest partition bound per table — a canary for this failure.

    Returns {"audit.events": "2027-03-01", ...}. Logged at warning level if any
    table has less than a month of runway left.
    """
    pool = await get_pool()
    horizon = date.today() + timedelta(days=31)
    coverage: dict[str, str] = {}

    for schema, table in PARTITIONED_TABLES:
        newest = await pool.fetchval(
            """
            SELECT max(
                substring(pg_get_expr(c.relpartbound, c.oid) from 'TO \\(''([0-9-]+)')::date
            )
            FROM pg_inherits i
            JOIN pg_class parent ON i.inhparent = parent.oid
            JOIN pg_namespace pn ON pn.oid = parent.relnamespace
            JOIN pg_class c ON i.inhrelid = c.oid
            WHERE pn.nspname = $1 AND parent.relname = $2
            """,
            schema, table,
        )
        coverage[f"{schema}.{table}"] = str(newest)
        if newest is None or newest < horizon:
            log.warning(
                "partition_coverage_low",
                table=f"{schema}.{table}",
                newest_bound=str(newest),
            )

    return coverage
