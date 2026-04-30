"""
LLM Gateway — the only service that may call Anthropic.

All LLM calls pass through here. The gateway:
  1. Checks the ai_summaries cache (returns immediately on hit)
  2. Enforces Redis-backed daily/monthly spend caps
  3. Calls Anthropic Haiku with a fixed prompt template
  4. Writes to public.ai_summaries and audit.llm_calls
  5. Updates anomalies.ai_summary_id if a linked anomaly was passed
"""
import hashlib
import json
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

import structlog
from anthropic import AsyncAnthropic
from fastapi import FastAPI, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, field_validator

from .config import settings
from .db import close_pool, get_pool
from .prompts import PROMPT_VERSION, build_anomaly_prompt, SYSTEM_PROMPT
from .spend import check_caps, get_spend, record_spend

log = structlog.get_logger()

MODEL = "claude-haiku-4-5-20251001"
ALLOWED_KINDS = {"anomaly_explanation"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    structlog.configure(
        wrapper_class=structlog.make_filtering_bound_logger(
            getattr(logging, settings.log_level.upper(), logging.INFO)
        ),
    )
    await get_pool()
    log.info("gateway_started", model=MODEL)
    yield
    await close_pool()
    log.info("gateway_stopped")


app = FastAPI(title="LLM Gateway", lifespan=lifespan)

_anthropic = AsyncAnthropic(api_key=settings.anthropic_api_key)


class GenerateRequest(BaseModel):
    kind: str
    anomaly_id: str | None = None
    features: dict[str, Any]
    source: str = "web_ui"

    @field_validator("kind")
    @classmethod
    def kind_allowed(cls, v: str) -> str:
        if v not in ALLOWED_KINDS:
            raise ValueError(f"kind must be one of {ALLOWED_KINDS}")
        return v


class GenerateResponse(BaseModel):
    id: str
    output: str
    cached: bool
    generated_at: str


def _input_hash(features: dict) -> str:
    canonical = PROMPT_VERSION + json.dumps(features, sort_keys=True)
    return hashlib.sha256(canonical.encode()).hexdigest()


@app.post("/generate", response_model=GenerateResponse)
async def generate(req: GenerateRequest):
    pool = await get_pool()
    input_hash = _input_hash(req.features)

    # 1. Cache check
    cached_row = await pool.fetchrow(
        """
        SELECT id::text, output, generated_at
        FROM public.ai_summaries
        WHERE kind = $1 AND prompt_version = $2 AND input_hash = $3
        """,
        req.kind, PROMPT_VERSION, input_hash,
    )
    if cached_row:
        log.info("cache_hit", kind=req.kind, anomaly_id=req.anomaly_id)
        await _log_llm_call(
            pool=pool,
            ai_summary_id=cached_row["id"],
            kind=req.kind,
            source=req.source,
            cached=True,
            outcome="cached",
            cost_pence=0,
        )
        return GenerateResponse(
            id=cached_row["id"],
            output=cached_row["output"],
            cached=True,
            generated_at=cached_row["generated_at"].isoformat(),
        )

    # 2. Spend cap check
    try:
        await check_caps()
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))

    # 3. Build prompt and call Anthropic
    if req.kind == "anomaly_explanation":
        user_prompt = build_anomaly_prompt(req.features)
    else:
        raise HTTPException(status_code=400, detail="Unknown kind")

    t0 = time.monotonic()
    try:
        response = await _anthropic.messages.create(
            model=MODEL,
            max_tokens=350,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_prompt}],
        )
    except Exception as exc:
        log.exception("anthropic_error", error=str(exc))
        await _log_llm_call(
            pool=pool, ai_summary_id=None, kind=req.kind, source=req.source,
            cached=False, outcome="error", cost_pence=0,
            error_message=str(exc)[:500],
            latency_ms=int((time.monotonic() - t0) * 1000),
        )
        raise HTTPException(status_code=502, detail="AI service error")

    latency_ms = int((time.monotonic() - t0) * 1000)
    output_text = response.content[0].text
    input_tokens = response.usage.input_tokens
    output_tokens = response.usage.output_tokens

    # Haiku pricing: $0.80/M input, $4.00/M output (converted to pence)
    cost_pence = max(1, round(
        (input_tokens * 0.80 / 1_000_000 + output_tokens * 4.00 / 1_000_000) * 100
    ))

    # 4. Write to ai_summaries
    summary_id = await pool.fetchval(
        """
        INSERT INTO public.ai_summaries (
            kind, prompt_version, input_hash, model,
            output, output_format, input_tokens, output_tokens, cost_pence
        ) VALUES ($1, $2, $3, $4, $5, 'plain', $6, $7, $8)
        ON CONFLICT (kind, prompt_version, input_hash) DO UPDATE
            SET superseded_by = NULL  -- already cached, treat as hit
        RETURNING id::text
        """,
        req.kind, PROMPT_VERSION, input_hash, MODEL,
        output_text, input_tokens, output_tokens, cost_pence,
    )

    # 5. Link anomaly record if provided
    if req.anomaly_id:
        await pool.execute(
            "UPDATE public.anomalies SET ai_summary_id = $1::uuid WHERE id = $2::uuid",
            summary_id, req.anomaly_id,
        )

    # 6. Record spend
    await record_spend(cost_pence)

    # 7. Audit log
    await _log_llm_call(
        pool=pool, ai_summary_id=summary_id, kind=req.kind, source=req.source,
        cached=False, outcome="success", cost_pence=cost_pence,
        model=MODEL, input_tokens=input_tokens, output_tokens=output_tokens,
        latency_ms=latency_ms,
    )

    log.info(
        "generated",
        kind=req.kind, anomaly_id=req.anomaly_id,
        tokens=input_tokens + output_tokens, cost_pence=cost_pence,
    )

    generated_at_row = await pool.fetchval(
        "SELECT generated_at FROM public.ai_summaries WHERE id = $1::uuid", summary_id
    )

    return GenerateResponse(
        id=summary_id,
        output=output_text,
        cached=False,
        generated_at=generated_at_row.isoformat(),
    )


_bearer = HTTPBearer(auto_error=False)


def _check_api_key(credentials: HTTPAuthorizationCredentials | None = Security(_bearer)) -> None:
    if settings.gateway_api_key is None:
        return
    if credentials is None or credentials.credentials != settings.gateway_api_key:
        raise HTTPException(status_code=401, detail="Unauthorized")


@app.get("/spend")
async def spend_status(credentials: HTTPAuthorizationCredentials | None = Security(_bearer)):
    _check_api_key(credentials)
    return await get_spend()


@app.get("/health")
async def health():
    return {"ok": True}


async def _log_llm_call(
    *,
    pool,
    ai_summary_id: str | None,
    kind: str,
    source: str,
    cached: bool,
    outcome: str,
    cost_pence: int,
    model: str | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    latency_ms: int | None = None,
    error_message: str | None = None,
) -> None:
    try:
        await pool.execute(
            """
            INSERT INTO audit.llm_calls (
                ai_summary_id, kind, prompt_version, source, model,
                input_tokens, output_tokens, cost_pence,
                cached_hit, outcome, latency_ms, error_message
            ) VALUES (
                $1::uuid, $2, $3, $4, $5,
                $6, $7, $8,
                $9, $10, $11, $12
            )
            """,
            ai_summary_id, kind, PROMPT_VERSION, source, model,
            input_tokens, output_tokens, cost_pence,
            cached, outcome, latency_ms, error_message,
        )
    except Exception as exc:
        log.warning("audit_log_failed", error=str(exc))
