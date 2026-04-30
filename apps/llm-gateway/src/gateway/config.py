from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    anthropic_api_key: str
    database_url: str = "postgresql://chwatch:chwatch@localhost:5432/chwatch"
    redis_url: str = "redis://localhost:6379/0"
    log_level: str = "INFO"

    # Hard caps (pence). £5/day, £100/month.
    daily_cap_pence: int = 500
    monthly_cap_pence: int = 10_000

    # Optional shared secret for the /spend status endpoint.
    # If set, requests must include: Authorization: Bearer <key>
    gateway_api_key: str | None = None

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
