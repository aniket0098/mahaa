/**
 * Posts API — the Community Feed's real source.
 *
 * The response is mapped straight into the **existing** `FeedPost` model
 * (`features/feed/feedModel.ts`) rather than introducing a second post type, so
 * every card, filter, and the media viewer keep working whether a post came from
 * `GET /posts`, from the candidate's own profile records, or from the development
 * demo set.
 *
 * Two things are deliberately *not* mapped into the model:
 *  - engagement counts. The API emits none, so the card shows no number;
 *  - verification. `author.verified` is always false server-side, and the card
 *    reads the same field, so a badge can never appear without a real signal.
 */

import { apiClient } from '@/api/client';
import { absoluteMediaUri } from '@/api/media';
import type { FeedCategory, FeedPost, FeedPostKind } from '@/features/feed/feedModel';

/* -------------------------------------------------------------------------- */
/* Wire shapes — the server's field names, mapped once, here.                   */
/* -------------------------------------------------------------------------- */

export interface WireMedia {
  readonly id: string;
  readonly kind: string;
  readonly mime_type: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly duration_ms: number | null;
  readonly size_bytes: number;
  /** A path such as `/api/v1/media/{id}` — turned absolute by the mapper. */
  readonly uri: string;
  readonly position: number;
}

export interface WireProject {
  readonly title: string;
  readonly description?: string | null;
  readonly technologies?: readonly string[];
  readonly category?: string | null;
  readonly status?: string | null;
  readonly team?: string | null;
  readonly role?: string | null;
  readonly source_url?: string | null;
  readonly live_url?: string | null;
}

export interface WireAchievement {
  readonly title: string;
  readonly issuer?: string | null;
  readonly achieved_on?: string | null;
  readonly description?: string | null;
  readonly verification_url?: string | null;
}

interface WireAuthor {
  readonly name: string;
  readonly headline: string | null;
  readonly avatar_url: string | null;
  readonly verified: boolean;
  readonly is_self: boolean;
}

interface WirePost {
  readonly id: string;
  readonly kind: FeedPostKind;
  readonly category: FeedCategory;
  readonly title: string | null;
  readonly body: string | null;
  readonly media: readonly WireMedia[];
  readonly project: WireProject | null;
  readonly achievement: WireAchievement | null;
  readonly tags: readonly string[];
  readonly created_at: string;
  readonly updated_at: string;
  readonly author: WireAuthor;
}

/**
 * The `Page` envelope the posts domain returns: `{items, total, limit, offset,
 * has_more}` from `app/schemas/common.py`.
 *
 * Declared here rather than reused from the stories types, because `/stories`
 * answers with a different, older envelope (`page`/`page_size`/`pages`). Two
 * envelopes exist on the server today; this one describes the one `/posts` uses,
 * and pretending otherwise would have the client read fields that are not there.
 */
