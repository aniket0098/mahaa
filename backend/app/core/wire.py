"""One datetime rendering for every place a datetime leaves this process.

REST responses serialise ``datetime`` fields through Pydantic, which renders a
zero-offset instant as ``2026-10-05T16:17:38.899195Z``. Python's own
``datetime.isoformat()`` renders the very same instant as
``2026-10-05T16:17:38.899195+00:00``. Both are legal ISO 8601 and both parse to
the same instant, but they are *not the same string* — and a realtime payload
for a row must be the same string as the REST body for that row, because a
client correlating the two (or a test asserting they agree) has no way to know
which rendering a given field was given.

Which rendering a field got used to depend on how its schema declared it:
``created_at: datetime`` went through Pydantic (``Z``), while a ``str`` field
fed with ``.isoformat()`` kept ``+00:00``. For a ``timestamptz`` column there
was a third variable — the database session's timezone — so a session in
``Asia/Kolkata`` produced ``+05:30`` from *both* renderings and hid the
difference until a UTC session (Docker, Neon) exposed it.

:func:`wire_datetime` calls the same pydantic-core serializer the REST layer
calls, so an event payload and the response body for one column are equal by
construction rather than by convention — in any session timezone.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import TypeAdapter

#: The serializer FastAPI uses to render a ``datetime`` field for JSON.
_DATETIME = TypeAdapter(datetime)


def wire_datetime(value: datetime) -> str:
    """Render ``value`` exactly as a REST response renders a datetime field.

    Offset-preserving: an instant read from the database in ``+05:30`` stays
    ``+05:30`` here exactly as it does in the response body. Only the *same*
    serializer can guarantee that, which is why this is not
    ``value.isoformat()`` with a ``.replace("+00:00", "Z")`` at the end.
    """
    rendered: str = _DATETIME.dump_python(value, mode="json")
    return rendered
