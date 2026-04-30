"""
Director-velocity anomaly detection cron job.

Finds officers appointed as director to an unusually high number of
companies in a short window — a pattern associated with nominee directors,
formation agents, and mass-incorporation schemes.

Runs every 10 minutes alongside address-cluster detection. No LLM calls.
"""
import json

import asyncpg
import structlog

from .db import get_pool

log = structlog.get_logger()

MIN_COMPANY_COUNT = 3   # minimum active appointments to be flagged
SCORE_THRESHOLD = 30    # minimum score to upsert


_VELOCITY_SQL = """
WITH active_director AS (
    SELECT
        a.officer_id,
        COUNT(DISTINCT a.company_number)                                    AS company_count,
        COUNT(DISTINCT a.company_number) FILTER (
            WHERE a.appointed_on >= now() - INTERVAL '90 days'
        )                                                                   AS recent_90_days,
        COUNT(DISTINCT a.company_number) FILTER (
            WHERE a.appointed_on >= now() - INTERVAL '30 days'
        )                                                                   AS recent_30_days
    FROM public.appointments a
    WHERE a.resigned_on IS NULL
    GROUP BY a.officer_id
    HAVING COUNT(DISTINCT a.company_number) >= $1
)
SELECT
    ad.officer_id::text         AS detection_key,
    o.name_full                 AS officer_name,
    o.nationality,
    ad.company_count,
    ad.recent_90_days,
    ad.recent_30_days,
    LEAST(100,
        ad.company_count * 5
        + ad.recent_90_days * 5
        + ad.recent_30_days * 10
    )::int                      AS score
FROM active_director ad
JOIN public.officers o ON o.officer_id = ad.officer_id
ORDER BY score DESC
"""

_COMPANIES_FOR_OFFICER_SQL = """
SELECT
    a.company_number,
    c.name,
    c.status,
    a.appointed_on
FROM public.appointments a
JOIN public.companies c ON c.company_number = a.company_number
WHERE a.officer_id = $1::uuid
  AND a.resigned_on IS NULL
ORDER BY a.appointed_on DESC NULLS LAST
LIMIT 30
"""

_UPSERT_SQL = """
INSERT INTO public.anomalies (
    kind, detection_key, score, features,
    first_detected_at, last_detected_at, is_currently_flagged
) VALUES (
    'director_velocity', $1, $2, $3::jsonb,
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
WHERE kind = 'director_velocity'
  AND detection_key NOT IN (SELECT unnest($1::text[]))
  AND is_currently_flagged = true
"""


async def detect_director_velocity(ctx: dict) -> None:
    """Cron: score director-velocity clusters and upsert into public.anomalies."""
    pool: asyncpg.Pool = ctx["pool"]
    bound = log.bind(job="detect_director_velocity")

    rows = await pool.fetch(_VELOCITY_SQL, MIN_COMPANY_COUNT)
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
                    _COMPANIES_FOR_OFFICER_SQL, detection_key
                )
                company_list = [
                    {
                        "number": c["company_number"],
                        "name": c["name"],
                        "status": c["status"],
                        "appointed_on": (
                            c["appointed_on"].isoformat()
                            if c["appointed_on"]
                            else None
                        ),
                    }
                    for c in companies
                ]

                features = {
                    "officer_id":    detection_key,
                    "officer_name":  row["officer_name"],
                    "nationality":   row["nationality"],
                    "company_count": row["company_count"],
                    "recent_90_days": row["recent_90_days"],
                    "recent_30_days": row["recent_30_days"],
                    "companies":     company_list,
                }

                await conn.execute(
                    _UPSERT_SQL, detection_key, score, json.dumps(features)
                )
                upserted += 1

            if flagged:
                await conn.execute(_UNFLAG_SQL, flagged)
            else:
                await conn.execute(
                    "UPDATE public.anomalies SET is_currently_flagged = false "
                    "WHERE kind = 'director_velocity' AND is_currently_flagged = true"
                )

    bound.info(
        "director_velocity_detection_complete",
        total_candidates=len(rows),
        flagged=len(flagged),
        upserted=upserted,
    )
