"""A small fixed-window rate limiter for the credential endpoints.

**Scope and honesty first.** There was no rate-limiting architecture in the
backend before this phase, and this is not a substitute for one. The V1 spec
records the gap as a production-readiness blocker: a limiter held in process
memory resets on every redeploy and is per-instance, so on Render Free — which
spins down and may run more than one instance — it is a speed bump, not a
guarantee. A shared store (Redis, or the database) is the real fix and is not
part of Phase 2. What this does buy is that the *obvious* attack — a script
hammering one endpoint — is slowed, and the failure mode when it is wrong is
"limiter forgot a counter", never "auth broke".

Client identity is the **connection's** peer address, not a header. Behind a
proxy every request would otherwise share the proxy's address and one busy
office could lock out everyone, while trusting ``X-Forwarded-For`` without a
trusted-proxy configuration lets a caller spoof the key and bypass the limiter
entirely. `app.core.config.allowed_proxy_networks` already exists for parsing a
trusted-proxy list; wiring it up is deferred with the rest of the blocker, and
the consequence is recorded here rather than silently redesigned.
"""

from __future__ import annotations

import threading
import time
from collections import defaultdict, deque
from dataclasses import dataclass, field

from app.core.config import Settings, get_settings
from app.core.errors import ApiError, ErrorCode


@dataclass
class _Window:
    """Timestamps of the requests seen in the current window."""

    hits: deque[float] = field(default_factory=deque)


class FixedWindowLimiter:
    """Counts requests per key in a sliding window.

    Sliding rather than fixed: a fixed window lets a caller send the full quota
    at the end of one window and again at the start of the next, doubling the
    effective rate. A sliding window of individual timestamps has no such seam.
    """

    def __init__(self) -> None:
        self._windows: dict[str, _Window] = defaultdict(_Window)
        self._lock = threading.Lock()

    def check(self, key: str, limit: int, window_seconds: int) -> tuple[bool, int]:
        """Record a hit for ``key``.

        Returns ``(allowed, retry_after_seconds)``. ``retry_after_seconds`` is
        the wait until the oldest hit in the window ages out, which is when a
        slot actually frees up.
        """

        now = time.monotonic()
        cutoff = now - window_seconds
        with self._lock:
            hits = self._windows[key].hits
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if len(hits) >= limit:
                return False, max(1, int(hits[0] + window_seconds - now))
            hits.append(now)
            return True, 0

    def reset(self) -> None:
        """Clear all counters. Used by the test suite, never in a request."""

        with self._lock:
            self._windows.clear()


#: One process-wide limiter. Keyed per-client-IP, so its counters never cross
#: accounts; a per-account limit would need a second key and is not added until
#: there is a shared store to hold it honestly.
auth_limiter = FixedWindowLimiter()


def client_key(client_host: str | None) -> str:
    return client_host or "unknown"


def enforce_auth_rate_limit(
    client_host: str | None, settings: Settings | None = None
) -> None:
    """Raise a 429 when this caller has used up its auth allowance.

    No-op when disabled, which is how the test suite runs fast without locking
    itself out. The limiter is never *disabled by default*.
    """

    settings = settings or get_settings()
    if not settings.auth_rate_limit_enabled or settings.auth_rate_limit_per_window <= 0:
        return

    allowed, retry_after = auth_limiter.check(
        client_key(client_host),
        limit=settings.auth_rate_limit_per_window,
        window_seconds=settings.auth_rate_limit_window_seconds,
    )
    if not allowed:
        raise ApiError(
            status_code=429,
            code=ErrorCode.RATE_LIMITED,
            message=("Too many attempts. Please wait a moment and try again."),
        )
