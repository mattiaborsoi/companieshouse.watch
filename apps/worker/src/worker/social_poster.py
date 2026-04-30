"""
Daily social post to Bluesky.

Picks the highest-scoring active anomaly (either kind), formats a short
factual post, and publishes via the AT Protocol HTTP API.

Redis dedup key prevents double-posting on the same day.
Credentials are optional — if not set, this cron is a no-op.
"""
import json
from datetime import datetime, timezone

import httpx
import redis.asyncio as aioredis
import structlog

from .config import settings

log = structlog.get_logger()

_BLUESKY_API = "https://bsky.social/xrpc"

_TOP_ANOMALY_SQL = """
SELECT id::text, kind, score, features
FROM public.anomalies
WHERE is_currently_flagged = true
  AND takedown_action IS DISTINCT FROM 'removed'
ORDER BY score DESC
LIMIT 1
"""


def _format_post(kind: str, features: dict, anomaly_id: str) -> str:
    url = f"{settings.site_url.rstrip('/')}/anomalies/{anomaly_id}"

    if kind == "address_cluster":
        parts = [features.get("address_line_1"), features.get("locality"), features.get("postcode")]
        address = ", ".join(p for p in parts if p) or "unknown address"
        count = features.get("company_count", 0)
        recent = features.get("recently_incorporated", 0)
        directors = features.get("shared_directors", 0)

        detail = f"{recent} incorporated in 90d" if recent else ""
        if directors:
            detail += f", {directors} shared director{'s' if directors != 1 else ''}" if detail else f"{directors} shared director{'s' if directors != 1 else ''}"

        text = f"🏢 {count} companies registered at {address}."
        if detail:
            text += f" {detail.capitalize()}."
        text += f"\n\n{url}"

    elif kind == "director_velocity":
        name = features.get("officer_name", "An officer")
        count = features.get("company_count", 0)
        recent = features.get("recent_90_days", 0)
        text = (
            f"👤 {name} holds active directorships at {count} companies"
            f", {recent} appointed in the last 90 days."
            f"\n\n{url}"
        )

    else:
        text = f"New anomaly detected (score {features.get('company_count', '?')}).\n\n{url}"

    # Hard-trim to 295 graphemes (Bluesky limit is 300; leave headroom)
    if len(text) > 295:
        text = text[:292] + "…"
    return text


def _byte_slice(text: str, start: int, end: int) -> tuple[int, int]:
    """Convert grapheme offsets to UTF-8 byte offsets for Bluesky facets."""
    return (
        len(text[:start].encode("utf-8")),
        len(text[:end].encode("utf-8")),
    )


async def post_daily_anomaly(ctx: dict) -> None:
    if not settings.bluesky_handle or not settings.bluesky_app_password:
        log.info("social_poster_skipped", reason="no_credentials")
        return

    pool = ctx["pool"]
    r = aioredis.from_url(settings.redis_url, decode_responses=True)

    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    dedup_key = f"social:posted:bluesky:{today}"
    if await r.exists(dedup_key):
        log.info("social_poster_skipped", reason="already_posted_today")
        await r.aclose()
        return

    row = await pool.fetchrow(_TOP_ANOMALY_SQL)
    if not row:
        log.info("social_poster_skipped", reason="no_anomalies")
        await r.aclose()
        return

    features = row["features"]
    if isinstance(features, str):
        features = json.loads(features)

    text = _format_post(row["kind"], features, row["id"])

    # Find the URL in the post text for the facet
    url = f"{settings.site_url.rstrip('/')}/anomalies/{row['id']}"
    url_char_start = text.find(url)
    url_char_end = url_char_start + len(url)
    byte_start, byte_end = _byte_slice(text, url_char_start, url_char_end)

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            # Authenticate
            auth = await client.post(
                f"{_BLUESKY_API}/com.atproto.server.createSession",
                json={"identifier": settings.bluesky_handle, "password": settings.bluesky_app_password},
            )
            auth.raise_for_status()
            token = auth.json()["accessJwt"]

            # Post
            resp = await client.post(
                f"{_BLUESKY_API}/com.atproto.repo.createRecord",
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "repo": settings.bluesky_handle,
                    "collection": "app.bsky.feed.post",
                    "record": {
                        "$type": "app.bsky.feed.post",
                        "text": text,
                        "facets": [
                            {
                                "index": {
                                    "$type": "app.bsky.richtext.facet#byteSlice",
                                    "byteStart": byte_start,
                                    "byteEnd": byte_end,
                                },
                                "features": [
                                    {
                                        "$type": "app.bsky.richtext.facet#link",
                                        "uri": url,
                                    }
                                ],
                            }
                        ],
                        "createdAt": datetime.now(timezone.utc).isoformat(),
                    },
                },
            )
            resp.raise_for_status()

        # Dedup: 48h TTL covers day-boundary edge cases
        await r.setex(dedup_key, 172_800, "1")
        log.info("social_post_sent", platform="bluesky", anomaly_id=row["id"], kind=row["kind"])

    except Exception as exc:
        log.error("social_post_failed", platform="bluesky", error=str(exc))
    finally:
        await r.aclose()
