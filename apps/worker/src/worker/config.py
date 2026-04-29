from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    ch_rest_key: str
    database_url: str = "postgresql+asyncpg://chwatch:chwatch@localhost:5432/chwatch"
    redis_url: str = "redis://localhost:6379/0"
    log_level: str = "INFO"

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")


settings = Settings()
