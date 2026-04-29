"""Thin wrapper around the Companies House REST API."""
import asyncio
from base64 import b64encode

import httpx
import structlog

from .config import settings

CH_REST_BASE = "https://api.company-information.service.gov.uk"

# 600 req / 5 min = 2/s; stay safely under with a small delay
_RATE_LIMIT_DELAY = 0.6

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


async def get_company(company_number: str) -> dict | None:
    try:
        resp = await _client().get(f"/company/{company_number}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        await asyncio.sleep(_RATE_LIMIT_DELAY)
        return resp.json()
    except httpx.HTTPStatusError as exc:
        log.warning("ch_rest_error", endpoint=f"/company/{company_number}", status=exc.response.status_code)
        return None
    except httpx.RequestError as exc:
        log.warning("ch_rest_request_error", error=str(exc))
        return None
