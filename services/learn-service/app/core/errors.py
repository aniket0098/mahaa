"""Error contract for the Learn service."""

from __future__ import annotations

from typing import Any

from fastapi import status


class ErrorCode:
    BAD_REQUEST = "bad_request"
    VALIDATION_ERROR = "validation_error"
    NOT_AUTHENTICATED = "not_authenticated"
    FORBIDDEN = "forbidden"
    NOT_FOUND = "not_found"
    CONFLICT = "conflict"
    UNPROCESSABLE = "unprocessable"
    SERVICE_UNAVAILABLE = "service_unavailable"
    INTERNAL_ERROR = "internal_error"


DEFAULT_MESSAGES = {
    status.HTTP_400_BAD_REQUEST: "The request could not be understood.",
    status.HTTP_401_UNAUTHORIZED: "Please sign in to continue.",
    status.HTTP_403_FORBIDDEN: "You do not have access to this.",
    status.HTTP_404_NOT_FOUND: "The requested resource was not found.",
    status.HTTP_409_CONFLICT: "That conflicts with something that already exists.",
    status.HTTP_422_UNPROCESSABLE_CONTENT: "Some of the details provided were not valid.",
    status.HTTP_429_TOO_MANY_REQUESTS: "Too many attempts. Please try again shortly.",
    status.HTTP_503_SERVICE_UNAVAILABLE: "The service is temporarily unavailable.",
}


def error_detail(field, message, type_=None):
    return {"field": field, "message": message, "type": type_}


def error_payload(*, code, message, details=None, request_id=None):
    return {"error": {"code": code, "message": message, "details": details, "request_id": request_id}}


def message_for(status_code, override=None):
    return override or DEFAULT_MESSAGES.get(status_code, "The request could not be completed.")


class TokenError(Exception):
    pass


class ApiError(Exception):
    def __init__(self, status_code, code, message=None, details=None):
        self.status_code = status_code
        self.code = code
        self.message = message or message_for(status_code)
        self.details = details
        super().__init__(self.message)


def register_exception_handlers(app) -> None:
    """Register consistent JSON error handlers on the FastAPI app.

    ``ApiError`` (raised by deps and endpoints) renders as an
    ``{"error": {...}}`` body with the matching status code. Pydantic
    validation errors render the same shape so clients have one error
    contract across the service.
    """
    from fastapi import Request, status
    from fastapi.exceptions import RequestValidationError
    from fastapi.responses import JSONResponse

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status_code,
            content=error_payload(code=exc.code, message=exc.message, details=exc.details),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content=error_payload(
                code=ErrorCode.VALIDATION_ERROR,
                message="Some of the details provided were not valid.",
                details=exc.errors(),
            ),
        )