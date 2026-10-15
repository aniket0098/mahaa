"""Configuration validation - fail-closed, and never silently insecure.

The service must refuse to boot on development-grade settings when it is told
it is in production, and must refuse to run at all when a required value is
missing or malformed. Each case builds a fresh ``Settings`` from a controlled
environment (no ``.env`` file, no shell) rather than importing the cached one,
so these tests assert the *rules*, not the developer's current shell.
"""

from __future__ import annotations

import pytest

from app.core.config import (
    ALLOWED_JWT_ALGORITHMS,
    MIN_JWT_SECRET_LENGTH,
    PLACEHOLDER_DATABASE_URL,
    PLACEHOLDER_JWT_SECRET,
    Settings,
)


@pytest.fixture(autouse=True)
def _hermetic_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """Remove every variable that could interfere for the duration of a test.

    The app also reads ``.env`` files; that is disabled per-case with
    ``_env_file=None`` in :func:`make`.
    """

    for name in (
        "APP_ENV",
        "DEBUG",
        "DATABASE_URL",
        "JWT_SECRET",
        "JWT_ALGORITHM",
        "JWT_ISSUER",
        "JWT_AUDIENCE",
        "CORS_ORIGINS",
        "LOG_LEVEL",
    ):
        monkeypatch.delenv(name, raising=False)


def _base_env() -> dict[str, str]:
    """A minimal, valid development environment to build each case on top of."""

    return {
        "APP_ENV": "development",
        "DEBUG": "true",
        "DATABASE_URL": "postgresql+psycopg://user:pass@localhost:5432/db",
        "JWT_SECRET": "a-perfectly-fine-dev-secret",
    }


def make(**overrides: str) -> Settings:
    """A Settings from the development base env plus overrides - no dotenv."""

    return Settings(_env_file=None, **{**_base_env(), **overrides})


def make_prod(**overrides: str) -> Settings:
    """A Settings from a valid production env plus overrides - no dotenv."""

    prod = {
        "APP_ENV": "production",
        "DEBUG": "false",
        "DATABASE_URL": "postgresql+psycopg://real:real@host:5432/db",
        "JWT_SECRET": "x" * MIN_JWT_SECRET_LENGTH,
    }
    return Settings(_env_file=None, **{**prod, **overrides})


def test_development_boots_on_the_placeholder_secret() -> None:
    settings = make(JWT_SECRET=PLACEHOLDER_JWT_SECRET)
    assert not settings.is_production
    assert settings.jwt_secret == PLACEHOLDER_JWT_SECRET


def test_max_body_bytes_has_a_safe_default() -> None:
    assert make().max_body_bytes > 0


def test_log_level_derives_from_debug_when_unset() -> None:
    assert make(DEBUG="true").log_level == "DEBUG"
    assert make(DEBUG="false").log_level == "INFO"


def test_log_level_env_override_wins() -> None:
    settings = make(DEBUG="true", LOG_LEVEL="WARNING")
    assert settings.log_level_override == "WARNING"
    assert settings.log_level == "WARNING"


@pytest.mark.parametrize("level", ["DEBUG", "info", " Warning ", "ERROR", "critical"])
def test_log_level_override_accepts_known_levels(level: str) -> None:
    assert make(LOG_LEVEL=level).log_level_override == level.strip().upper()


def test_log_level_override_rejects_unknown_level() -> None:
    with pytest.raises(ValueError):
        make(LOG_LEVEL="LOUD")


def test_log_level_empty_is_treated_as_unset() -> None:
    assert make(LOG_LEVEL="").log_level_override is None


def test_empty_database_url_is_refused() -> None:
    with pytest.raises(ValueError):
        make(DATABASE_URL="   ")


def test_non_postgres_database_url_is_refused() -> None:
    with pytest.raises(ValueError):
        make(DATABASE_URL="mysql://user:pass@host/db")


def test_plain_postgres_scheme_is_upgraded_to_psycopg() -> None:
    settings = make(DATABASE_URL="postgresql://user:pass@host/db")
    assert settings.database_url.startswith("postgresql+psycopg://")


def test_production_boots_on_real_settings() -> None:
    assert make_prod().is_production


def test_production_refuses_the_placeholder_database_url() -> None:
    with pytest.raises(ValueError):
        make_prod(DATABASE_URL=PLACEHOLDER_DATABASE_URL)


def test_production_refuses_debug_true() -> None:
    with pytest.raises(ValueError):
        make_prod(DEBUG="true")


def test_production_refuses_a_wildcard_cors_origin() -> None:
    with pytest.raises(ValueError):
        make_prod(CORS_ORIGINS="*")


def test_production_refuses_the_placeholder_jwt_secret() -> None:
    with pytest.raises(ValueError):
        make_prod(JWT_SECRET=PLACEHOLDER_JWT_SECRET)


def test_production_refuses_a_short_jwt_secret() -> None:
    with pytest.raises(ValueError):
        make_prod(JWT_SECRET="short")


def test_production_refuses_an_unknown_jwt_algorithm() -> None:
    bad_alg = next(a for a in ("none", "RS256", "ES256") if a not in ALLOWED_JWT_ALGORITHMS)
    with pytest.raises(ValueError):
        make_prod(JWT_ALGORITHM=bad_alg)


def test_production_refuses_empty_issuer_or_audience() -> None:
    with pytest.raises(ValueError):
        make_prod(JWT_ISSUER="")
    with pytest.raises(ValueError):
        make_prod(JWT_AUDIENCE="")


def test_cors_origin_list_splits_and_trims() -> None:
    settings = make(CORS_ORIGINS="https://a.example, https://b.example ,")
    assert settings.cors_origin_list == ["https://a.example", "https://b.example"]


# --- startup failure is safe (no stack trace, no secret echo) ---------------


def test_get_settings_failure_is_a_single_safe_line_not_a_traceback(
    monkeypatch, capsys
) -> None:
    """A bad config must fail closed with a clean, structured, non-zero exit —
    never a Python stack trace, and never the offending value echoed back."""

    import app.core.config as cfg

    # Clear the cache and point the environment at an invalid production config.
    cfg.get_settings.cache_clear()
    monkeypatch.setenv("APP_ENV", "production")
    monkeypatch.setenv("DEBUG", "false")
    monkeypatch.setenv(
        "DATABASE_URL", "postgresql+psycopg://real:real@host:5432/db"
    )
    monkeypatch.setenv("JWT_SECRET", PLACEHOLDER_JWT_SECRET)

    try:
        with pytest.raises(SystemExit) as exit_info:
            cfg.get_settings()

        # Non-zero, so an orchestrator treats the container as failed.
        assert exit_info.value.code == 1

        captured = capsys.readouterr()
        combined = captured.err + captured.out
        # A single JSON line — no traceback frames.
        assert "Traceback" not in combined
        assert "File \"" not in combined
        # The secret itself is never echoed; only the env var it belongs to
        # (named inside the reason) and the generic refusal line.
        assert PLACEHOLDER_JWT_SECRET not in combined
        assert "JWT_SECRET" in combined
        assert "refusing to start" in combined.lower()
    finally:
        cfg.get_settings.cache_clear()