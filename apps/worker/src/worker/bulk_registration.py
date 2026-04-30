"""
Bulk-registration anomaly detection cron job.

Flags addresses where 10 or more companies were incorporated on the same
calendar day within the last 180 days. This pattern is strongly associated
with formation-agent activity, nominee schemes, and coordinated shell company
creation.

Runs every 10 minutes alongside other detectors. No LLM calls.
"""
import json

import asyncpg
import structlog

from .db import get_pool

log = structlog.get_logger()

MIN_COMPANIES_PER_DAY = 10   # minimum incorporations on one day at one address
SCORE_THRESHOLD = 30          # minimum score to upsert
LOOKBACK_DAYS = 180           # how far back to search


_BULK_SQL = """
WITH daily_reg AS (
    SELECT
        registered_address_hash,
        DATE(incorporated_on)           AS inc_date,
        COUNT(*)                        AS companies_on_day
    FROM public.companies
    WHERE incorporated_on >= now() - INTERVAL '180 days'
      AND registered_address_hash IS NOT NULL
    GROUP BY registered_address_hash, DATE(incorporated_on)
    HAVING COUNT(*) >= $1
),
address_meta AS (
    SELECT DISTINCT ON (registered_address_hash)
        registered_address_hash,
        registered_address->>'address_line_1'   AS address_line_1,
        registered_address->>'postal_code'       AS postcode,
        registered_address->>'locality'          AS locality
    FROM public.companies
    WHERE registered_address_hash IS NOT NULL
)
SELECT
    dr.registered_address_hash || ':' || dr.inc_date::text  AS detection_key,
    dr.registered_address_hash,
    dr.inc_date,
    dr.companies_on_day,
    am.address_line_1,
    am.postcode,
    am.locality,
    LEAST(100,
        dr.companies_on_day * 5
        + CASE
            WHEN dr.inc_date >= (now() - INTERVAL '30 days')::date THEN 25
            WHEN dr.inc_date >= (now() - INTERVAL '90 days')::date THEN 10
            ELSE 0
          END
    )::int  AS score
FROM daily_reg dr
JOIN address_meta am ON am.registered_address_hash = dr.registered_address_hash
ORDER BY score DESC
"""

_COMPANIES_FOR_BULK_SQL = """
SELECT
    company_number,
    name,
    status,
    incorporated_on
FROM public.companies
WHERE registered_address_hash = $1
  AND DATE(incorporated_on) = $2
ORDER BY incorporated_on NULLS LAST
"""

_UPSERT_SQL = """
INSERT INTO public.anomalies (
    kind, detection_key, score, features,
    first_detected_at, last_detected_at, is_currently_flagged
) VALUES (
    'bulk_registration', $1, $2, $3::jsonb,
    now(), now(), true
)
ON CONFLICT (kind, detection_key) DO UPDATE SET
    score                = EXCLUDED.score,
    last_detected_at     = now(),
    is_currently_flagged = true,
    features             = EXCLUDED.features
"""

_UNFLAG_SQL = """
UPDATE public.anomalies
SET is_currently_flagged = false
WHERE kind = 'bulk_registration'
  AND detection_key NOT IN (SELECT unnest($1::text[]))
  AND is_currently_flagged = true
"""


async def detect_bulk_registration(ctx: dict) -> None:
    """Cron: score bulk-registration events and upsert into public.anomalies."""
    pool: asyncpg.Pool = ctx["pool"]
    bound = log.bind(job="detect_bulk_registration")

    rows = await pool.fetch(_BULK_SQL, MIN_COMPANIES_PER_DAY)
    flagged: list[str] = []
    upserted = 0

    async with pool.acquire() as conn:
        async with conn.transaction():
            for row in rows:
                score: int = row["score"]
                if score < SCORE_THRESHOLD:
                    continue

                detection_key: str = row["detection_key"]
                flagged.append(detection_key)

                companies = await pool.fetch(
                    _COMPANIES_FOR_BULK_SQL,
                    row["registered_address_hash"],
                    row["inc_date"],
                )
                company_list = [
                    {
                        "number":          c["company_number"],
                        "name":            c["name"],
                        "status":          c["status"],
                        "incorporated_on": c["incorporated_on"].isoformat() if c["incorporated_on"] else None,
                    }
                    for c in companies
                ]

                features = {
                    "address_hash":     row["registered_address_hash"],
                    "address_line_1":   row["address_line_1"],
                    "postcode":         row["postcode"],
                    "locality":         row["locality"],
                    "inc_date":         row["inc_date"].isoformat(),
                    "companies_on_day": row["companies_on_day"],
                    "companies":        company_list,
                }

                await conn.execute(_UPSERT_SQL, detection_key, score, json.dumps(features))
                upserted += 1

            if flagged:
                await conn.execute(_UNFLAG_SQL, flagged)
            else:
                await conn.execute(
                    "UPDATE public.anomalies SET is_currently_flagged = false "
                    "WHERE kind = 'bulk_registration' AND is_currently_flagged = true"
                )

    bound.info(
        "bulk_registration_detection_complete",
        total_candidates=len(rows),
        flagged=len(flagged),
        upserted=upserted,
    )
