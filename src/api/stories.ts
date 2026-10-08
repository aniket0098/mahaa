/**
 * Stories API calls — binds to the `/stories` router in
 * `apps/api/app/api/v1/endpoints/stories.py`.
 *
 * Layering: routes -> features -> api -> transport. No direct `fetch`.
 *
 * **Three routes were always the client's** (`GET /stories`, `GET /stories/{id}`,
 * `POST /stories/{id}/view`) and `POST /stories` joined them in Phase 12. The
 * publication route existed on the server the whole time, marked [F] with "no
 * mobile caller" — which was true, and was the reason a story could not be
 * created from the app at all. See {@link createStory}.
 */

import { apiClient } from '@/api/client';
import type { FastApiPage, Story, StoryViewResult } from '@/types/story';

interface RawStory {
  readonly id: string;
  readonly content_type: Story['contentType'];
  readonly caption: string;
  readonly status: Story['status'];
  readonly publisher: {
    readonly name: string;
    readonly logo_url: string | null;
    readonly verified: boolean;
    readonly kind: 'company' | 'platform';
  };
  readonly opportunity: {
    readonly id: string;
    readonly title: string;
    readonly location: string | null;
    readonly work_mode: string | null;
  } | null;
  readonly viewed: boolean;
  readonly created_at: string;
  readonly media: {
    readonly id: string;
    readonly kind: 'image' | 'video';
    readonly mime_type: string;
    readonly width: number | null;
    readonly height: number | null;
    readonly duration_ms: number | null;
    readonly size_bytes: number;
    readonly uri: string;
  } | null;
  readonly author_public_id: string;
  readonly is_self: boolean;
}

interface RawStoryViewResponse {
  readonly story_id: string;
  readonly viewed: boolean;
  readonly already_recorded: boolean;
  readonly viewed_at: string;
}

function mapStory(raw: RawStory): Story {
  return {
    id: raw.id,
    contentType: raw.content_type,
    caption: raw.caption,
    status: raw.status,
    publisher: {
      name: raw.publisher.name,
      logoUrl: raw.publisher.logo_url,
      verified: raw.publisher.verified,
      kind: raw.publisher.kind,
    },
    opportunity: raw.opportunity
      ? {
          id: raw.opportunity.id,
          title: raw.opportunity.title,
          location: raw.opportunity.location,
          workMode: raw.opportunity.work_mode,
        }
      : null,
    viewed: raw.viewed,
    createdAt: raw.created_at,
    // `uri` is the server's relative `served_at`; the media layer joins it onto
    // the configured base before anything fetches it (never a hardcoded host).
    media: raw.media
      ? {
          id: raw.media.id,
          kind: raw.media.kind,
          mimeType: raw.media.mime_type,
          width: raw.media.width,
          height: raw.media.height,
          durationMs: raw.media.duration_ms,
          sizeBytes: raw.media.size_bytes,
          uri: raw.media.uri,
        }
      : null,
    authorPublicId: raw.author_public_id,
    isSelf: raw.is_self,
  };
}

/** `GET /stories` — active stories feed for students. */
export async function fetchStories(params?: {
  page?: number;
  pageSize?: number;
}): Promise<FastApiPage<Story>> {
  const query = new URLSearchParams();
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('page_size', String(params.pageSize));
  const queryString = query.toString();
  const path = queryString ? `/stories?${queryString}` : '/stories';

  const raw = await apiClient.get<FastApiPage<RawStory>>(path);
  return {
    items: raw.items.map(mapStory),
    total: raw.total,
    page: raw.page,
    page_size: raw.page_size,
    pages: raw.pages,
  };
}

/** `GET /stories/{id}` — single story detail for the viewer. */
export async function fetchStory(storyId: string): Promise<Story> {
  const raw = await apiClient.get<RawStory>(`/stories/${storyId}`);
  return mapStory(raw);
}

/** `POST /stories/{id}/view` — record view (idempotent per student). */
export async function recordStoryView(storyId: string): Promise<StoryViewResult> {
  const raw = await apiClient.post<RawStoryViewResponse>(`/stories/${storyId}/view`);
  return {
    storyId: raw.story_id,
    viewed: raw.viewed,
    alreadyRecorded: raw.already_recorded,
    viewedAt: raw.viewed_at,
  };
}

/**
 * What `POST /stories` accepts.
 *
 * **`content_type` is a story *category*, not a media type.** The server's
 * vocabulary is `job | internship | announcement | event`
 * (`StoryContentType`), so an image story is an *announcement* that carries
 * artwork — not a `content_type` of "image". Sending the media kind here is a 422,
 * which is why this type cannot be `MediaKind`.
 *
 * **`publisher_kind` is deliberately not exposed.** The server accepts only
 * `platform` today and rejects `company` until the companies domain exists, so
 * offering the field in the UI would advertise an option that always fails. It
 * defaults server-side.
 *
 * `mediaId` is optional: the backend accepts a text-only story (`media_id: null`),
 * so a caption is the only hard requirement.
 */
export interface CreateStoryInput {
  readonly contentType: Story['contentType'];
  readonly caption: string;
  readonly mediaId?: string | null;
}

/**
 * `POST /stories` — publish, and return the server's stored story.
 *
 * **Nothing is rendered optimistically.** The returned `Story` is the stored
 * record, so the caller can put *that* into the cache rather than a locally
 * assembled one — which is the only version that carries the publisher snapshot
 * and the server's own `viewed` answer.
 */
export async function createStory(input: CreateStoryInput): Promise<Story> {
  const body: Record<string, unknown> = {
    content_type: input.contentType,
    caption: input.caption,
  };
  // Only sent when there is one: `null` is a different request from "absent" on
  // a body the server validates, and an absent optional field is what it wants.
  if (input.mediaId) body.media_id = input.mediaId;

  return mapStory(await apiClient.post<RawStory>('/stories', { body }));
}
