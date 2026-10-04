from functools import lru_cache
from typing import Annotated, Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


def _decode_pem(value: str | None) -> str | None:
    """VAPID keys are stored base64-encoded because a PEM spans multiple lines
    and dotenv cannot represent that as one value."""
    if not value:
        return None
    import base64

    try:
        return base64.b64decode(value).decode()
    except Exception:
        # Tolerate a raw PEM already present in the environment.
        return value if "BEGIN" in value else None


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
    # Tolerance for clock drift between this host and Supabase. Without it a
    # token minted a second ahead of our clock is rejected as "not yet valid",
    # which fails sign-in intermittently on machines whose clock runs behind.
    supabase_jwt_leeway_seconds: int = 60
    google_calendar_client_id: str | None = None
    google_calendar_client_secret: str | None = None
    google_calendar_redirect_uri: str = "http://127.0.0.1:8000/api/v1/calendar/google/callback"
    token_encryption_key: str | None = None
    google_oauth_state_secret: str | None = None
    # Web Push (VAPID), base64-encoded PEM. Generate with:
    #   python scripts/generate_vapid.py
    web_push_public_key: str | None = None
    web_push_private_key: str | None = None
    # Must be a mailto: or https: URL identifying the sender.
    web_push_subject: str | None = None

    @property
    def web_push_public_key_pem(self) -> str | None:
        return _decode_pem(self.web_push_public_key)

    @property
    def web_push_private_key_pem(self) -> str | None:
        return _decode_pem(self.web_push_private_key)

    @property
    def web_push_enabled(self) -> bool:
        return bool(self.web_push_public_key and self.web_push_private_key and self.web_push_subject)
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
