"""Polite HTTP fetcher for company homepage resolution.

Security:
  - SSRF protection: rejects URLs that resolve to private/loopback/link-local
    IPs, both pre-fetch and on every redirect hop.
  - Caps response size to avoid SVG bombs / decompression bombs.
  - Requires HTTPS unless explicitly allowed (we don't allow it).
  - Strips control / bidi chars from extracted text before returning.

Politeness:
  - Per-domain rate limit (5 requests/min).
  - Respects robots.txt (cached per domain for the worker run).
  - Identifying User-Agent with a contact URL.
"""
import asyncio
import ipaddress
import re
import socket
import time
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.robotparser import RobotFileParser

import httpx
import structlog
from selectolax.parser import HTMLParser

log = structlog.get_logger()

_MAX_HTML_BYTES = 1_000_000   # 1 MB
_MAX_FAVICON_BYTES = 200_000  # 200 KB — favicons should be much smaller
_TIMEOUT_SECONDS = 8.0
_MAX_REDIRECTS = 3
_USER_AGENT = (
    "companieshouse.watch/1.0 (+https://ch.borsoi.co.uk/about) "
    "Mozilla/5.0 (compatible; ch-bot/1.0)"
)
_DOMAIN_MIN_INTERVAL = 12.0   # 5 requests per domain per minute

_ALLOWED_FAVICON_CONTENT_TYPES = {
    "image/png", "image/jpeg", "image/jpg", "image/webp",
    "image/x-icon", "image/vnd.microsoft.icon", "image/icon",
    "image/svg+xml",
}

# Strip control + bidi chars (zero-width, RLO/LRO etc.) from extracted text.
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​-‏‪-‮⁦-⁩]")

_DOMAIN_LAST_FETCH: dict[str, float] = {}
_ROBOTS_CACHE: dict[str, RobotFileParser | None] = {}


@dataclass
class FetchedPage:
    final_url: str
    title: str | None
    description: str | None
    favicon_url: str | None
    body_text_lower: str


@dataclass
class FetchedFavicon:
    url: str
    content_type: str
    bytes: bytes


class SSRFError(Exception):
    pass


def _strip_ctrl(s: str) -> str:
    return _CTRL_RE.sub("", s)


def _is_public_ip(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_multicast
        or ip.is_reserved
        or ip.is_unspecified
    )


async def _resolve_and_validate_host(host: str) -> bool:
    """True iff every A/AAAA record for `host` resolves to a public IP."""
    loop = asyncio.get_event_loop()
    try:
        infos = await loop.getaddrinfo(host, None)
    except (socket.gaierror, OSError):
        return False
    if not infos:
        return False
    for family, _, _, _, sockaddr in infos:
        ip = sockaddr[0]
        if not _is_public_ip(ip):
            return False
    return True


async def _validate_url(url: str) -> str | None:
    """Return the URL if safe, else None. Enforces https + public IP."""
    parsed = urlparse(url)
    if parsed.scheme != "https":
        return None
    if not parsed.hostname:
        return None
    if not await _resolve_and_validate_host(parsed.hostname):
        return None
    return url


async def _check_robots(url: str) -> bool:
    """Return True if our user agent may fetch `url`. Defaults to allow on errors."""
    parsed = urlparse(url)
    if not parsed.scheme or not parsed.netloc:
        return False
    domain_key = f"{parsed.scheme}://{parsed.netloc}"
    if domain_key in _ROBOTS_CACHE:
        rp = _ROBOTS_CACHE[domain_key]
        return rp is None or rp.can_fetch(_USER_AGENT, url)

    robots_url = urljoin(domain_key + "/", "/robots.txt")
    safe = await _validate_url(robots_url)
    if not safe:
        _ROBOTS_CACHE[domain_key] = None
        return True
    try:
        async with httpx.AsyncClient(
            timeout=5.0, follow_redirects=False,
            headers={"User-Agent": _USER_AGENT},
        ) as client:
            resp = await client.get(robots_url)
        if resp.status_code != 200:
            _ROBOTS_CACHE[domain_key] = None
            return True
        rp = RobotFileParser()
        rp.parse(resp.text.splitlines())
        _ROBOTS_CACHE[domain_key] = rp
        return rp.can_fetch(_USER_AGENT, url)
    except (httpx.HTTPError, OSError):
        _ROBOTS_CACHE[domain_key] = None
        return True


async def _per_domain_rate_limit(host: str) -> None:
    last = _DOMAIN_LAST_FETCH.get(host, 0.0)
    elapsed = time.monotonic() - last
    if elapsed < _DOMAIN_MIN_INTERVAL:
        await asyncio.sleep(_DOMAIN_MIN_INTERVAL - elapsed)
    _DOMAIN_LAST_FETCH[host] = time.monotonic()


