/**
 * Stories API calls — binds to the `/stories` router in
 * `apps/api/app/api/v1/endpoints/stories.py`.
 *
 * Layering: routes -> features -> api -> transport. No direct `fetch`.
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
