"""
Address-cluster anomaly detection cron job.

Runs every 10 minutes via arq. Finds addresses with an unusually high
number of registered companies and/or directors, scores them, and upserts
into public.anomalies. No LLM calls — AI explanations are on-demand only.
"""
import json
import logging
from datetime import datetime

import asyncpg
import structlog

from .db import get_pool

log = structlog.get_logger()

PROMPT_VERSION = "address_cluster_v1"
MIN_COMPANY_COUNT = 5   # ignore tiny clusters
SCORE_THRESHOLD = 20    # only flag clusters at or above this score

# Postcodes of major UK registered-office service providers (formation agents).
# Addresses here attract thousands of legitimately-formed companies and should
# NOT score as high-risk anomalies. We cap their score and flag them visually
# on the front end so users know what they're looking at.
FORMATION_AGENT_POSTCODES: frozenset[str] = frozenset({
    "WC2H 9JQ",  # 71-75 Shelton Street (1st Formations, many others)
    "WC1N 3AX",  # 27 Old Gloucester Street (Made Simple Group, Companies Made Simple)
    "EC1V 2NX",  # 128 City Road (multiple agents)
    "EC1V 2NJ",  # City Road variations
    "EC1V 2NW",  # City Road variations
    "N1 7GU",    # 20 Wenlock Road (Hoxton Mix, old Wise service address)
    "N1 7GN",    # Wenlock Road
    "SL9 0BG",   # Gerrards Cross (Jacquards Spaces)
    "EC2A 4NA",  # 66 Paul Street
    "EC2A 4NE",  # 86-90 Paul Street
    "W1W 5PF",   # 167-169 Great Portland Street
    "BR3 4AB",   # 37 Croydon Road, Beckenham
    "HR5 3DJ",   # 61 Bridge Street, Herefordshire
    "EH2 4AN",   # 5 South Charlotte Street, Edinburgh
    "HG1 1ND",   # 9 Princes Square, Harrogate
    "IP28 7DE",  # James Carter Road, Bury St. Edmunds
    "DT1 2PJ",   # Railway Triangle, Dorchester
    "N21 3NA",   # 1 Kings Avenue, London
    "DN6 8DA",   # Owston Road, Doncaster
    "W1B 3HH",   # Third Floor, London (Mayfair agents)
    "PO15 7AG",  # Solent Business Park, Fareham
    "HA1 2EY",   # Cox Costello & Horne, Harrow
    "G1 3NQ",    # Gordon Chambers, Glasgow
    "HA4 7AE",   # College House, Ruislip
    "EH3 9WJ",   # 50 Lothian Road, Edinburgh
    "SW1Y 4LB",  # 12 St. James's Square
    "SM4 6RW",   # Marshall House, Morden
    "BT38 7AW",  # 2 Market Place, Carrickfergus
    "NE3 2ER",   # Cheviot House, Newcastle
})

# Any address with this many companies is almost certainly a registered office
# service even if its postcode isn't in the list above.
FORMATION_AGENT_COUNT_THRESHOLD = 100


_CLUSTER_SQL = """
WITH director_counts AS (
    -- for each (address_hash, officer), count distinct active appointments there
    SELECT
        c.registered_address_hash,
        a.officer_id,
        COUNT(DISTINCT a.company_number) AS companies_at_address
    FROM public.appointments a
    JOIN public.companies c ON c.company_number = a.company_number
    WHERE a.resigned_on IS NULL
      AND c.registered_address_hash IS NOT NULL
    GROUP BY c.registered_address_hash, a.officer_id
),
shared_directors AS (
    -- directors appearing at 3+ companies at the same address
    SELECT registered_address_hash, COUNT(*) AS cnt
    FROM director_counts
    WHERE companies_at_address >= 3
    GROUP BY registered_address_hash
),
cluster AS (
    SELECT
        c.registered_address_hash                                   AS detection_key,
        COUNT(*)                                                    AS company_count,
        COUNT(*) FILTER (
            WHERE c.incorporated_on >= now() - INTERVAL '90 days'
        )                                                           AS recently_incorporated,
        MIN(c.registered_address->>'address_line_1')               AS address_line_1,
        MIN(c.registered_address->>'postal_code')                   AS postcode,
        MIN(c.registered_address->>'locality')                      AS locality
    FROM public.companies c
    WHERE c.registered_address_hash IS NOT NULL
    GROUP BY c.registered_address_hash
    HAVING COUNT(*) >= $1
)
SELECT
    cl.detection_key,
    cl.address_line_1,
    cl.postcode,
    cl.locality,
    cl.company_count,
    cl.recently_incorporated,
    COALESCE(sd.cnt, 0)                                             AS shared_directors,
    LEAST(100,
        cl.company_count * 2
        + cl.recently_incorporated * 4
        + COALESCE(sd.cnt, 0) * 8
    )::int                                                          AS score
FROM cluster cl
LEFT JOIN shared_directors sd ON sd.registered_address_hash = cl.detection_key
ORDER BY score DESC
"""

