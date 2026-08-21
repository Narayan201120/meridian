from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="MERIDIAN_",
        case_sensitive=False,
    )

    app_name: str = "Meridian API"
    app_version: str = "0.1.0"
    environment: Literal["development", "staging", "production"] = "development"
    api_v1_prefix: str = "/api/v1"
    database_url: str | None = None
    database_echo: bool = False
    supabase_url: str | None = None
    supabase_jwt_audience: str = "authenticated"
    google_calendar_client_id: str | None = None
    google_calendar_client_secret: str | None = None
    google_calendar_redirect_uri: str = "http://127.0.0.1:8000/api/v1/calendar/google/callback"
    token_encryption_key: str | None = None
    google_oauth_state_secret: str | None = None
    cors_origins: Annotated[list[str], NoDecode] = [
        "http://localhost:8081",
        "http://127.0.0.1:8081",
        "http://localhost:19006",
        "http://127.0.0.1:19006",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]

        return value

    @property
    def oauth_state_secret(self) -> str | None:
        return self.google_oauth_state_secret or self.token_encryption_key

    @property
    def supabase_jwt_issuer(self) -> str | None:
        if self.supabase_url is None:
            return None

        return f"{self.supabase_url.rstrip('/')}/auth/v1"

    @property
    def supabase_jwks_url(self) -> str | None:
        issuer = self.supabase_jwt_issuer
        if issuer is None:
            return None

        return f"{issuer}/.well-known/jwks.json"

    def get_fernet(self):  # type: ignore[no-untyped-def]
        from cryptography.fernet import Fernet

        if not self.token_encryption_key:
            return None
        try:
            return Fernet(self.token_encryption_key.encode())
        except Exception as exc:
            raise ValueError(
                "MERIDIAN_TOKEN_ENCRYPTION_KEY must be a valid Fernet key. "
                "Generate one with: python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\""
            ) from exc


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
