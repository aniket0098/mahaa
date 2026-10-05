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
import type {
  FeedAuthor,
  FeedCategory,
  FeedComment,
  FeedPost,
  FeedPostKind,
} from '@/features/feed/feedModel';

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
  /** The searchable handle. Read so the card can render an `@username` line. */
  readonly username: string;
  /** The immutable, shareable handle. Carried so a card can name its author. */
  readonly public_id: string;
  readonly headline: string | null;
  readonly avatar_url: string | null;
  readonly verified: boolean;
  readonly is_self: boolean;
}

/**
 * `engagement` — the server's own counts, mapped once, here.
 *
 * **These are the only numbers the card may print.** The fields are required, not
 * optional-with-a-default, so a card cannot reach for a fallback when the field is
 * missing: `mapPost` reads a server response that either carries the block or the
 * type is wrong. That is what stops the feed from ever showing a fabricated "12
 * likes", which is the single most misleading thing this module could do.
 */
interface WireEngagement {
  readonly like_count: number;
  readonly comment_count: number;
  readonly liked_by_me: boolean;
}

/** One comment, as `GET/POST /posts/{id}/comments` return it. */
export interface WireComment {
  readonly id: string;
  readonly post_id: string;
  readonly body: string;
  readonly created_at: string;
  readonly author: WireAuthor;
}

/** What `POST`/`DELETE /posts/{id}/like` answer with. */
export interface WireEngagementOut {
  readonly like_count: number;
  readonly comment_count: number;
  readonly liked_by_me: boolean;
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
  readonly engagement: WireEngagement;
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

/** The comments envelope, which is the same `Page` shape the posts list uses. */
interface CommentPage {
  readonly items: readonly WireComment[];
  readonly total: number;
}

/** `POST /posts` body, mapped onto the server's `PostCreate`. */
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
    engagement: {
      likeCount: wire.engagement.like_count,
      commentCount: wire.engagement.comment_count,
      likedByMe: wire.engagement.liked_by_me,
    },
    author: mapAuthor(wire.author),
  };
}

/* -------------------------------------------------------------------------- */
/* Engagement — likes and comments                                              */
/* -------------------------------------------------------------------------- */

/**
 * `POST /posts/{id}/like` and `DELETE /posts/{id}/like`.
 *
 * **Both resolve to the server's authoritative counts**, which is what lets the
 * card reconcile an optimistic update rather than keep a guess. Both are
 * idempotent server-side, so a double tap is not an error and needs no
 * client-side de-duplication beyond disabling the button while one is in flight.
 */
export function likePost(postId: string): Promise<WireEngagementOut> {
  return apiClient.post<WireEngagementOut>(`/posts/${postId}/like`);
}

export function unlikePost(postId: string): Promise<WireEngagementOut> {
  return apiClient.delete<WireEngagementOut>(`/posts/${postId}/like`);
}

/**
 * `GET /posts/{id}/comments` — the sheet's list.
 *
 * Read through the API rather than from the post's own payload: a post carries a
 * *count*, not the comments themselves, so a sheet that invented its own list
 * would be showing something the server never said.
 */
export async function fetchComments(postId: string): Promise<FeedComment[]> {
  const page = await apiClient.get<CommentPage>(`/posts/${postId}/comments`);
  return page.items.map(mapComment);
}

/**
 * `POST /posts/{id}/comments` — the author's own words.
 *
 * Only `{body}` is sent. There is no author field on the wire, because there is
 * none on the server: the comment is attributed to the bearer token, so a client
 * cannot post as somebody else even if it tried.
 */
export async function createComment(
  postId: string,
  body: string,
): Promise<FeedComment> {
  return mapComment(await apiClient.post<WireComment>(`/posts/${postId}/comments`, { body: { body } }));
}

/** `DELETE /posts/{id}/comments/{commentId}` — the author's own comment only. */
export async function deleteComment(
  postId: string,
  commentId: string,
): Promise<void> {
  await apiClient.delete<void>(`/posts/${postId}/comments/${commentId}`);
}

/**
 * One author projection, shared by a post and by a comment.
 *
 * **Both render an avatar and a name, so both read the same identity.** One
 * mapper means a person's avatar can never be resolved one way on a post and
 * another way on their comment.
 */
function mapAuthor(wire: WireAuthor): FeedAuthor {
  return {
    name: wire.name,
    username: wire.username,
    publicId: wire.public_id,
    headline: wire.headline,
    // The same absolutisation a post's author avatar gets, and for the same
    // reason: the API serves media as a relative `served_at` path, and a path
    // that never resolves to a host silently falls back to initials.
    avatarUrl: wire.avatar_url ? absoluteMediaUri(wire.avatar_url) : null,
    // A comment the reader wrote opens their own profile, exactly as a post of
    // their own does. The server decides which those are via `is_self`.
    profileHref: wire.is_self ? '/profile' : null,
    verified: wire.verified,
  };
}

function mapComment(wire: WireComment): FeedComment {
  return {
    id: wire.id,
    postId: wire.post_id,
    body: wire.body,
    createdAt: wire.created_at,
    author: mapAuthor(wire.author),
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

