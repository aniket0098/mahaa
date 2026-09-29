"""Liveness and readiness.

The distinction is deliberate and the mobile app depends on it:

* ``GET /health`` answers **"is the process running"** and touches nothing
  external. A liveness probe that queries the database restarts a healthy
  application because its database had a bad minute.
* ``GET /ready`` answers **"can this instance serve a request"** and does check
  the database. A readiness failure takes the instance out of rotation without
  killing it.

Both are unauthenticated: a monitor cannot hold a bearer token, and neither
response contains anything but status strings.
"""

from __future__ import annotations

from fastapi import APIRouter, Response, status
from pydantic import BaseModel

from app.core.config import get_settings
from app.core.logging import get_logger
from app.db.session import ping_database

router = APIRouter(tags=["system"])
logger = get_logger("mahaa.health")


class HealthResponse(BaseModel):
    """``GET /health`` — process liveness, no external dependency."""

    status: str
    app: str
    version: str
    environment: str


class ReadinessResponse(BaseModel):
    """``GET /ready`` — dependency health."""

    status: str
    checks: dict[str, str]


@router.get("/health", response_model=HealthResponse, summary="Liveness probe")
def health() -> HealthResponse:
    settings = get_settings()
    return HealthResponse(
        status="ok",
        app=settings.app_name,
        version=settings.app_version,
        environment=settings.app_env,
    )


@router.get(
    "/ready",
    response_model=ReadinessResponse,
    summary="Readiness probe (checks the database)",
)
def ready(response: Response) -> ReadinessResponse:
    ok, reason = ping_database()
    if not ok:
        # Logged with the real reason, returned as a class name only: the
        # response is public, and a driver message can name internal hosts.
        logger.error("readiness check failed", extra={"reason": reason})
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return ReadinessResponse(
            status="not_ready", checks={"database": reason or "unavailable"}
        )
    return ReadinessResponse(status="ready", checks={"database": "ok"})
