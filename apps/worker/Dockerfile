FROM python:3.14-slim
WORKDIR /app

# Install deps first so this layer is cached unless pyproject.toml changes
COPY pyproject.toml .
RUN pip install --no-cache-dir "arq==0.25.0" asyncpg httpx "redis>=5.0" "pydantic-settings>=2.4" structlog "selectolax>=0.3.21" pytest pytest-asyncio

# Copy source + tests and install the package itself
COPY src/ src/
COPY tests/ tests/
RUN pip install --no-cache-dir --no-deps .

RUN useradd -m appuser
USER appuser

CMD ["arq", "worker.main.WorkerSettings"]
