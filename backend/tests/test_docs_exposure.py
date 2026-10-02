"""Documentation routes are a development affordance, not a production surface.

``/docs``, ``/redoc`` and ``/openapi.json`` are three of the only unauthenticated
routes the service serves, and ``/openapi.json`` returns a complete map of the API
— every route, parameter and model. That is a useful thing to publish to your own
team and an unnecessary one to publish to the internet, so production removes all
three entirely.

**"Removed" means the route is never registered**, not that it is registered and
rejected. FastAPI's ``None`` omits it, which is why the production answer is a
plain 404 with the project's standard error envelope rather than a 403: there is
no handler to authorize, because there is no handler.

These tests swap ``app_env`` on the cached ``Settings`` object and restore it
afterwards, the same approach ``test_realtime.py`` uses for ``redis_url`` — the
environment cannot be used because ``get_settings`` is ``lru_cache``d. No network
call is made; the app is exercised through ``TestClient``.
"""

from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi.testclient import TestClient

#: The three routes whose exposure this module governs.
DOC_ROUTES = ("/docs", "/redoc", "/openapi.json")


@pytest.fixture()
def app_env() -> Iterator[callable]:
    """Set ``app_env`` for the duration of one test, then restore it."""

    from app.core.config import get_settings

    settings = get_settings()
    previous = settings.app_env
    yield lambda value: setattr(settings, "app_env", value)
    settings.app_env = previous


def _client() -> TestClient:
    from app.main import create_app

    return TestClient(create_app())


def test_production_serves_none_of_the_documentation_routes(app_env) -> None:
    app_env("production")
    client = _client()
    for route in DOC_ROUTES:
        response = client.get(route)
        assert response.status_code == 404, f"{route} was reachable in production"


def test_production_removes_the_schema_from_the_route_table(app_env) -> None:
    """Not merely forbidden — absent.

    Asserting the status code alone would still pass if a route existed and
    answered 403, which would leave the schema one authorization mistake away from
    being served.
    """

    app_env("production")
    paths = _client().app.openapi_url
    assert paths is None


@pytest.mark.parametrize("route", DOC_ROUTES)
def test_development_keeps_each_documentation_route(app_env, route: str) -> None:
    app_env("development")
    response = _client().get(route)
    assert response.status_code == 200, f"{route} was removed outside production"


def test_development_still_generates_a_usable_openapi_schema(app_env) -> None:
    """The guard must not break the contract tooling that reads the schema.

    ``tools/check_openapi.py`` depends on this, so a change that disabled the
    schema everywhere would pass the production tests and quietly break the
    repository's own verification.
    """

    app_env("development")
    document = _client().get("/openapi.json").json()
    assert document["openapi"].startswith("3.")
    assert document["info"]["title"]
    assert "/api/v1/notifications/devices" in document["paths"]


def test_production_cannot_be_enumerated_over_http(app_env) -> None:
    """The reason this matters most right now: the push routes must not be discoverable.

    Worth being precise about what the guard does and does not do. Setting
    ``openapi_url=None`` removes the *route*, so nothing serves the schema to a
    client — but ``app.openapi()`` still generates one in-process, because that is
    how FastAPI builds request validation and how the repository's own
    ``tools/check_openapi.py`` reads the contract. That is not exposure: nothing
    is reachable over the network. What this asserts is the only property that
    matters to a caller, which is that the document cannot be *fetched*.
    """

    app_env("production")
    client = _client()
    assert client.get("/openapi.json").status_code == 404
    for route in DOC_ROUTES:
        assert client.get(route).status_code == 404
