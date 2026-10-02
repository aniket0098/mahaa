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

#: Refused in production. Same reasoning as the database placeholder: a signing
#: key that is "obviously a placeholder" is safe, because production refuses to
#: start with it, while a key that is a plausible-looking default is not — it
#: would be copied, committed, and end up signing real tokens for everyone.
PLACEHOLDER_JWT_SECRET = "dev-only-insecure-secret-change-me"

#: Shortest secret accepted in production. A shorter HS256 key is brute-forceable
#: offline, so a length floor is a real requirement and not a style preference.
MIN_JWT_SECRET_LENGTH = 32

#: Symmetric algorithms this service will sign and verify with. Asymmetric ones
#: are excluded on purpose: they need a key *pair*, and accepting an algorithm
#: the deployment has no key for is how algorithm-confusion bugs start.
ALLOWED_JWT_ALGORITHMS = frozenset({"HS256", "HS384", "HS512"})


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

    # --- authentication -----------------------------------------------------
    #: Signs access tokens. V1 is access-token-only: there is no refresh token,
    #: so signing in again is the only way to extend a session. That is a
    #: deliberate product decision, not an omission (see the V1 spec §4.8).
    jwt_secret: str = Field(default=PLACEHOLDER_JWT_SECRET)
    #: Pinned to a single algorithm. The `alg` header of an incoming token is
    #: never trusted — an unpinned decoder accepts `alg: none` and the
    #: algorithm-confusion attack that follows from it.
    jwt_algorithm: str = Field(default="HS256")
    #: 60 minutes. Long enough that an active user is not logged out mid-task,
    #: short enough that a stolen token on a lost phone expires on its own.
    access_token_expire_minutes: int = Field(default=60)
    #: Checked on every decode. A token minted for a different service, or for a
    #: different environment of this service, is rejected rather than trusted.
    jwt_issuer: str = Field(default="mahaa-api")
    jwt_audience: str = Field(default="mahaa-mobile")

    # --- realtime ------------------------------------------------------------
    #: Cross-instance event fan-out. Optional by design: the realtime hub works
    #: without it, and so does every REST route. Only a *multi-instance*
    #: deployment needs it, because an in-process hub cannot reach a socket held
    #: by a different Render instance.
    #:
    #: Empty means "no Redis configured", which is a supported state — never a
    #: placeholder that production might silently boot against, and never a
    #: default that would have to be overridden. The realtime subsystem reports
    #: fan-out as unavailable rather than pretending it works.
    redis_url: str = ""

    #: Master switch for the realtime subsystem. `REALTIME_ENABLED=false` keeps
    #: ``/api/v1/ws`` refusing connections with a clear, honest error instead of
    #: accepting sockets it cannot fan out to.
    realtime_enabled: bool = True

    #: Seconds between heartbeat pings on an idle socket, and how long to wait for
    #: the matching pong before the connection is declared dead.
    realtime_heartbeat_seconds: int = Field(default=25, ge=5)
    realtime_heartbeat_timeout_seconds: int = Field(default=10, ge=1)

    #: Bounded cap on concurrent sockets per process, so one client cannot open
    #: connections until the instance runs out of memory.
    realtime_max_connections: int = Field(default=1000, ge=1)

    #: Expo Push Service access token (§13.5). Optional by design: a deployment
    #: without one still creates notifications and still delivers them over the
    #: WebSocket, and `services/push.py` logs a sanitised warning and skips. There
    #: is deliberately no default and no placeholder — a wrong value would fail
    #: every push silently rather than loudly, and an empty string is the honest
    #: representation of "not configured". Server-side only: it is read here and
    #: never crosses an API boundary.
    expo_access_token: str = ""

    # --- rate limiting ------------------------------------------------------
    #: Auth-endpoint limits, per client IP, per fixed window. `0` disables the
    #: limiter entirely, which is how the test suite keeps a fast run from
    #: locking itself out.
    auth_rate_limit_per_window: int = Field(default=10)
    auth_rate_limit_window_seconds: int = Field(default=60)
    auth_rate_limit_enabled: bool = Field(default=True)

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

        # --- authentication must fail closed too -----------------------------
        # A service that starts with a placeholder signing key will happily mint
        # tokens that anyone can forge. Refusing to boot is the only safe
        # response: the alternative is a live deployment whose entire auth model
        # is a public string.
        if not self.jwt_secret:
            raise ValueError("JWT_SECRET is required in production (fail-closed).")
        if self.jwt_secret == PLACEHOLDER_JWT_SECRET:
            raise ValueError(
                "JWT_SECRET is still the development placeholder. Production "
                "refuses to sign tokens with a public key."
            )
        if len(self.jwt_secret) < MIN_JWT_SECRET_LENGTH:
            raise ValueError(
                f"JWT_SECRET must be at least {MIN_JWT_SECRET_LENGTH} characters."
            )
        if self.jwt_algorithm not in ALLOWED_JWT_ALGORITHMS:
            raise ValueError(
                "JWT_ALGORITHM must be one of "
                f"{sorted(ALLOWED_JWT_ALGORITHMS)}; got {self.jwt_algorithm!r}."
            )
        if self.access_token_expire_minutes <= 0:
            raise ValueError("ACCESS_TOKEN_EXPIRE_MINUTES must be positive.")
        if not self.jwt_issuer or not self.jwt_audience:
            raise ValueError("JWT_ISSUER and JWT_AUDIENCE must not be empty.")
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
