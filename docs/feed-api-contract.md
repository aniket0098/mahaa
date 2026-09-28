# Feed API contract — implemented (stage 1)

**Stage 1 is implemented in `apps/api` and consumed by the mobile app.** This
document remains the specification: it says what each endpoint guarantees, and it
lists plainly what stage 2 still owes.

| Capability | Status | Endpoint |
|---|---|---|
| Upload an image | ✅ implemented | `POST /api/v1/media` |
| Read own media | ✅ implemented | `GET /api/v1/media/{id}` |
| Publish limits to the client | ✅ implemented | `GET /api/v1/media` |
| Community feed | ✅ implemented | `GET /api/v1/posts` |
| Create a post | ✅ implemented | `POST /api/v1/posts` |
| Edit / delete own post | ✅ implemented | `PATCH` · `DELETE /api/v1/posts/{id}` |
| **Video upload** | ❌ stage 2 | needs a duration decoder |
| **Like / Save** | ❌ stage 2 | client keeps them device-local, labelled |
| **Comments** | ❌ stage 2 | client shows an honest empty state |

Server source: `apps/api/app/{models,schemas,repositories,services,api/v1/endpoints}`.
Client: `src/api/posts.ts`, `src/api/media.ts`, `src/features/composer/`.
Tests: `apps/api/tests/test_posts_domain.py` (28 cases, against real PostgreSQL).

The client reads the shape the mobile Community Feed already parses
(`src/features/feed/feedModel.ts`), so switching from a post's own source to
`GET /posts` was a change of source, not a change of model.

## Why no multipart

`POST /media` takes a **raw request body** with the metadata in query parameters
and the file's real type in `Content-Type`. That keeps `python-multipart` out of
the server's dependencies and lets the client use `expo-file-system`'s native
upload task, which reports genuine byte progress — `fetch` cannot.

## Why bytes live in the database

`storage_kind` / `storage_key` are reserved columns, so moving to S3-compatible
storage is a configuration change and a row, not a schema redesign. A local disk
mount was rejected deliberately: the API runs on an ephemeral host filesystem, so
files would not survive a redeploy — which would break the rule that a published
post stays available.


## Why this exists

The current app has these routers: `auth`, `profile`, `stories`, `opportunities`,
`resumes`, `companies`, `health`. There is no posts, engagement, or media
router. Everything below is therefore **new backend surface**.

## Minimal scope for stage 1

Build in this order. Nothing in stage 2+ is needed for a working read-only feed.

| # | Endpoint | Why it is needed |
|---|---|---|
| 1 | `GET /posts` | Replace the demo source in the feed |
| 2 | `GET /posts/{id}` | Post detail, once a detail route exists |
| 3 | `POST /posts` | Real publishing |
| 4 | `PATCH /posts/{id}` · `DELETE /posts/{id}` | Edit and delete, **owner only** |
| 5 | `POST /posts/{id}/like` · `DELETE /posts/{id}/like` | Replaces local like state |
| 6 | `GET /posts/{id}/comments` · `POST /posts/{id}/comments` | Replaces the empty sheet |
| 7 | `POST /posts/{id}/bookmark` · `DELETE /posts/{id}/bookmark` | Replaces local saves |
| 8 | `POST /media` | Image and video storage |

Out of scope for stage 1: reporting, moderation queue, `For You` ranking.

## `GET /posts`

Query parameters:

- `page` (default 1), `page_size` (default 20, max 50) — **offset pagination**, to
  match the existing `FastApiPage` envelope used by `/stories`. Swap to a cursor
  later; the client only needs `items`, `total`, `page`, `page_size`, `pages`.
- `category` — one of `projects | achievements | learning | community`
- `since` — ISO timestamp, for incremental refresh

The four categories map to the four client filters exactly. **There is no
`for_you` parameter** while no ranking exists. If a personalised feed is added,
it must be a separate, explicitly-labelled surface — never the default ordering
of `GET /posts`.

### Response

```json
{
  "items": [ { "id": "…", "kind": "project", "category": "projects",
               "title": "…", "body": "…", "media": [], "project": {},
               "achievement": null, "tags": [], "created_at": "2026-06-01T12:00:00Z",
               "author": {}, "viewer_state": {} } ],
  "total": 42, "page": 1, "page_size": 20, "pages": 3
}
```

`project` and `achievement` follow the client's `FeedProject` / `FeedAchievement`:

- **Project** — `title`, `description`, `technologies[]`, `category`, `status`,
  `team`, `role`, `source_url`, `live_url`
- **Achievement** — `title`, `issuer`, `achieved_on`, `description`,
  `verification_url`

### `author`

`name`, `headline`, `avatar_url`, `verified`.

**`verified` must default to `false` and require a real signal.** The mobile
client renders a badge from this field and nothing else; there is no client-side
inference, so a wrong `true` here is a false credential claim in production.

### `viewer_state` (per viewer, never a top-level field)

`liked: bool`, `saved: bool`. The app needs a like count and the viewer's own
liked state, but **the count is only rendered when the API returns it** — the
client shows no number otherwise, so returning no count is a valid, supported
state rather than a break.

## Authorisation

- Reading: a candidate reads their own feed, and other authors' posts. A post
  from a private profile is excluded rather than returned with hidden fields.
- Writing: only the authenticated candidate, and only for their own post.
  `PATCH`/`DELETE` must 403 or 404 for another author's post — never succeed.
- `POST /posts/{id}/like`, `/comments`, `/bookmark` require authentication.

## Media

`POST /media` → `{ "uri": "https://…", "width": 1280, "height": 800, "kind": "image" }`

The client stores media as a **URI plus intrinsic width and height**, and sizes
every image from those numbers so a certificate is never cropped. The response
**must** include accurate `width`/`height`; the client does not decode images to
discover them.

- Images: PNG/JPEG/WebP, max 10 MB.
- Video: **max 30 seconds**, enforced server-side by probing the file, not by
  trusting a client-declared duration. Reject longer files with a 422 that names
  the limit.
- Media must be served over HTTPS, and the app fetches them with `expo-image`
  (no `Authorization` header), so a private asset store needs signed URLs.

## Validation

Schemas follow the existing `extra="forbid"` convention. Minimums:

- `body` ≤ 5000 chars; `title` ≤ 200; ≤ 20 tags; ≤ 10 media items.
- A post must have at least one of: `body`, `media`, `project`, `achievement`.
- `kind` is derived server-side from which payload is present, not accepted from
  the client as an arbitrary string.

## Rate limits

- `POST /posts`: 10 per hour per user.
- `POST /media`: 30 per hour per user, and 200 MB per day.
- Likes/bookmarks: 60 per minute per user.

## Migration notes

New tables: `posts`, `post_media`, `post_likes`, `post_bookmarks`,
`post_comments`, `media_assets`. Additive only — **no change to any existing
router or schema**, so the current clients keep working. Backfill is not
required: existing profile records are not posts. The app reads them through
`GET /profile` and merges them client-side until an author chooses to publish.

## What the app does **not** need

- No recommendation endpoint, until a ranking service genuinely exists.
- No report endpoint, until a moderation queue exists. The client deliberately
  shows no Report action.
- No `/posts/{id}/share` endpoint. Sharing is the OS share sheet; the client
  shares real URLs the post already carries and **never a constructed
  permalink**, so there is no share link to mint here.
