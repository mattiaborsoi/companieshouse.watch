"""
Long-lived process that consumes the Companies House streaming API and enqueues
events as arq jobs for the worker to process.

Each of the 4 streams runs as a separate asyncio task. Timepoints are persisted
to Redis so the process can resume from where it left off after a restart.
"""
import asyncio
import json
import logging
import signal
from base64 import b64encode

import httpx
import redis.asyncio as aioredis
import structlog
from arq import create_pool
from arq.connections import RedisSettings

from .config import settings

CH_STREAM_BASE = "https://stream.companieshouse.gov.uk"

STREAMS = [
    "companies",
    "filings",
    "officers",
    "persons-with-significant-control",
]

# Back-off times on connection errors (seconds)
BACKOFF_HTTP_ERROR = 30
BACKOFF_CONNECT_ERROR = 10
BACKOFF_UNEXPECTED = 60

log = structlog.get_logger()


def _auth_header(key: str) -> str:
    token = b64encode(f"{key}:".encode()).decode()
    return f"Basic {token}"


async def consume_stream(
    stream_name: str,
    redis: aioredis.Redis,
    arq_pool,
    shutdown: asyncio.Event,
) -> None:
    timepoint_key = f"stream:timepoint:{stream_name}"
    bound_log = log.bind(stream=stream_name)

    while not shutdown.is_set():
        timepoint = await redis.get(timepoint_key)
        url = f"{CH_STREAM_BASE}/{stream_name}"
        if timepoint:
            url = f"{url}?timepoint={timepoint.decode()}"

        bound_log.info("connecting", url=url)

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(None, connect=30.0)) as client:
                async with client.stream(
                    "GET",
                    url,
                    headers={"Authorization": _auth_header(settings.ch_stream_key)},
                ) as resp:
                    resp.raise_for_status()
                    bound_log.info("connected", status=resp.status_code)

                    async for line in resp.aiter_lines():
                        if shutdown.is_set():
                            break
                        if not line.strip():
                            continue

                        try:
                            event = json.loads(line)
                        except json.JSONDecodeError:
                            bound_log.warning("invalid_json", preview=line[:200])
                            continue

                        # CH nests timepoint and published_at under event.event
                        event_meta = event.get("event") or {}
                        tp = event_meta.get("timepoint")
                        if tp is not None:
                            await redis.set(timepoint_key, str(tp))

                        await arq_pool.enqueue_job("process_event", stream_name, event)
                        bound_log.debug(
                            "enqueued",
                            timepoint=tp,
                            resource_kind=event.get("resource_kind"),
                            published_at=event_meta.get("published_at"),
                        )

        except httpx.HTTPStatusError as exc:
            bound_log.error(
                "http_error",
                status=exc.response.status_code,
                # response.text is unavailable in streaming context; use status only
            )
            await _sleep_unless_shutdown(BACKOFF_HTTP_ERROR, shutdown)

        except (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError) as exc:
            bound_log.warning("connection_error", error=str(exc))
            await _sleep_unless_shutdown(BACKOFF_CONNECT_ERROR, shutdown)

        except Exception as exc:
            bound_log.exception("unexpected_error", error=str(exc))
            await _sleep_unless_shutdown(BACKOFF_UNEXPECTED, shutdown)


async def _sleep_unless_shutdown(seconds: float, shutdown: asyncio.Event) -> None:
    try:
        await asyncio.wait_for(shutdown.wait(), timeout=seconds)
    except asyncio.TimeoutError:
        pass


async def main() -> None:
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.log_level.upper(), logging.INFO)
        ),
    )

    redis = aioredis.from_url(settings.redis_url, decode_responses=False)
    arq_pool = await create_pool(RedisSettings.from_dsn(settings.redis_url))

    shutdown = asyncio.Event()
    loop = asyncio.get_running_loop()

    def _handle_signal() -> None:
        log.info("shutdown_requested")
        shutdown.set()

    loop.add_signal_handler(signal.SIGINT, _handle_signal)
    loop.add_signal_handler(signal.SIGTERM, _handle_signal)

    tasks = [
        asyncio.create_task(
            consume_stream(stream, redis, arq_pool, shutdown),
            name=f"stream:{stream}",
        )
        for stream in STREAMS
    ]

    log.info("streamer_started", streams=STREAMS)

    try:
        await asyncio.gather(*tasks)
    finally:
        await redis.aclose()
        await arq_pool.aclose()
        log.info("streamer_stopped")


if __name__ == "__main__":
    asyncio.run(main())