interface PostPage {
  readonly items: readonly WirePost[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly has_more: boolean;
}

/** What the composer sends. `kind` is re-derived server-side, never trusted. */
export interface CreatePostInput {
  readonly kind: FeedPostKind;
  /**
   * The feed category the server stores verbatim.
   *
   * **Optional here, never optional on the wire.** `PostCreate.category` is
   * required, and the server keeps whatever value the client sends rather than
   * deriving one, so omitting it is a 422. The composer supplies the precise
   * category; `createPost` falls back to `community` so no caller can 422.
   */
  readonly category?: FeedCategory;
  readonly body?: string | null;
  readonly title?: string | null;
  readonly mediaIds?: readonly string[];
  readonly project?: WireProject;
  readonly achievement?: WireAchievement;
}

/* -------------------------------------------------------------------------- */
/* Mapping                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One server post → one `FeedPost`.
 *
 * `origin` is always `'profile'`, which is the value every demo-isolation rule
 * keys on, so a real post can never be mistaken for development content.
 */
function mapPost(wire: WirePost): FeedPost {
  return {
    id: wire.id,
    kind: wire.kind,
    category: wire.category,
    origin: 'profile',
    title: wire.title,
    body: wire.body,
    media: [...wire.media]
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        kind: item.kind === 'video' ? 'video' : 'image',
        uri: absoluteMediaUri(item.uri),
        // Video carries no server-derived dimensions (`MediaRead` documents
        // them as null for video), so 0 here means "unknown" and the card
        // falls back to a contained box rather than dividing by zero.
        width: item.width ?? 0,
        height: item.height ?? 0,
        alt: item.kind === 'video'
          ? 'Video attached to this post.'
          : 'Image attached to this post.',
      })),
    project: wire.project
      ? {
          title: wire.project.title,
          description: wire.project.description ?? null,
          technologies: [...(wire.project.technologies ?? [])],
          category: wire.project.category ?? null,
          status: wire.project.status ?? null,
          team: wire.project.team ?? null,
          role: wire.project.role ?? null,
          sourceUrl: wire.project.source_url ?? null,
          liveUrl: wire.project.live_url ?? null,
        }
      : null,
    achievement: wire.achievement
      ? {
          title: wire.achievement.title,
          issuer: wire.achievement.issuer ?? null,
          achievedOn: wire.achievement.achieved_on ?? null,
          description: wire.achievement.description ?? null,
          verificationUrl: wire.achievement.verification_url ?? null,
        }
      : null,
    tags: [...wire.tags],
    createdAt: wire.created_at,
    author: {
      name: wire.author.name,
      headline: wire.author.headline,
      // **The same treatment media uris get, and for the same reason.** This
      // used to pass the raw `served_at` path straight through, so a relative
      // `/api/v1/media/<id>` never resolved to a host and every author avatar
      // silently fell back to initials — a bug that looks like "this person has
      // no photo" rather than like a broken URL.
      avatarUrl: wire.author.avatar_url ? absoluteMediaUri(wire.author.avatar_url) : null,
      // A post of the caller's own opens the profile route; another author's does
      // not, because the app has no other-user profile screen.
      profileHref: wire.author.is_self ? '/profile' : null,
      verified: wire.author.verified,
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Calls                                                                       */
/* -------------------------------------------------------------------------- */

/** `GET /posts` — one page of the Community Feed, newest first. */
export async function fetchPosts(params?: {
  category?: FeedCategory;
  limit?: number;
  offset?: number;
}): Promise<FeedPost[]> {
  const query = new URLSearchParams();
  if (params?.category) query.set('category', params.category);
  if (params?.limit) query.set('limit', String(params.limit));
  if (params?.offset) query.set('offset', String(params.offset));
  const suffix = query.toString() ? `?${query.toString()}` : '';

  const page = await apiClient.get<PostPage>(`/posts${suffix}`);
  return page.items.map(mapPost);
}

/**
 * `GET /posts/mine` — the caller's own published posts, with the server's
 * `total` kept rather than dropped.
 *
 * The profile screen needs the number itself: the Posts statistic must be the
 * count of records the server actually holds, never the length of whichever page
 * happened to be fetched, and never a value the client guessed.
 */
export async function fetchMyPosts(
  limit = 50,
  offset = 0,
): Promise<{ items: FeedPost[]; total: number }> {
  const page = await apiClient.get<PostPage>(`/posts/mine?limit=${limit}&offset=${offset}`);
  return { items: page.items.map(mapPost), total: page.total };
}

/**
 * `POST /posts` — publish, and return the server's stored copy.
 *
 * The caller must render the post from this response. Nothing is treated as
 * published before the server has answered 201.
 */
export async function createPost(input: CreatePostInput): Promise<FeedPost> {
  // `community` is the fallback so no caller can 422 by forgetting a field;
  // the composer supplies the precise category for project and achievement.
  const body: Record<string, unknown> = {
    kind: input.kind,
    category: input.category ?? 'community',
  };
  if (input.body !== undefined) body.body = input.body;
  if (input.title !== undefined) body.title = input.title;
  if (input.mediaIds && input.mediaIds.length > 0) body.media_ids = input.mediaIds;
  if (input.project) body.project = input.project;
  if (input.achievement) body.achievement = input.achievement;

  return mapPost(await apiClient.post<WirePost>('/posts', { body }));
}

/** `PATCH /posts/{id}` — edit the caller's own post. */
export async function updatePost(
  postId: string,
  input: { body?: string | null; title?: string | null },
): Promise<FeedPost> {
  return mapPost(await apiClient.patch<WirePost>(`/posts/${postId}`, { body: { ...input } }));
}

/** `DELETE /posts/{id}` — soft delete; resolves only after the server confirms. */
export async function deletePost(postId: string): Promise<void> {
  await apiClient.delete<void>(`/posts/${postId}`);
}

