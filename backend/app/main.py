"""Mahaa API application.

This phase ships the service skeleton only: liveness, readiness, configuration,
database wiring and the error envelope. Authentication and business endpoints
are deliberately absent rather than stubbed - a half-built auth flow that returns
200 is worse than a route that does not exist.
"""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from contextvars import ContextVar

from fastapi import FastAPI, Request
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
from app.realtime.runtime import build_runtime, set_runtime

settings = get_settings()
configure_logging(settings.log_level)
logger = get_logger("mahaa.app")

#: Correlation id for the current request. A ContextVar rather than a function
#: argument, so a service-layer log line can carry it without every signature
#: growing a request_id parameter.
request_id_var: ContextVar[str] = ContextVar("request_id", default="-")


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Start and stop the realtime runtime around the application.

    Wiring it here rather than at import time means the hub exists for the whole
    life of the process and is closed deterministically on shutdown, instead of
    surviving a reload as a stale module global.

    A realtime failure must not stop the HTTP service from serving: the runtime
    is built and started inside a ``try`` that logs and continues. Losing realtime
    degrades the product; refusing to boot loses all of it.
    """
    runtime = None
    try:
        runtime = build_runtime()
        set_runtime(runtime)
        await runtime.start()
    except Exception as exc:  # noqa: BLE001 - never block startup on realtime
        logger.error(
            "realtime runtime failed to start",
            extra={"reason": type(exc).__name__},
        )
        set_runtime(None)
        runtime = None
    try:
        yield
    finally:
        if runtime is not None:
            try:
                await runtime.stop()
            except Exception as exc:  # noqa: BLE001 - shutdown is best-effort
                logger.error(
                    "realtime runtime failed to stop",
                    extra={"reason": type(exc).__name__},
                )
        set_runtime(None)


def create_app() -> FastAPI:
    """Build the application.

    A factory rather than a module-level instance, so tests can build an app with
    different settings and never share state with the running service.
    """
    # Interactive documentation and the raw schema are development affordances.
    # In production they are removed entirely (``None`` tells FastAPI not to
    # register the route at all, which is what produces the 404) because the
    # schema is a complete map of the API surface: every route, parameter and
    # model, handed to anyone who asks. Nothing here is a secret, but the
    # reconnaissance value is real and the docs are not needed to run the
    # service. Local development keeps them.
    expose_docs = not settings.is_production

    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        docs_url="/docs" if expose_docs else None,
        redoc_url="/redoc" if expose_docs else None,
        openapi_url="/openapi.json" if expose_docs else None,
        lifespan=_lifespan,
    )

    origins = settings.cors_origin_list
    if origins:
        # allow_credentials stays off: the API is bearer-token authenticated and
        # sends no cookies, so cookie CORS would widen the surface for nothing.
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_credentials=False,
            allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
            allow_headers=["Authorization", "Content-Type", "Accept"],
            expose_headers=["X-Request-ID"],
        )

    @app.middleware("http")
    async def request_context(
        request: Request, call_next: Callable[[Request], Awaitable]
    ) -> JSONResponse:
        """Attach a correlation id and log one line per request.

        An inbound X-Request-ID is honoured so a trace started upstream keeps one
        id end to end; otherwise a fresh one is minted.
        """
        incoming = request.headers.get("X-Request-ID")
        request_id = incoming if incoming else uuid.uuid4().hex[:12]
        token = request_id_var.set(request_id)
        started = time.perf_counter()
        try:
            response = await call_next(request)
        finally:
            request_id_var.reset(token)
        elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
        response.headers["X-Request-ID"] = request_id
        logger.info(
            "request",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": response.status_code,
                "duration_ms": elapsed_ms,
            },
        )
        return response

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(
                code=exc.code,
                message=exc.message,
                details=exc.details,
                request_id=request_id_var.get(),
            ),
        )

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        # The field keeps the framework's body./query. prefix: that is the
        # location the client maps back onto an input, and the app already strips
        # the prefix rather than guessing.
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
                request_id=request_id_var.get(),
            ),
        )

    # Registered against Starlette's class, not FastAPI's: an unmatched route
    # raises Starlette's HTTPException, and FastAPI's is a SUBCLASS of it. The
    # handler lookup walks the MRO, so this one registration covers both, while
    # importing `fastapi.HTTPException` here would silently miss every 404.
    @app.exception_handler(HTTPException)
    async def handle_http_error(request: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(
                code=ErrorCode.NOT_FOUND
                if exc.status_code == 404
                else ErrorCode.BAD_REQUEST,
                message=message_for(exc.status_code, exc.detail),
                request_id=request_id_var.get(),
            ),
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def handle_unexpected(request: Request, exc: Exception) -> JSONResponse:
        # Log the real exception, return a generic sentence. An unhandled error
        # must never put a stack trace, a SQL fragment or a DSN in front of a
        # caller.
        logger.exception(
            "unhandled error",
            extra={"request_id": request_id_var.get(), "path": request.url.path},
        )
        return JSONResponse(
            status_code=500,
            content=error_payload(
                code=ErrorCode.INTERNAL_ERROR,
                message="Something went wrong on our side.",
                request_id=request_id_var.get(),
            ),
        )

    app.include_router(api_router, prefix=settings.api_prefix)

    @app.get("/", include_in_schema=False)
    def root() -> dict[str, str]:
        """A bare host is a misconfigured base URL; say so instead of 404."""
        return {"app": settings.app_name, "docs": "/docs", "api": settings.api_prefix}

    logger.info(
        "startup",
        extra={
            "app": settings.app_name,
            "version": settings.app_version,
            "environment": settings.app_env,
        },
    )
    return app


app = create_app()
