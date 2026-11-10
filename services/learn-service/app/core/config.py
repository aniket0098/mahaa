"""Configuration for the Mahaa Learn service.

Same environment variable names and fail-closed production checks as the main
backend, so an operator who knows one can run the other. Separate settings
object — nothing imported from 'backend/'.
"""

from __future__ import annotations

import json
import sys
from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PLACEHOLDER_DATABASE_URL = "postgresql+psycopg://user:password@localhost:5432/mahaa"
PLACEHOLDER_JWT_SECRET = "dev-only-insecure-secret-change-me"
MIN_JWT_SECRET_LENGTH = 32
ALLOWED_JWT_ALGORITHMS = frozenset({"HS256", "HS384", "HS512"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "app/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Mahaa Learn Service"
    app_version: str = "0.1.0"
    app_env: str = Field(default="development")
    debug: bool = Field(default=False)

    api_prefix: str = "/api/v1"

    database_url: str = Field(default=PLACEHOLDER_DATABASE_URL)

    jwt_secret: str = Field(default=PLACEHOLDER_JWT_SECRET)
    jwt_algorithm: str = Field(default="HS256")
    jwt_issuer: str = Field(default="mahaa-api")
    jwt_audience: str = Field(default="mahaa-mobile")
    access_token_expire_minutes: int = Field(default=60)
    video_stream_url_ttl_seconds: int = Field(default=900, ge=60, le=86400)

    host: str = "0.0.0.0"
    port: int = 8001
    cors_origins: str = ""
    log_level_override: str | None = Field(default=None, validation_alias="LOG_LEVEL")
    max_body_bytes: int = 10_000_000

    video_storage_kind: str = Field(default="local")
    s3_bucket: str | None = None
    s3_access_key_id: str | None = None
    s3_secret_access_key: str | None = None
    s3_endpoint: str | None = None
    s3_region: str | None = None
    video_storage_dir: str = Field(default="video_work")

    @field_validator("database_url")
    @classmethod
    def _must_be_a_postgres_dsn(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("DATABASE_URL must not be empty.")
        if value.startswith("postgresql://"):
            value = value.replace("postgresql://", "postgresql+psycopg://", 1)
        if not value.startswith(("postgresql+psycopg://", "postgresql+psycopg2://")):
            raise ValueError(
                f"DATABASE_URL must use postgresql+psycopg://, got {value.split(':', 1)[0]}"
            )
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def log_level(self) -> str:
        if self.log_level_override:
            return self.log_level_override
        return "DEBUG" if self.debug else "INFO"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def video_storage_configured(self) -> bool:
        return bool(self.s3_bucket and self.s3_access_key_id and self.s3_secret_access_key)

    @model_validator(mode="after")
    def _fail_closed_in_production(self) -> Settings:
        if not self.is_production:
            return self
        if self.database_url == PLACEHOLDER_DATABASE_URL:
            raise ValueError(
                "DATABASE_URL is still the placeholder value. Production refuses "
                "to boot without a real database URL."
            )
        # Neon requires TLS on every connection. Fail closed so a service never
        # boots without sslmode=require and silently degrades to plaintext.
        if "sslmode=require" not in self.database_url:
            raise ValueError(
                "DATABASE_URL must include sslmode=require for Neon PostgreSQL "
                "in production."
            )
        if self.debug:
            raise ValueError("DEBUG must be false in production (fail-closed).")
        if "*" in self.cors_origin_list:
            raise ValueError(
                "CORS_ORIGINS must list exact origins in production, never '*'."
            )
        if not self.jwt_secret or self.jwt_secret == PLACEHOLDER_JWT_SECRET:
            raise ValueError(
                "JWT_SECRET is still the development placeholder. Production "
                "refuses to verify tokens with a public key."
            )
        if len(self.jwt_secret) < MIN_JWT_SECRET_LENGTH:
            raise ValueError(
                f"JWT_SECRET must be at least {MIN_JWT_SECRET_LENGTH} characters."
            )
        if self.jwt_algorithm not in ALLOWED_JWT_ALGORITHMS:
            raise ValueError(
                f"JWT_ALGORITHM must be one of {sorted(ALLOWED_JWT_ALGORITHMS)}; got {self.jwt_algorithm}."
            )
        if not self.jwt_issuer or not self.jwt_audience:
            raise ValueError("JWT_ISSUER and JWT_AUDIENCE must not be empty.")
        return self


@lru_cache
def get_settings() -> Settings:
    try:
        return Settings()
    except Exception as exc:  # noqa: BLE001 — configuration failure is startup failure
        problems = getattr(exc, "errors", lambda: [{"msg": str(exc)}])()
        print(
            json.dumps(
                {
                    "level": "ERROR",
                    "logger": "mahaa.learn.config",
                    "message": "Configuration is invalid; refusing to start.",
                    "problems": problems,
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(1) from None