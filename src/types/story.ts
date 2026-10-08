/**
 * Types mirroring the backend `stories` domain.
 *
 * Source of truth: `apps/api/app/schemas/stories.py`. Keep in strict parity.
 */

export type StoryContentType = "job" | "internship" | "announcement" | "event";

export interface StoryPublisher {
  readonly name: string;
  readonly logoUrl: string | null;
  readonly verified: boolean;
  readonly kind: "company" | "platform";
}

export interface StoryOpportunitySummary {
  readonly id: string;
  readonly title: string;
  readonly location: string | null;
  readonly workMode: string | null;
}

/**
 * The asset a story carries, mirroring `StoryMediaOut`
 * (`apps/api/app/schemas/stories.py`).
 *
 * `uri` is the server's **relative** `served_at` path (`/api/v1/media/{id}`) —
 * never an absolute host — and goes through `absoluteMediaUri()`/`resolveMediaUrl`
 * before anything fetches it. A native player cannot attach the bearer token,
 * so playback downloads the bytes through the authenticated media client first
 * (`loadPlayableVideoUri`), exactly as the feed does.
 */
export interface StoryMedia {
  readonly id: string;
  readonly kind: 'image' | 'video';
  readonly mimeType: string;
  readonly width: number | null;
  readonly height: number | null;
  /** Always null in V1 (no decoder server-side) — "unknown", not "zero". */
  readonly durationMs: number | null;
  readonly sizeBytes: number;
  readonly uri: string;
}

export interface Story {
  readonly id: string;
  readonly contentType: StoryContentType;
  readonly caption: string;
  readonly status: "published" | "archived";
  readonly publisher: StoryPublisher;
  readonly opportunity: StoryOpportunitySummary | null;
  readonly viewed: boolean;
  readonly createdAt: string;
  /** The uploaded media, or null for a text-only story. */
  readonly media: StoryMedia | null;
  /**
   * The author's public id (`MJ-…`) — the stable key one person's stories are
   * grouped by. Present on every API story; demo stories carry a local id.
   */
  readonly authorPublicId: string;
  /** Whether the current viewer is the author — hides the Connect control. */
  readonly isSelf: boolean;
}

export interface StoryViewResult {
  readonly storyId: string;
  readonly viewed: boolean;
  readonly alreadyRecorded: boolean;
  readonly viewedAt: string;
}

/* ============================ client-side display types ============================ */

/**
 * Presentation metadata carried **only** by locally-built demo stories.
 *
 * The stories API has no `title` field and its `content_type` enum has no
 * "career information" member, so widening `Story` itself would break the
 * parity this file exists to guarantee (`apps/api/app/schemas/stories.py`).
 * A demo story therefore reuses a real `Story` shape and adds its own
 * display-only fields on top, which means:
 *
 *  - a real `Story` still satisfies every component that accepts a
 *    {@link StoryItem}, and
 *  - nothing here is ever sent to, or expected from, the backend.
 */
export interface DemoStoryMeta {
  /** Marks the story as development-only placeholder content. */
  readonly demo: true;
  /** Headline rendered above the caption in the viewer. */
  readonly title: string;
  /** Badge text, e.g. `Career info` for a type the API enum cannot express. */
  readonly typeLabel: string;
}

/**
 * What the stories UI renders: either a real {@link Story} from
 * `GET /stories` or a local demo story carrying {@link DemoStoryMeta}.
 *
 * The three demo fields are optional, so `StoryItem` and `Story` are mutually
 * assignable and no call site needs a cast to move between them.
 */
export type StoryItem = Story & Partial<DemoStoryMeta>;

export interface FastApiPage<T> {
  readonly items: T[];
  readonly total: number;
  readonly page: number;
  readonly page_size: number;
  readonly pages: number;
}

