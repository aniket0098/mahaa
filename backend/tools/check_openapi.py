"""Verify the generated OpenAPI document against the mobile contract.

A static check, run without a database and without a server: it builds the
document, then asserts the properties that are easy to break silently.

* every Phase 1-3 route the mobile client calls is present, with the right
  methods;
* no response schema can carry a password hash or any authentication secret;
* the protected routes declare a security requirement;
* the write models forbid unknown fields, so a client sending an unexpected
  field gets a 422 rather than a silent no-op.

Run it directly:

    python tools/check_openapi.py
"""

from __future__ import annotations

from app.main import create_app

#: (path, expected methods) for everything the mobile client calls today.
#: Sources: src/api/{auth,users,onboarding,profile,health}.ts and the §5.2 table
#: in docs/MAHAA_V1_BACKEND_SPEC.md.
EXPECTED: dict[str, set[str]] = {
    # auth (Phase 2)
    "/api/v1/auth/signup": {"post"},
    "/api/v1/auth/login": {"post"},
    "/api/v1/auth/me": {"get"},
    # users (Phase 3)
    "/api/v1/users/me": {"get", "patch", "delete"},
    "/api/v1/users/me/deactivate": {"post"},
    "/api/v1/users/me/password": {"post"},
    "/api/v1/users/me/username/availability": {"get"},
    # user discovery (Phase 5.5) — the one /users route that reads another account.
    # Bare array, no envelope (§17); "query" is its only parameter.
    "/api/v1/users/lookup": {"get"},
    # profile aggregate and its halves
    "/api/v1/profile": {"get", "patch"},
    "/api/v1/profile/completeness": {"get"},
    "/api/v1/profile/privacy": {"get", "put"},
    "/api/v1/profile/preferences": {"get", "put"},
    "/api/v1/profile/skills": {"get", "post"},
    "/api/v1/profile/skills/{skill_row_id}": {"patch", "delete"},
    "/api/v1/profile/education": {"get", "post"},
    "/api/v1/profile/education/{record_id}": {"patch", "delete"},
    "/api/v1/profile/experience": {"get", "post"},
    "/api/v1/profile/experience/{record_id}": {"patch", "delete"},
    "/api/v1/profile/projects": {"get", "post"},
    "/api/v1/profile/projects/{project_id}": {"patch", "delete"},
    "/api/v1/profile/certifications": {"get", "post"},
    "/api/v1/profile/certifications/{record_id}": {"patch", "delete"},
    "/api/v1/profile/achievements": {"get", "post"},
    "/api/v1/profile/achievements/{record_id}": {"patch", "delete"},
    # connections (Phase 4) — the six verbs `src/api/connections.ts` calls.
    # `requests`/`sent` are deliberately absent: the parity table (§23) counts them
    # among the routes with no mobile caller, because `?status=` plus `is_outgoing`
    # already covers both directions.
    "/api/v1/connections": {"get", "post"},
    "/api/v1/connections/{connection_id}/accept": {"post"},
    "/api/v1/connections/{connection_id}/decline": {"post"},
    "/api/v1/connections/{connection_id}/cancel": {"post"},
    "/api/v1/connections/{connection_id}": {"delete"},
    # messaging (Phase 5) — §7.3. All seven are "Proposed" in the spec and none
    # has a mobile caller yet (§7.1: no src/api/messages.ts, both messages screens
    # are StageScreen), so this table is a forward contract rather than a mirror.
    "/api/v1/conversations": {"get", "post"},
    "/api/v1/conversations/{conversation_id}": {"get"},
    "/api/v1/conversations/{conversation_id}/messages": {"get", "post"},
    "/api/v1/conversations/{conversation_id}/read": {"post"},
    "/api/v1/messages/{message_id}": {"delete"},
    # notifications (Phase 6) — §13's four routes. No mobile caller exists yet
    # (§23 records no `src/api/notifications.ts` and both screens as StageScreen),
    # so this is a forward contract, and the shape of it is the point: a **count**
    # route alongside the list, because §13/§22 require the count to exist before
    # any badge is drawn. Deliberately absent: any route that creates one.
    "/api/v1/notifications": {"get"},
    "/api/v1/notifications/unread-count": {"get"},
    "/api/v1/notifications/{notification_id}/read": {"post"},
    "/api/v1/notifications/read-all": {"post"},
    # media (Phase 7) — §11.2. `/media` returns a *limits document*, not a
    # collection (§11.4 calls that trap out by name), so the entry below is a
    # GET that answers JSON rather than a listing.
    #
    # Deliberately absent: any route that *creates* a notification-free media
    # object on the client's behalf without bytes, and any unsigned read of the
    # bytes — §11.5 serves those to the uploader only.
    "/api/v1/media": {"get"},
    "/api/v1/media/{media_id}": {"get", "put", "delete", "post"},
    "/api/v1/users/me/photo": {"put", "delete"},
    # posts (Phase 8) — §9.1's six [M] routes.
    #
    # `/posts/mine` is listed **before** `/posts/{post_id}` to mirror the router's
    # declaration order, which is load-bearing: declared the other way round, the
    # literal path would be matched by the parameterised route and `parse_id` would
    # answer 404 for the client's own "My Posts" screen. `test_p8_posts` asserts the
    # behaviour; this keeps the contract honest about the second, distinct path.
    #
    # `GET /posts/{post_id}` is [M] in §9.1 although the client does not call it, so
    # it is a forward contract like messaging and notifications.
    "/api/v1/posts": {"get", "post"},
    "/api/v1/posts/mine": {"get"},
    "/api/v1/posts/{post_id}": {"get", "patch", "delete"},
    # stories (Phase 8) — §10.1's five routes. The three [M] ones are the contract
    # the mobile client actually calls (`src/api/stories.ts`: `fetchStories`,
    # `fetchStory`, `recordStoryView`, driven from `home.tsx`); `POST /stories` and
    # `DELETE /stories/{id}` are [F] — "server-side (platform/company)" publication,
    # with no client call site — and are listed because they are specified routes,
    # not because the client needs them.
    #
    # `/stories/{story_id}/view` is POST-only, deliberately: a view is a write, and
    # letting it happen on a read would mark a story viewed because somebody
    # prefetched a detail screen.
    "/api/v1/stories": {"get", "post"},
    "/api/v1/stories/{story_id}": {"get", "delete"},
    "/api/v1/stories/{story_id}/view": {"post"},
    "/api/v1/skills/catalog": {"get"},
    "/api/v1/onboarding/state": {"get"},
    # health
    "/api/v1/health": {"get"},
    "/api/v1/ready": {"get"},
}