_COMPANIES_FOR_CLUSTER_SQL = """
SELECT
    c.company_number,
    c.name,
    c.status,
    c.incorporated_on
FROM public.companies c
WHERE c.registered_address_hash = $1
ORDER BY c.incorporated_on DESC NULLS LAST
LIMIT 20
"""

_UNFLAG_SQL = """
UPDATE public.anomalies
SET is_currently_flagged = false
WHERE kind = 'address_cluster'
  AND detection_key NOT IN (SELECT unnest($1::text[]))
  AND is_currently_flagged = true
"""

_UPSERT_SQL = """
INSERT INTO public.anomalies (
    kind, detection_key, score, features,
    first_detected_at, last_detected_at, is_currently_flagged
) VALUES (
    'address_cluster', $1, $2, $3::jsonb,
    now(), now(), true
)
ON CONFLICT (kind, detection_key) DO UPDATE SET
    score               = EXCLUDED.score,
    last_detected_at    = now(),
    is_currently_flagged = true,
    features            = EXCLUDED.features
"""


async def detect_anomalies(ctx: dict) -> None:
    """Cron: score address clusters and upsert into public.anomalies."""
    pool: asyncpg.Pool = ctx["pool"]
    bound = log.bind(job="detect_anomalies")

    clusters = await pool.fetch(_CLUSTER_SQL, MIN_COMPANY_COUNT)
    flagged: list[str] = []
    upserted = 0

    async with pool.acquire() as conn:
        async with conn.transaction():
            for row in clusters:
                score: int = row["score"]
                if score < SCORE_THRESHOLD:
                    continue

                detection_key: str = row["detection_key"]
                postcode: str = (row["postcode"] or "").upper().strip()
                company_count: int = row["company_count"]

                # Identify known registered-office services (formation agents).
                # These accumulate large numbers of legitimately-formed companies
                # and should not be treated as high-risk fraud clusters.
                is_formation_agent = (
                    postcode in FORMATION_AGENT_POSTCODES
                    or company_count >= FORMATION_AGENT_COUNT_THRESHOLD
                )
                if is_formation_agent:
                    score = min(score, 20)

                flagged.append(detection_key)

                companies = await pool.fetch(
                    _COMPANIES_FOR_CLUSTER_SQL, detection_key
                )
                company_list = [
                    {
                        "number": c["company_number"],
                        "name": c["name"],
                        "status": c["status"],
                        "incorporated_on": (
                            c["incorporated_on"].isoformat()
                            if c["incorporated_on"]
                            else None
                        ),
                    }
                    for c in companies
                ]

                features = {
                    "address_line_1": row["address_line_1"],
                    "postcode": row["postcode"],
                    "locality": row["locality"],
                    "company_count": row["company_count"],
                    "recently_incorporated": row["recently_incorporated"],
                    "shared_directors": row["shared_directors"],
                    "companies": company_list,
                    "formation_agent": is_formation_agent,
                }

                await conn.execute(_UPSERT_SQL, detection_key, score, json.dumps(features))
                upserted += 1

            # Mark clusters that no longer meet the threshold as inactive
            if flagged:
                await conn.execute(_UNFLAG_SQL, flagged)
            else:
                # No clusters at all — unflag everything
                await conn.execute(
                    "UPDATE public.anomalies SET is_currently_flagged = false "
                    "WHERE kind = 'address_cluster' AND is_currently_flagged = true"
                )

    bound.info(
        "anomaly_detection_complete",
        total_clusters=len(clusters),
        flagged=len(flagged),
        upserted=upserted,
    )
