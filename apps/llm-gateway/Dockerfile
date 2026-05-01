FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml .
RUN pip install --no-cache-dir fastapi "uvicorn[standard]" anthropic asyncpg "redis[asyncio]>=5.0" pydantic "pydantic-settings>=2.4" structlog

COPY src/ src/
RUN pip install --no-cache-dir --no-deps .

RUN useradd -m appuser
USER appuser

CMD ["uvicorn", "gateway.main:app", "--host", "0.0.0.0", "--port", "8000"]
