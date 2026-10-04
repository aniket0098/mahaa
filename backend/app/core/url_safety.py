"""URL safety for user-supplied links — ``http``/``https`` or nothing.

A project post's ``source_url``/``live_url`` are rendered as clickable links, so
what arrives is not a string but an instruction to a browser: a
``javascript:`` value would execute when a reader clicked it, and a ``data:``
value would carry its own document. The client checks the scheme before
submitting, but a client check is a convenience, not a boundary — the same
reason the media service sniffs bytes instead of trusting ``Content-Type``.

**This is safety validation, not verification.** A URL that passes here is
well-formed and uses a safe scheme. Nothing proves the repository exists, and
nothing proves the person owns it. ``https://github.com/someone/else`` is a
perfectly valid ``source_url`` and stays one: the client must label such a link
"GitHub", never "Verified GitHub", and this module deliberately offers no
ownership check to fake one with.

The rule lives here rather than in a schema so the post payload and the profile
project share one definition. Two copies of "which schemes are allowed" is how a
profile project ends up storing a ``javascript:`` link while every post rejects
it.
"""

from __future__ import annotations

from urllib.parse import urlsplit

#: The only two schemes a rendered link may carry. Anything else — ``javascript``,
#: ``data``, ``file``, ``ftp``, ``mailto`` — is refused rather than sanitised,
#: because there is no safe rendering of any of them here.
SAFE_URL_SCHEMES = frozenset({"http", "https"})

#: The message, so the post payload and the profile project report identically.
UNSAFE_URL_MESSAGE = "Use an http:// or https:// link."


def validate_public_url(value: str | None) -> str | None:
    """Return the trimmed URL, or ``None`` when it was not provided.

    Raises :class:`ValueError` for anything a link should not carry, which
    Pydantic turns into a 422 naming the field.

    An absent or blank value is "not provided", not "invalid" — the columns are
    nullable and clearing one is a legitimate edit, so it must not be rejected.
    """
    if value is None:
        return None

    trimmed = value.strip()
    if not trimmed:
        return None

    parsed = urlsplit(trimmed)
    # `urlsplit` lower-cases the scheme, so `HTTPS://` is handled without a second
    # comparison. `netloc` is checked too: `https:/example.com` parses with the
    # right scheme and no host, and would render as a link to nothing.
    if parsed.scheme.lower() not in SAFE_URL_SCHEMES or not parsed.netloc:
        raise ValueError(UNSAFE_URL_MESSAGE)

    return trimmed
