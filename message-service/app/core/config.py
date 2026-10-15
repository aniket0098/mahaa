"""Configuration for the Mahaa Message service.

Mirrors ``backend/app/core/config.py`` deliberately: the same environment
variable names, the same fail-closed production checks and the same placeholder
refusals, so an operator who knows one service can run the other. The two are
separate processes with separate settings objects — nothing here is imported
from ``backend/``, because this service ships in its own Docker build context.

**Authentication is validated with the main backend's keys.** The mobile app
signs in once against the main API and presents the same bearer token here, so
``JWT_SECRET`` / ``JWT_ISSUER`` / ``JWT_AUDIENCE`` must match the main backend's
values. That is the only coupling to the main backend's runtime configuration,
and it is a *shared credential*, not a shared code path.
"""

from __future__ import annotations

import json
import sys
from functools import lru_cache

from pydantic import Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Refused in production — a copied ``.env.example`` must not boot against a
#: real database. Identical to the main backend's placeholder on purpose.
PLACEHOLDER_DATABASE_URL = "postgresql+psycopg://user:password@localhost:5432/mahaa"

#: Refused in production, for the same reason the main backend refuses it: a
#: plausible-looking default key would be copied, committed, and end up
#: accepting forged tokens for everyone.
PLACEHOLDER_JWT_SECRET = "dev-only-insecure-secret-change-me"

MIN_JWT_SECRET_LENGTH = 32
ALLOWED_JWT_ALGORITHMS = frozenset({"HS256", "HS384", "HS512"})


class Settings(BaseSettings):
    """Runtime settings, validated once at boot."""

    model_config = SettingsConfigDict(
        env_file=(".env", "message-service/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- identity -----------------------------------------------------------
    app_name: str = "Mahaa Message Service"
    app_version: str = "0.1.0"
    app_env: str = Field(default="development")
    debug: bool = Field(default=False)

    # --- routing ------------------------------------------------------------
    #: Same prefix as the main API so the mobile client composes URLs the same
    #: way: ``<host>/api/v1/...`` regardless of which service answers.
    api_prefix: str = "/api/v1"

    # --- server -------------------------------------------------------------
    #: Render injects ``PORT``; the local default keeps this service off the
    #: main API's 8000 so both can run at once.
    port: int = 8001
    cors_origins: str = ""
    #: Optional explicit log level via ``LOG_LEVEL``. Unset (``null``) derives
    #: from ``DEBUG``, which is the documented default; set it to pin the root
    #: logger independently. The alias keeps the field name distinct from the
    #: ``log_level`` property the logging module reads.
    log_level_override: str | None = Field(
        default=None, validation_alias="LOG_LEVEL"
    )
    #: Largest request body accepted, in bytes. Every real payload here is
    #: ``{recipient_id, note?}`` — a few hundred bytes — so 64 KiB is
    #: generous, and refusing anything larger before it is parsed is a cheap
    #: bound on memory and work per request.
    max_body_bytes: int = 65536

    @field_validator("log_level_override", mode="before")
    @classmethod
    def _log_level_must_be_known(cls, value: object) -> object:
        if value is None or value == "":
            return None
        level = str(value).strip().upper()
        if level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
            raise ValueError(
                "LOG_LEVEL must be one of DEBUG, INFO, WARNING, ERROR, CRITICAL; "
                f"got {value!r}."
            )
        return level

    # --- database -----------------------------------------------------------
    #: Shares the main backend's Neon PostgreSQL. Ownership: this service owns
    #: the ``message_requests`` table and its own Alembic version table; every
    #: other table belongs to the main backend and is only ever read here (the
    #: ``users`` table, for identity) — never written.
    database_url: str = Field(default=PLACEHOLDER_DATABASE_URL)

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
                "DATABASE_URL must use postgresql+psycopg://, got "
                f"{value.split(':', 1)[0]!r}."
            )
        return value

    # --- authentication -----------------------------------------------------
    #: Must equal the main backend's ``JWT_SECRET``: one signing key, two
    #: services, so a token minted by the API is verifiable here.
    jwt_secret: str = Field(default=PLACEHOLDER_JWT_SECRET)
    #: Pinned; the incoming ``alg`` header is never trusted.
    jwt_algorithm: str = Field(default="HS256")
    #: Verified on every decode, so a token minted for another environment or
    #: audience is rejected rather than trusted. Defaults match the main
    #: backend's ``app/core/config.py`` exactly.
    jwt_issuer: str = Field(default="mahaa-api")
    jwt_audience: str = Field(default="mahaa-mobile")


    @property
    def cors_origin_list(self) -> list[str]:
        return [
            origin.strip() for origin in self.cors_origins.split(",") if origin.strip()
        ]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @model_validator(mode="after")
    def _fail_closed_in_production(self) -> Settings:
        """Refuse to boot a production service on development-grade settings."""

        if not self.is_production:
            return self
        if self.database_url == PLACEHOLDER_DATABASE_URL:
            raise ValueError(
                "DATABASE_URL is still the placeholder value. Production refuses "
                "to boot without a real database URL."
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
                "JWT_ALGORITHM must be one of "
                f"{sorted(ALLOWED_JWT_ALGORITHMS)}; got {self.jwt_algorithm}."
            )
        if not self.jwt_issuer or not self.jwt_audience:
            raise ValueError("JWT_ISSUER and JWT_AUDIENCE must not be empty.")
        return self

    @property
    def log_level(self) -> str:
        # An explicit LOG_LEVEL override wins; otherwise DEBUG picks it.
        if self.log_level_override:
            return self.log_level_override
        return "DEBUG" if self.debug else "INFO"


@lru_cache
def get_settings() -> Settings:
    """Cached so validation runs once, not per request.

    A configuration failure is a startup failure, so it is handled here — where
    the settings are first built — rather than allowed to surface as an
    unhandled ``ValidationError``. Uvicorn would otherwise print a full Python
    stack trace, and pydantic echoes the offending *values* into it (``JWT_SECRET``
    and ``DATABASE_URL`` among them). Instead the service writes one JSON line
    naming only the failing fields and their messages, then exits non-zero: a
    clear, safe signal to the orchestrator that the container must not run.
    """

    try:
        return Settings()
    except ValidationError as exc:
        # Field locations (e.g. ["jwt_secret"]) and messages only. `exc.errors()`
        # also carries an "input" entry holding the actual value; it is dropped.
        problems = [
            {"field": ".".join(str(p) for p in err.get("loc", ())), "reason": err.get("msg", "")}
            for err in exc.errors()
        ]
        print(
            json.dumps(
                {
                    "level": "ERROR",
                    "logger": "mahaa.message.config",
                    "message": "Configuration is invalid; refusing to start.",
                    "problems": problems,
                },
                ensure_ascii=False,
            ),
            file=sys.stderr,
            flush=True,
        )
        raise SystemExit(1) from None
