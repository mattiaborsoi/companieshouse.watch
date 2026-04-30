"""Polite HTTP fetcher for company homepage resolution.

Fetches HTML, extracts <title>, <meta name="description">, and a favicon URL.
Caps response size to avoid SVG bombs / decompression bombs / multi-MB pages.
Follows redirects but caps the chain. Respects basic timeouts.
"""
from dataclasses import dataclass
from urllib.parse import urljoin, urlparse

import httpx
import structlog
from selectolax.parser import HTMLParser

log = structlog.get_logger()

_MAX_HTML_BYTES = 1_000_000   # 1 MB
_TIMEOUT_SECONDS = 8.0
_MAX_REDIRECTS = 3
_USER_AGENT = (
    "companieshouse.watch/1.0 (+https://ch.borsoi.co.uk/about) "
    "Mozilla/5.0 (compatible; ch-bot/1.0)"
)


@dataclass
class FetchedPage:
    final_url: str
    title: str | None
    description: str | None
    favicon_url: str | None
    body_text_lower: str   # for substring checks against company name / number


async def fetch_page(url: str) -> FetchedPage | None:
    """Fetch a homepage and extract identity data. Returns None on failure."""
    try:
        async with httpx.AsyncClient(
            timeout=_TIMEOUT_SECONDS,
            follow_redirects=True,
            max_redirects=_MAX_REDIRECTS,
            headers={"User-Agent": _USER_AGENT},
        ) as client:
            resp = await client.get(url)

        if resp.status_code != 200:
            return None

        ct = resp.headers.get("content-type", "")
        if "html" not in ct.lower():
            return None

        # Cap body size — read up to MAX bytes, ignore the rest
        html_bytes = resp.content[:_MAX_HTML_BYTES]
        html = html_bytes.decode("utf-8", errors="replace")

    except (httpx.HTTPError, httpx.TooManyRedirects, OSError) as e:
        log.debug("http_fetch_error", url=url, error=str(e))
        return None

    try:
        tree = HTMLParser(html)
    except Exception as e:
        log.debug("html_parse_error", url=url, error=str(e))
        return None

    title_node = tree.css_first("title")
    title = title_node.text(strip=True) if title_node else None

    desc_node = tree.css_first('meta[name="description"]') or tree.css_first(
        'meta[property="og:description"]'
    )
    description = (desc_node.attributes.get("content") or "").strip() if desc_node else None
    if description and len(description) > 500:
        description = description[:497] + "…"

    # Favicon: try icon links in order of preference; fall back to /favicon.ico
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

    body_text = ""
    body_node = tree.body
    if body_node:
        body_text = body_node.text(separator=" ").lower()[:50_000]

    return FetchedPage(
        final_url=str(resp.url),
        title=title[:300] if title else None,
        description=description if description else None,
        favicon_url=favicon_url,
        body_text_lower=body_text,
    )
