"""Liveness probe endpoint for the Learn service.

``GET /api/v1/health`` reports that the service process is alive. It never
touches PostgreSQL, so a transient database outage is not reported as a dead
application process — that is what ``/api/v1/ready`` is for.
"""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health", summary="Liveness probe", include_in_schema=False)
def health() -> dict[str, str]:
    """``GET /health`` — service is running (never touches the database)."""
    return {"status": "ok"}