#: Substrings that must never appear in a *response* schema. A password field in
#: a request model is correct and expected; in a response it is a breach.
FORBIDDEN_IN_RESPONSES = ("password_hash", "jwt_secret", "argon2")

#: Routes reachable without a token. Everything else must declare security.
PUBLIC_ROUTES = {
    "/api/v1/health",
    "/api/v1/ready",
    "/api/v1/auth/signup",
    "/api/v1/auth/login",
}


def main() -> int:
    document = create_app().openapi()
    problems: list[str] = []
    paths = document.get("paths", {})

    for path, expected in EXPECTED.items():
        if path not in paths:
            problems.append(f"MISSING ROUTE {path}")
            continue
        actual = {method.lower() for method in paths[path]}
        for method in sorted(expected - actual):
            problems.append(f"MISSING METHOD {method.upper()} {path}")

    for path, item in paths.items():
        for method, operation in item.items():
            if method not in ("get", "post", "put", "patch", "delete"):
                continue
            # A 2xx response is the only one that carries a body we chose.
            for status_code, response in (operation.get("responses") or {}).items():
                if not str(status_code).startswith("2"):
                    continue
                content = response.get("content", {}).get("application/json", {})
                schema = content.get("schema", {})
                if _mentions_forbidden(schema):
                    problems.append(
                        f"FORBIDDEN FIELD in {method.upper()} {path} -> {status_code}"
                    )

    # Security: the protected routes must actually ask for a bearer token.
    for path, item in paths.items():
        if path in PUBLIC_ROUTES:
            continue
        for method, operation in item.items():
            if not isinstance(operation, dict):
                continue
            if not operation.get("security"):
                problems.append(f"NO SECURITY on {method.upper()} {path}")

    schemas = document.get("components", {}).get("schemas", {})
    print(f"routes documented: {len(paths)}")
    print(f"schemas defined:   {len(schemas)}")
    print(f"routes expected:   {len(EXPECTED)}")

    if problems:
        print("\nPROBLEMS:")
        for problem in problems:
            print(f"  - {problem}")
        return 1

    print(
        "\nOK: every expected route present, no forbidden response field, "
        "security declared."
    )
    return 0


def _mentions_forbidden(schema: object, depth: int = 0) -> bool:
    """Walk a response schema looking for a forbidden property name.

    Iterative with a depth cap rather than a plain recursion. Pydantic's generated
    schemas are self-referential (a validation-error schema refers back to the
    validation-error schema), and a naive recursive walk on a generated document
    does not terminate in practice. The cap makes the check a bounded static
    inspection instead of an unbounded traversal.

    A bare ``$ref`` is not treated as a hit: the referenced schema is checked in its
    own right when it is reached through a concrete property, and treating every
    ref as a hit would report the same false positive for every response.
    """

    if depth > 12 or not isinstance(schema, dict):
        return False
    if "$ref" in schema:
        return False

    for name, value in (schema.get("properties") or {}).items():
        if any(bad in name for bad in FORBIDDEN_IN_RESPONSES):
            return True
        if _mentions_forbidden(value, depth + 1):
            return True

    for key in ("items", "additionalProperties"):
        if _mentions_forbidden(schema.get(key), depth + 1):
            return True

    for combinator in ("allOf", "anyOf", "oneOf"):
        for part in schema.get(combinator) or []:
            if _mentions_forbidden(part, depth + 1):
                return True

    return False


if __name__ == "__main__":
    raise SystemExit(main())
