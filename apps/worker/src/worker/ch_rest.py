"""Thin wrapper around the Companies House REST API."""
import asyncio
import time
from base64 import b64encode

import httpx
import structlog

from .config import settings

CH_REST_BASE = "https://api.company-information.service.gov.uk"

# 600 req / 5 min = 2/s; stay safely under with a small delay
_RATE_LIMIT_DELAY = 0.6

# Shared backoff: if we hit a 429, all callers wait until this monotonic
# time before issuing another request. CH typically rate-limits us for
# ~5 minutes; we wait at least 60 s and back off further on repeated 429s.
_backoff_until: float = 0.0
_consecutive_429s: int = 0
_backoff_lock = asyncio.Lock()

log = structlog.get_logger()

_http_client: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        token = b64encode(f"{settings.ch_rest_key}:".encode()).decode()
        _http_client = httpx.AsyncClient(
            base_url=CH_REST_BASE,
            headers={"Authorization": f"Basic {token}"},
            timeout=30.0,
        )
    return _http_client


async def _wait_for_backoff() -> None:
    now = time.monotonic()
    if now < _backoff_until:
        wait = _backoff_until - now
        log.info("ch_rest_waiting_for_backoff", seconds=round(wait, 1))
        await asyncio.sleep(wait)


async def _record_429() -> None:
    global _backoff_until, _consecutive_429s
    async with _backoff_lock:
        _consecutive_429s += 1
        # 60 s for first 429, then double up to 600 s ceiling.
        wait_s = min(60 * (2 ** (_consecutive_429s - 1)), 600)
        _backoff_until = max(_backoff_until, time.monotonic() + wait_s)
        log.warning("ch_rest_rate_limited", backoff_seconds=wait_s, consecutive=_consecutive_429s)


async def _record_success() -> None:
    global _consecutive_429s
    if _consecutive_429s > 0:
        async with _backoff_lock:
            _consecutive_429s = 0


async def get_company(company_number: str) -> dict | None:
    await _wait_for_backoff()
    try:
        resp = await _client().get(f"/company/{company_number}")
        if resp.status_code == 429:
            await _record_429()
            return None
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        await _record_success()
        await asyncio.sleep(_RATE_LIMIT_DELAY)
        return resp.json()
    except httpx.HTTPStatusError as exc:
        log.warning("ch_rest_error", endpoint=f"/company/{company_number}", status=exc.response.status_code)
        return None
    except httpx.RequestError as exc:
        log.warning("ch_rest_request_error", error=str(exc))
        return None