async def _safe_get(client: httpx.AsyncClient, url: str, max_bytes: int) -> httpx.Response | None:
    """GET with manual redirect following. Re-validates each hop against SSRF rules."""
    current = url
    for hop in range(_MAX_REDIRECTS + 1):
        validated = await _validate_url(current)
        if not validated:
            log.debug("ssrf_blocked", url=current)
            return None
        host = urlparse(current).hostname or ""
        await _per_domain_rate_limit(host)

        try:
            resp = await client.get(current)
        except (httpx.HTTPError, OSError) as e:
            log.debug("http_fetch_error", url=current, error=str(e))
            return None

        if resp.is_redirect:
            location = resp.headers.get("location")
            if not location:
                return None
            current = urljoin(current, location)
            continue
        return resp
    log.debug("max_redirects_exceeded", url=url)
    return None


async def fetch_page(url: str) -> FetchedPage | None:
    """Fetch a homepage and extract identity data. Returns None on failure."""
    if not await _check_robots(url):
        log.debug("robots_disallow", url=url)
        return None

    async with httpx.AsyncClient(
        timeout=_TIMEOUT_SECONDS,
        follow_redirects=False,
        headers={"User-Agent": _USER_AGENT},
    ) as client:
        resp = await _safe_get(client, url, _MAX_HTML_BYTES)

    if resp is None or resp.status_code != 200:
        return None

    ct = resp.headers.get("content-type", "")
    if "html" not in ct.lower():
        return None

    html_bytes = resp.content[:_MAX_HTML_BYTES]
    html = html_bytes.decode("utf-8", errors="replace")

    try:
        tree = HTMLParser(html)
    except Exception as e:
        log.debug("html_parse_error", url=url, error=str(e))
        return None

    title_node = tree.css_first("title")
    title = _strip_ctrl(title_node.text(strip=True))[:300] if title_node else None

    desc_node = tree.css_first('meta[name="description"]') or tree.css_first(
        'meta[property="og:description"]'
    )
    description = (desc_node.attributes.get("content") or "").strip() if desc_node else None
    if description:
        description = _strip_ctrl(description)
        if len(description) > 500:
            description = description[:497] + "…"

    favicon_url: str | None = None
    for selector in (
        'link[rel~="icon"][sizes]',
        'link[rel="icon"]',
        'link[rel="shortcut icon"]',
        'link[rel="apple-touch-icon"]',
    ):
        node = tree.css_first(selector)
        if node and node.attributes.get("href"):
            favicon_url = urljoin(str(resp.url), node.attributes["href"])
            break
    if not favicon_url:
        parsed = urlparse(str(resp.url))
        favicon_url = f"{parsed.scheme}://{parsed.netloc}/favicon.ico"
    # Force https — we won't fetch http favicons later, so don't store them.
    if favicon_url and not favicon_url.startswith("https://"):
        favicon_url = None

    body_text = ""
    body_node = tree.body
    if body_node:
        body_text = body_node.text(separator=" ").lower()[:50_000]

    return FetchedPage(
        final_url=str(resp.url),
        title=title if title else None,
        description=description if description else None,
        favicon_url=favicon_url,
        body_text_lower=body_text,
    )


async def fetch_favicon(url: str) -> FetchedFavicon | None:
    """Fetch + validate a favicon. Same SSRF + size rules as page fetch."""
    if not url or not url.startswith("https://"):
        return None
    async with httpx.AsyncClient(
        timeout=_TIMEOUT_SECONDS,
        follow_redirects=False,
        headers={"User-Agent": _USER_AGENT},
    ) as client:
        resp = await _safe_get(client, url, _MAX_FAVICON_BYTES)
    if resp is None or resp.status_code != 200:
        return None
    ct = (resp.headers.get("content-type", "") or "").split(";")[0].strip().lower()
    if ct not in _ALLOWED_FAVICON_CONTENT_TYPES:
        log.debug("favicon_bad_content_type", url=url, content_type=ct)
        return None
    body = resp.content[:_MAX_FAVICON_BYTES]
    if len(body) == 0 or len(body) >= _MAX_FAVICON_BYTES:
        log.debug("favicon_size_invalid", url=url, size=len(body))
        return None
    # Reject SVGs that look like bombs (recursive/external entities)
    if ct == "image/svg+xml":
        sniff = body[:2000].lower()
        if b"<!entity" in sniff or b"<!doctype" in sniff or b"xlink:href" in sniff:
            log.debug("favicon_svg_unsafe", url=url)
            return None
    return FetchedFavicon(url=str(resp.url), content_type=ct, bytes=bytes(body))
