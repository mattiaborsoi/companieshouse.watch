"""Brave Search API client.

Free tier: 1 req/s, 2000 req/month. We rate-limit aggressively client-side
and track call counts for cost monitoring.
"""
import asyncio
import time
from dataclasses import dataclass

import httpx
import structlog

from .config import settings

log = structlog.get_logger()

_BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search"
_MIN_INTERVAL_SECONDS = 1.1  # be polite — slightly more than the 1 req/s limit


@dataclass
class BraveResult:
    title: str
    url: str
    description: str


class BraveSearchClient:
    """Singleton-style client. Use via the module-level `brave_search()` helper."""

    def __init__(self, api_key: str):
        self.api_key = api_key
        self._last_call_at: float = 0.0
        self._lock = asyncio.Lock()

    async def search(self, query: str, count: int = 5) -> list[BraveResult]:
        if not self.api_key:
            log.warning("brave_search_no_key")
            return []

        async with self._lock:
            elapsed = time.monotonic() - self._last_call_at
            if elapsed < _MIN_INTERVAL_SECONDS:
                await asyncio.sleep(_MIN_INTERVAL_SECONDS - elapsed)

            try:
                async with httpx.AsyncClient(timeout=10.0) as client:
                    resp = await client.get(
                        _BRAVE_ENDPOINT,
                        params={"q": query, "count": count},
                        headers={
                            "X-Subscription-Token": self.api_key,
                            "Accept": "application/json",
                        },
                    )
                    self._last_call_at = time.monotonic()

                if resp.status_code == 429:
                    log.warning("brave_rate_limited", query=query)
                    return []
                resp.raise_for_status()
                data = resp.json()

            except httpx.HTTPError as e:
                log.warning("brave_http_error", query=query, error=str(e))
                return []

        results = data.get("web", {}).get("results", [])
        return [
            BraveResult(
                title=r.get("title", ""),
                url=r.get("url", ""),
                description=r.get("description", ""),
            )
            for r in results
        ]


_client: BraveSearchClient | None = None


def get_client() -> BraveSearchClient:
    global _client
    if _client is None:
        _client = BraveSearchClient(settings.brave_search_api_key or "")
    return _client


async def search(query: str, count: int = 5) -> list[BraveResult]:
    return await get_client().search(query, count)
