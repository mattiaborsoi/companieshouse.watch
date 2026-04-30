"""Redis-backed spend tracking and cap enforcement."""
from datetime import datetime, timezone

import redis.asyncio as aioredis

from .config import settings

_redis: aioredis.Redis | None = None


def _get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(settings.redis_url, decode_responses=True)
    return _redis


def _keys() -> tuple[str, str]:
    now = datetime.now(timezone.utc)
    return (
        f"llm:spend:daily:{now.strftime('%Y%m%d')}",
        f"llm:spend:monthly:{now.strftime('%Y%m')}",
    )


async def check_caps() -> None:
    """Raise ValueError if either spend cap would be exceeded."""
    r = _get_redis()
    daily_key, monthly_key = _keys()
    daily = int(await r.get(daily_key) or 0)
    monthly = int(await r.get(monthly_key) or 0)
    if daily >= settings.daily_cap_pence:
        raise ValueError(f"Daily AI spend cap reached ({daily}p / {settings.daily_cap_pence}p)")
    if monthly >= settings.monthly_cap_pence:
        raise ValueError(f"Monthly AI spend cap reached ({monthly}p / {settings.monthly_cap_pence}p)")


async def record_spend(cost_pence: int) -> None:
    """Increment spend counters after a successful billed call."""
    r = _get_redis()
    daily_key, monthly_key = _keys()
    pipe = r.pipeline()
    pipe.incrby(daily_key, cost_pence)
    pipe.expire(daily_key, 172_800)     # 48h TTL
    pipe.incrby(monthly_key, cost_pence)
    pipe.expire(monthly_key, 5_184_000)  # 60 days TTL
    await pipe.execute()


async def get_spend() -> dict:
    r = _get_redis()
    daily_key, monthly_key = _keys()
    daily = int(await r.get(daily_key) or 0)
    monthly = int(await r.get(monthly_key) or 0)
    return {
        "daily_pence": daily,
        "monthly_pence": monthly,
        "daily_cap_pence": settings.daily_cap_pence,
        "monthly_cap_pence": settings.monthly_cap_pence,
    }
