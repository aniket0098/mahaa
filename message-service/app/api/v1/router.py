"""The v1 API router — health first, then the message-request domain.

Two routers, and that is the whole surface: this service owns one domain. The
realtime WebSocket route does not exist here (REST only, exactly as the main
backend's §7.2 decision), so there is no second transport to mount last.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints import health, message_requests

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(message_requests.router)
