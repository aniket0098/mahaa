"""FastAPI application factory for the Learn microservice."""

from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings
from app.core.errors import register_exception_handlers
from app.core.logging import configure_logging, get_logger

logger = get_logger(__name__)


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""

    settings = get_settings()

    # Configure JSON logging first
    configure_logging(settings.log_level)

    logger.info(
        "starting learn service",
        extra={
            "app_name": settings.app_name,
            "app_env": settings.app_env,
            "port": settings.port,
        },
    )

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        description="Independent Learn microservice for MAHAJOB",
        debug=settings.debug,
    )

    # CORS — only add if origins are configured or in dev
    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )
    else:
        logger.warning("No CORS origins configured")

    # Register exception handlers ( ApiError, validation, etc. )
    register_exception_handlers(app)

    # Include the v1 API router under /api/v1
    from app.api.v1.router import api_router

    app.include_router(api_router, prefix=get_settings().api_prefix)

    @app.get("/api/v1/ready", include_in_schema=False)
    async def readiness_check():
        """Readiness probe: check database connectivity."""
        from app.db.session import ping_database
        from fastapi.responses import JSONResponse

        ok, err = ping_database()
        if ok:
            return {"status": "ready"}
        logger.error("readiness check failed: %s", err)
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "error": err or "unknown"},
        )

    @app.get("/openapi.json", include_in_schema=False)
    async def openapi():
        return app.openapi()

    return app