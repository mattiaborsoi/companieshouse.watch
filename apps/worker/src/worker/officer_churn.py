"""
Officer-churn anomaly detection cron job.

Flags companies with an unusually high rate of officer appointments and
terminations within a 90-day window — a pattern associated with instability,
nominee cycling, and phoenix schemes.

Runs every 10 minutes alongside other detectors. No LLM calls.
"""
import json

import asyncpg
import structlog

from .db import get_pool

log = structlog.get_logger()

MIN_CHURN_EVENTS = 5   # minimum combined appointments+terminations in 90 days
SCORE_THRESHOLD = 30   # minimum score to upsert


_CHURN_SQL = """
WITH churn AS (
    SELECT
        a.company_number,
        COUNT(*) FILTER (
            WHERE a.appointed_on >= now() - INTERVAL '90 days'
        )                                                               AS appointments_90d,
        COUNT(*) FILTER (
            WHERE a.resigned_on >= now() - INTERVAL '90 days'
        )                                                               AS terminations_90d,
        COUNT(*) FILTER (
            WHERE a.appointed_on >= now() - INTERVAL '90 days'
        ) + COUNT(*) FILTER (
            WHERE a.resigned_on >= now() - INTERVAL '90 days'
        )                                                               AS total_churn
    FROM public.appointments a
    WHERE a.appointed_on >= now() - INTERVAL '90 days'
       OR a.resigned_on  >= now() - INTERVAL '90 days'
    GROUP BY a.company_number
    HAVING
        COUNT(*) FILTER (WHERE a.appointed_on >= now() - INTERVAL '90 days')
        + COUNT(*) FILTER (WHERE a.resigned_on >= now() - INTERVAL '90 days') >= $1
)
SELECT
    ch.company_number           AS detection_key,
    c.name                      AS company_name,
    c.status,
    c.incorporated_on,
    c.registered_address->>'address_line_1' AS address_line_1,
    c.registered_address->>'postal_code'    AS postcode,
    ch.appointments_90d,
    ch.terminations_90d,
    ch.total_churn,
    LEAST(100,
        ch.total_churn * 8
        + ch.terminations_90d * 5
    )::int                      AS score
FROM churn ch
JOIN public.companies c ON c.company_number = ch.company_number
ORDER BY score DESC
"""

_OFFICERS_FOR_COMPANY_SQL = """
SELECT
    a.officer_id::text,
    o.name_full,
    o.role,
    a.appointed_on,
    a.resigned_on
FROM public.appointments a
JOIN public.officers o ON o.officer_id = a.officer_id
WHERE a.company_number = $1
  AND (
      a.appointed_on >= now() - INTERVAL '90 days'
   OR a.resigned_on  >= now() - INTERVAL '90 days'
  )
ORDER BY COALESCE(a.resigned_on, a.appointed_on) DESC NULLS LAST
LIMIT 30
"""

_UPSERT_SQL = """
INSERT INTO public.anomalies (
    kind, detection_key, score, features,
    first_detected_at, last_detected_at, is_currently_flagged
) VALUES (
    'officer_churn', $1, $2, $3::jsonb,
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
WHERE kind = 'officer_churn'
  AND detection_key NOT IN (SELECT unnest($1::text[]))
  AND is_currently_flagged = true
"""


async def detect_officer_churn(ctx: dict) -> None:
    """Cron: score officer-churn patterns and upsert into public.anomalies."""
    pool: asyncpg.Pool = ctx["pool"]
    bound = log.bind(job="detect_officer_churn")

    rows = await pool.fetch(_CHURN_SQL, MIN_CHURN_EVENTS)
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

                officers = await pool.fetch(_OFFICERS_FOR_COMPANY_SQL, detection_key)
                officer_list = [
                    {
                        "officer_id":   o["officer_id"],
                        "name":         o["name_full"],
                        "role":         o["role"],
                        "appointed_on": o["appointed_on"].isoformat() if o["appointed_on"] else None,
                        "resigned_on":  o["resigned_on"].isoformat() if o["resigned_on"] else None,
                    }
                    for o in officers
                ]

                features = {
                    "company_number":    detection_key,
                    "company_name":      row["company_name"],
                    "status":            row["status"],
                    "incorporated_on":   row["incorporated_on"].isoformat() if row["incorporated_on"] else None,
                    "address_line_1":    row["address_line_1"],
                    "postcode":          row["postcode"],
                    "appointments_90d":  row["appointments_90d"],
                    "terminations_90d":  row["terminations_90d"],
                    "total_churn":       row["total_churn"],
                    "officers":          officer_list,
                }

                await conn.execute(_UPSERT_SQL, detection_key, score, json.dumps(features))
                upserted += 1

            if flagged:
                await conn.execute(_UNFLAG_SQL, flagged)
            else:
                await conn.execute(
                    "UPDATE public.anomalies SET is_currently_flagged = false "
                    "WHERE kind = 'officer_churn' AND is_currently_flagged = true"
                )

    bound.info(
        "officer_churn_detection_complete",
        total_candidates=len(rows),
        flagged=len(flagged),
        upserted=upserted,
    )
