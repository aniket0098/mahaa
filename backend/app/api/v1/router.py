"""The v1 API router.

One place that decides what ``/api/v1`` serves. Feature modules are included
here and nowhere else, so the surface can be read in a single file.

Phase 2 added ``auth`` and ``users/me``; Phase 3 added the ``profile`` domain
(aggregate, completeness, privacy, preferences, six sections), the skill
catalogue and onboarding state. Phase 4 added ``connections``, the first domain
whose records belong to two accounts rather than one. Phase 5 adds the messaging
tables, which depend on connections. Phase 6 added ``notifications``, whose first
producers are connections and messages. Phase 7 adds ``media``, which every
later domain references by id. There are no stub routers for later phases: an
empty module that answers 404 looks like a deliberate 404 and is
indistinguishable from a forgotten one.

Phase 8 added ``stories`` after ``posts``. It is included **after** media because
stories reference `media_assets`, and order here is declaration order only — the
routes do not shadow each other — so this reads as dependency order for the same
reason the import list above does.

The realtime transport is mounted last and from a different module
(``app/api/v1/ws.py``) because it is the only router that is not a collection of
REST endpoints: it declares a single WebSocket route, and it sits under the same
``/api/v1`` prefix so the mobile client derives its socket URL from the one base
address it already has.
"""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1.endpoints import (
    auth,
    connections,
    health,
    media,
    messaging,
    notifications,
    onboarding,
    posts,
    profile,
    skills,
    stories,
    users,
)
from app.api.v1.ws import router as ws_router

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(ws_router)
api_router.include_router(auth.router)
api_router.include_router(users.router)
api_router.include_router(profile.router)
api_router.include_router(connections.router)
api_router.include_router(messaging.router)
api_router.include_router(notifications.router)
api_router.include_router(media.router)
api_router.include_router(posts.router)
api_router.include_router(stories.router)
api_router.include_router(skills.router)
api_router.include_router(onboarding.router)
