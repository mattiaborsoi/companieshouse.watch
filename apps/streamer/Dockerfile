FROM python:3.12-slim
WORKDIR /app

# Install deps first so this layer is cached unless pyproject.toml changes
COPY pyproject.toml .
RUN pip install --no-cache-dir httpx "redis>=5.0" arq "pydantic-settings>=2.4" structlog

# Copy source and install the package itself (no-deps since deps are already present)
COPY src/ src/
RUN pip install --no-cache-dir --no-deps .

CMD ["python", "-m", "streamer.main"]
