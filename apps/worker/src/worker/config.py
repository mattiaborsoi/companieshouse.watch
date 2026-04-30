from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ch_rest_key: str
    database_url: str = "postgresql+asyncpg://chwatch:chwatch@localhost:5432/chwatch"
    redis_url: str = "redis://localhost:6379/0"
    log_level: str = "INFO"

    # Social posting (optional — skip if not set)
    bluesky_handle: str = ""
    bluesky_app_password: str = ""
    site_url: str = "https://companieshouse.watch"

    # Phase 1: company identity resolution (optional — skip if not set)
    brave_search_api_key: str = ""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
