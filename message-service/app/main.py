"""Mahaa Message service application.

A small, deliberate copy of the main backend's ``create_app`` skeleton:
same error envelope, same validation shape, same request-id correlation, so a
failure from either service parses identically on the phone. Nothing imports
from ``backend/`` — the two ship in separate Docker build contexts — but
nothing *diverges* either: if the envelope ever changes, it changes in both
files or in neither.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.errors import (
    ApiError,
    ErrorCode,
    error_detail,
    error_payload,
    message_for,
)
from app.core.logging import configure_logging, get_logger

settings = get_settings()
configure_logging(settings.log_level)
logger = get_logger("mahaa.message.app")

#: Header a proxy or client may supply to correlate a call across services.
REQUEST_ID_HEADER = "x-request-id"


async def reject_oversized_body(request: Request, call_next):  # noqa: ANN001, ANN202
    # Refuse a body larger than the limit before it is read into memory.
    # Content-Length is client-supplied, so this is a cheap early bound, not
    # a guarantee; the note length is enforced again at validation. Only
    # requests that carry a body can trip it, so health and readiness are
    # untouched. 413 keeps an oversized-but-well-formed payload distinct
    # from a malformed one (422).
    if request.method in {"POST", "PUT", "PATCH"}:
        raw = request.headers.get("content-length")
        try:
            declared = int(raw) if raw is not None else 0
        except ValueError:
            declared = -1
        if declared < 0 or declared > settings.max_body_bytes:
            request_id = request.headers.get(REQUEST_ID_HEADER)
            return JSONResponse(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                content=error_payload(
                    code=ErrorCode.VALIDATION_ERROR,
                    message="The request body is too large.",
                    request_id=request_id,
                ),
            )
    return await call_next(request)


async def add_request_id(request: Request, call_next):  # noqa: ANN001, ANN202
    request_id = request.headers.get(REQUEST_ID_HEADER) or uuid.uuid4().hex
    started = time.perf_counter()
    response = await call_next(request)
    response.headers["X-Request-Id"] = request_id
    # No path, no query, no body, no token: only what an operator needs to
    # correlate a line with a response.
    logger.info(
        "request",
        extra={
            "request_id": request_id,
            "method": request.method,
            "status": response.status_code,
            "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        },
    )
    return response


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Log startup and shutdown.

    No background tasks: Redis is not used here and nothing holds a resource
    the process must close cleanly.
    """

    logger.info(
        "startup",
        extra={
            "app": settings.app_name,
            "version": settings.app_version,
            "environment": settings.app_env,
        },
    )
    try:
        yield
    finally:
        logger.info("shutdown")


def create_app() -> FastAPI:
    """Build the application. A factory so tests can build their own."""

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=_lifespan,
        docs_url="/docs",
        redoc_url=None,
    )

    if settings.cors_origin_list:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origin_list,
            allow_credentials=False,
            allow_methods=["GET", "POST"],
            allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
        )

    # Registration order is reverse-call order: Starlette wraps each new
    # middleware around the previous ones, so `add_request_id` (added last) runs
    # first — it must, so the size guard below can stamp the id it reports on a
    # 413 and the access log records it. Both bodies live at module level
    # (`reject_oversized_body`, `add_request_id`) so `create_app` stays small.
    app.middleware("http")(reject_oversized_body)
    app.middleware("http")(add_request_id)

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(
                code=exc.code,
                message=exc.message,
                details=exc.details,
                request_id=request.headers.get(REQUEST_ID_HEADER),
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        details = [
            error_detail(
                field=".".join(str(part) for part in err.get("loc", ())),
                message=err.get("msg", "Invalid value."),
                type_=err.get("type"),
            )
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=error_payload(
                code=ErrorCode.VALIDATION_ERROR,
                message=message_for(422),
                details=details,
                request_id=request.headers.get(REQUEST_ID_HEADER),
            ),
        )

    # Starlette's class, not FastAPI's: an unmatched route raises Starlette's
    # HTTPException and FastAPI's is a subclass of it, so one registration
    # covers both (the main backend's comment, copied for the same reason).
    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(
                code=ErrorCode.NOT_FOUND
                if exc.status_code == 404
                else ErrorCode.BAD_REQUEST,
                message=message_for(exc.status_code, exc.detail),
                request_id=request.headers.get(REQUEST_ID_HEADER),
            ),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Log the real exception, return a generic sentence. An unhandled error
        # must never put a stack trace, a SQL fragment or a DSN in front of a
        # caller — the readiness probe exists precisely so a database outage is
        # visible without being *served*.
        logger.exception(
            "unhandled error",
            extra={
                "request_id": request.headers.get(REQUEST_ID_HEADER),
                "path": request.url.path,
            },
        )
        return JSONResponse(
            status_code=500,
            content=error_payload(
                code=ErrorCode.INTERNAL_ERROR,
                message="Something went wrong on our side.",
                request_id=request.headers.get(REQUEST_ID_HEADER),
            ),
        )

    app.include_router(api_router, prefix=settings.api_prefix)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        """A bare host is a misconfigured base URL; say so instead of 404."""

        return {"app": settings.app_name, "docs": "/docs", "api": settings.api_prefix}

    return app


app = create_app()
