"""Structured logging.

Log lines are JSON, one object per line. That is not a style preference: a
platform that collects stdout wants one parseable record per line, and a human
reading a development log wants the timestamp, level and message in the same
place either way.

The formatter never logs the settings object, a URL, or a request body. Only
explicitly named fields are written.
"""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone

#: Attributes LogRecord adds to every record; anything else was passed by the
#: caller through ``extra=`` and belongs in the JSON payload.
_RESERVED = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "thread",
        "threadName",
        "taskName",
    }
)


#: Where the realtime socket lives, relative to the API prefix. The full path is
#: assembled at install time so a changed ``api_prefix`` cannot desynchronise it.
REALTIME_ROUTE = "/ws"


class RealtimeTokenRedactor(logging.Filter):
    """Drop the query string from uvicorn's access line for the realtime socket.

    **Why this exists.** A browser ``WebSocket`` cannot set an ``Authorization``
    header, so the access token rides in ``/api/v1/ws?token=<JWT>``. The
    application's own logging never sees that string — ``ws.py`` logs only a
    random support id — but uvicorn's *access* logger prints the full request
    line, so every socket connection wrote a live bearer token to disk and to
    whatever collects stdout. A token that lands in a log file is a credential
    with an expiry date rather than a secret, which is still a credential.

    **Why a filter rather than a different transport.** Moving the token to a
    subprotocol or cookie would also work, but it changes the wire contract that
    the Expo/React Native client, the browser client, and the existing tests all
    speak. Redacting at the single point where the leak happens is the smaller
    change and cannot break a client.

    **Scope.** Only records whose path is the realtime endpoint are touched, and
    only the query string is removed — the route line, client address, and status
    still get logged, so ordinary HTTP access logging and any WebSocket
    diagnostics are unaffected. The endpoint accepts no query parameter other
    than the token, so nothing diagnostic is lost.
    """

    def __init__(self, path_prefix: str) -> None:
        super().__init__()
        self.path_prefix = path_prefix.rstrip("/") + REALTIME_ROUTE

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not isinstance(args, tuple):
            return True

        # uvicorn logs the access line in two different shapes, and getting this
        # wrong is how the first version of this filter failed to redact anything:
        #
        #   HTTP      '%s - "%s %s HTTP/%s" %d'  → (addr, method, path, ver, status)
        #   WebSocket '%s - "WebSocket %s" [accepted]' → (addr, path)
        #
        # The path therefore sits at index 2 for HTTP and index 1 for the socket, so
        # this scans for it rather than assuming a position. Anything that is a
        # string equal to the socket route (ignoring its query string) is rewritten.
        rewritten: list[object] = []
        changed = False
        for value in args:
            if isinstance(value, str) and "?" in value:
                base = value.split("?", 1)[0]
                # Exact path match, not `startswith`: a prefix test would also
                # rewrite a different endpoint that merely begins the same way
                # (`/api/v1/wsproxy`).
                if base == self.path_prefix or base == self.path_prefix + "/":
                    value = base
                    changed = True
            rewritten.append(value)
        if changed:
            record.args = tuple(rewritten)
        return True


def install_access_log_redactor(path_prefix: str) -> None:
    """Attach {@link RealtimeTokenRedactor} to uvicorn's access logger, once.

    Called during application startup rather than at import: uvicorn applies its
    own logging configuration (``dictConfig``) when the server loads, and that
    **resets the filters on a logger**. A filter installed at import time would be
    silently discarded, and the leak would persist while appearing to be fixed.

    Idempotent, so a reload does not stack duplicates.
    """

    # **Both** loggers, and this is the part that is easy to get wrong. uvicorn's
    # HTTP protocol logs its access line to ``uvicorn.access``; the WebSocket
    # protocol builds its protocol object with ``logger=logging.getLogger(
    # "uvicorn.error")`` and emits `'%s - "WebSocket %s" [accepted]'`` there. A
    # filter attached only to ``uvicorn.access`` therefore leaves the one line that
    # actually carries the token completely untouched, while looking correct in a
    # unit test. The two loggers share handlers, not records.
    for name in ("uvicorn.access", "uvicorn.error"):
        logger = logging.getLogger(name)
        if not any(
            isinstance(existing, RealtimeTokenRedactor) for existing in logger.filters
        ):
            logger.addFilter(RealtimeTokenRedactor(path_prefix))


class JsonFormatter(logging.Formatter):
    """Render a record as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "timestamp": datetime.fromtimestamp(
                record.created, tz=timezone.utc
            ).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            # The traceback is the exception text, kept whole so it survives
            # log shipping as one field.
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


def configure_logging(level: str = "INFO") -> None:
    """Install the JSON handler on the root logger.

    Idempotent: calling it twice does not double every line.
    """
    root = logging.getLogger()
    root.setLevel(level.upper())
    for handler in list(root.handlers):
        if getattr(handler, "_mahaa_json", False):
            return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler._mahaa_json = True  # type: ignore[attr-defined]
    root.addHandler(handler)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
