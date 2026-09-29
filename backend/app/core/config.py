"""Configuration for the Mahaa backend.

Every value comes from the environment; nothing is hardcoded and no secret has a
usable default. The one deliberate exception is the local development default
below, which points at a database that only ever exists on a developer's machine
and is refused outright when ``app_env`` is ``production``.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

#: Refused in production. Chosen to be obviously wrong so a copied
#: ``.env.example`` cannot quietly boot against a real database.
PLACEHOLDER_DATABASE_URL = "postgresql+psycopg://user:password@localhost:5432/mahaa"


class Settings(BaseSettings):
    """Runtime settings, validated once at boot."""

    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- identity -----------------------------------------------------------
    app_name: str = "Mahaa API"
    app_version: str = "0.1.0"
    app_env: str = Field(default="development")
    debug: bool = Field(default=False)

    # --- routing ------------------------------------------------------------
    #: Every route is mounted under this prefix. The mobile client already
    #: points at ``<host>/api/v1``, so this is a contract, not a preference.
    api_prefix: str = "/api/v1"

    # --- database -----------------------------------------------------------
    database_url: str = Field(default=PLACEHOLDER_DATABASE_URL)

    @field_validator("database_url")
    @classmethod
    def _must_be_a_postgres_dsn(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("DATABASE_URL must not be empty.")
        # psycopg3, not psycopg2: SQLAlchemy silently falls back to the legacy
        # dialect for a bare ``postgresql://`` scheme, and psycopg2 is not a
        # dependency. Normalising here means a copied connection string works.
        if value.startswith("postgresql://"):
            value = value.replace("postgresql://", "postgresql+psycopg://", 1)
        if not value.startswith(("postgresql+psycopg://", "postgresql+psycopg2://")):
            raise ValueError(
                "DATABASE_URL must use postgresql+psycopg://, got "
                f"{value.split(':', 1)[0]!r}."
            )
        return value

    # --- server -------------------------------------------------------------
    host: str = "127.0.0.1"
    port: int = 8000
    cors_origins: str = ""

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
        """Refuse to boot a production service on development-grade settings.

        A backend that starts with a placeholder database URL and only fails on
        the first request is worse than one that never starts: the failure then
        looks like an application bug instead of a configuration one.
        """
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
        return self

    @property
    def log_level(self) -> str:
        return "DEBUG" if self.debug else "INFO"


@lru_cache
def get_settings() -> Settings:
    """Cached so validation runs once, not per request."""
    return Settings()


def allowed_proxy_networks(
    value: str,
) -> list[ipaddress.IPv4Network | ipaddress.IPv6Network]:
    """Parse a comma-separated list of IPs / CIDRs for future proxy trust.

    A malformed entry raises rather than being skipped: a silently ignored trust
    setting is a security setting that looks applied and is not.
    """
    networks: list[ipaddress.IPv4Network | ipaddress.IPv6Network] = []
    for entry in value.split(","):
        entry = entry.strip()
        if not entry:
            continue
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError as exc:
            raise ValueError(f"Invalid IP or network in proxy list: {entry!r}") from exc
    return networks
