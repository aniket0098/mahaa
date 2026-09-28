/**
 * Community Feed model — types, the record flattener, and the filter rules.
 *
 * Pure data and pure functions: no React, no React Native, no API import. That
 * is deliberate — it is what lets `npm test` prove the feed's honesty rules in
 * plain Node, on a machine with no emulator (see `feedModel.test.ts`).
 *
 * **There is no posts API**, so nothing here invents a second author, a like
 * count, or a comment count. Every post comes from one of exactly two origins:
 *
 *  - `origin: 'profile'` — a record the authenticated candidate really created,
 *    flattened out of the `GET /profile` aggregate the Home screen already
 *    fetches. One request feeds the whole page; the feed adds no round trip.
 *  - `origin: 'demo'` — a development-only placeholder from `demoFeedPosts.ts`,
 *    namespaced by id and gated by `__DEV__`.
 *
 * The `FeedPost` shape is deliberately the shape a future `/posts` response
 * would have (see `docs/feed-api-contract.md`), so swapping the demo source for
 * the API later is a change of source, not a change of model.
 */

import type { ProfileAggregate } from '@/types/profile';

/** What the post *is* — drives which block renders and whether a badge shows. */
export type FeedPostKind = 'text' | 'image' | 'project' | 'achievement' | 'learning' | 'video';

/** Which filter chip shows the post. */
export type FeedCategory = 'projects' | 'achievements' | 'learning' | 'community';

/** Where the post came from. The single honesty switch in the model. */
export type FeedOrigin = 'profile' | 'demo';

/** The four filters the app can actually honour. `latest` is the default. */
export type FeedFilter = 'latest' | 'projects' | 'achievements' | 'learning';

export const feedFilters = [
  { value: 'latest', label: 'Latest' },
  { value: 'projects', label: 'Projects' },
  { value: 'achievements', label: 'Achievements' },
  { value: 'learning', label: 'Learning' },
] as const satisfies readonly { value: FeedFilter; label: string }[];

/**
 * A body longer than this gets a "See more" control.
 *
 * The number is a presentation constant, not a server limit — nothing is
 * truncated in the data, only in the initial render.
 */
export const BODY_PREVIEW_CHARS = 260;

/** Lines the collapsed body shows before "See more". */
export const BODY_PREVIEW_LINES = 4;

/** A media item. `uri` is what a media API will return; demo posts embed one. */
export interface FeedMedia {
  id: string;
  uri: string;
  /** Intrinsic size, so the card can size it without cropping the content. */
  width: number;
  height: number;
  /** Describes the image for a screen reader. Never a duplicate of the caption. */
  alt: string;
}

/**
 * Structured project detail — only for records that really carry it.
 *
 * `category`, `status`, and `team` exist because the API contract defines them;
 * today's `ProjectRead` does not, so they stay `null` for profile records and
 * the card renders no empty row for them.
 */
export interface FeedProject {
  title: string;
  description: string | null;
  technologies: string[];
  category: string | null;
  status: string | null;
  /** "Individual project" / "Team project", or null when unstated. */
  team: string | null;
  role: string | null;
  sourceUrl: string | null;
  liveUrl: string | null;
}

/** Structured achievement detail. `verificationUrl` is only ever a real URL. */
export interface FeedAchievement {
  title: string;
  issuer: string | null;
  /** ISO date or null — never a guessed date. */
  achievedOn: string | null;
  description: string | null;
  verificationUrl: string | null;
}

export interface FeedAuthor {
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  /**
   * A route the author can really be opened at, or null.
   *
   * A profile record's author is the authenticated candidate, so this is
   * `/profile`. A demo author has no profile route — there is no other-user
   * profile screen in the app — so a demo post carries `null` and its name is
   * therefore not tappable, rather than a dead link.
   */
  profileHref: string | null;
  /**
   * Always false today: no verification service exists, so nothing can be
   * verified. The field exists so the card has a single place to read from, and
   * no demo post may ever set it to true (asserted in `demoFeedPosts.test.ts`).
   */
  verified: boolean;
}

export interface FeedPost {
  id: string;
  kind: FeedPostKind;
  category: FeedCategory;
  origin: FeedOrigin;
  title: string | null;
  body: string | null;
  media: FeedMedia[];
  project: FeedProject | null;
  achievement: FeedAchievement | null;
  /** Hashtag-like tags, without the leading `#`. */
  tags: string[];
  /** The record's real timestamp. Drives ordering and the relative time label. */
  createdAt: string;
  author: FeedAuthor;
}

/* -------------------------------------------------------------------------- */
/* Labels                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The badge label for a post kind, or null when the card should show no badge.
 *
 * Text and image posts carry no badge on purpose: the content is the signal, and
 * a chip reading "Update" on every plain post is exactly the clutter the design
 * brief rules out.
 */
export function feedKindLabel(kind: FeedPostKind): string | null {
  switch (kind) {
    case 'project':
      return 'Project Showcase';
    case 'achievement':
      return 'Achievement';
    case 'learning':
      return 'Learning';
    case 'video':
      return 'Video Demo';
    case 'text':
    case 'image':
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Media sizing                                                                 */
/* -------------------------------------------------------------------------- */

/** Images never exceed this height, so one tall screenshot cannot fill a screen. */
export const MAX_MEDIA_HEIGHT = 360;

/**
 * The height a media item renders at, preserving its aspect ratio.
 *
 * A certificate is never cropped to a fixed box: the displayed height follows
 * the image's own proportions, capped by {@link MAX_MEDIA_HEIGHT}. A degenerate
 * or unknown size falls back to a 4:3 box rather than producing `NaN`.
 */
export function mediaDisplayHeight(media: FeedMedia, maxWidth: number): number {
  const width = media.width > 0 ? media.width : 4;
  const height = media.height > 0 ? media.height : 3;
  return Math.min(MAX_MEDIA_HEIGHT, Math.round((maxWidth * height) / width));
}

/** Aspect ratio as `width / height`, falling back to 4:3 when unknown. */
export function mediaAspectRatio(media: FeedMedia): number {
  const width = media.width > 0 ? media.width : 4;
  const height = media.height > 0 ? media.height : 3;
  return width / height;
}

/**
 * Clamps a media index into `[0, count - 1]`.
 *
 * Extracted so the pager, the viewer, and the tests share one rule: a stale
 * index (a post whose media shrank, a swipe past the end) resolves to the
 * nearest valid image instead of rendering nothing or reading `undefined`.
 */
export function clampMediaIndex(index: number, count: number): number {
  if (!Number.isFinite(index) || count <= 0) return 0;
  return Math.min(Math.max(Math.trunc(index), 0), count - 1);
}

/**
 * The multi-image indicator's text, or null for a single image.
 *
 * A one-image post shows no counter at all: "1 of 1" is noise, and the brief
 * asks for a count only where there is more than one image.
 */
export function mediaCountLabel(index: number, count: number): string | null {
  if (count <= 1) return null;
  return `${clampMediaIndex(index, count) + 1} of ${count} images`;
}

/* -------------------------------------------------------------------------- */
/* Profile records -> posts                                                     */
/* -------------------------------------------------------------------------- */

/** Formats a real `*_on` date field, or null when it is absent or unparseable. */
export function formatRecordDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * Flattens the candidate's **own** real records into feed posts.
 *
 * The same data the previous "Your Feed" section used, expressed in the
 * community feed's shape so the two are one list rather than two stacked
 * sections. Only fields the record actually carries are mapped; nothing is
 * defaulted into a plausible-looking value, and the author is the authenticated
 * candidate — the only author whose profile this app can open.
 */
export function fromProfileRecords(profile: ProfileAggregate): FeedPost[] {
  const author: FeedAuthor = {
    name: profile.identity.name,
    headline: profile.identity.headline,
    avatarUrl: profile.identity.avatar_url,
    profileHref: '/profile',
    verified: false,
  };

  const records: FeedPost[] = [
    ...profile.projects.map((project): FeedPost => ({
      id: `project-${project.id}`,
      kind: 'project',
      category: 'projects',
      origin: 'profile',
      title: project.title,
      body: project.description,
      media: [],
      project: {
        title: project.title,
        description: project.description,
        technologies: project.skills.map((skill) => skill.name),
        // Defined by the API contract but absent from `ProjectRead` today, so
        // they stay null and the card renders no empty row for them.
        category: null,
        status: null,
        team: null,
        role: project.role,
        sourceUrl: project.source_url,
        liveUrl: project.live_url,
      },
      achievement: null,
      tags: project.skills.map((skill) => skill.name),
      createdAt: project.created_at,
      author,
    })),

    ...profile.certifications.map(
      (certification): FeedPost => ({
        id: `certification-${certification.id}`,
        // A certificate is achievement content, which is exactly what the
        // Achievements filter promises — not a learning update.
        kind: 'achievement',
        category: 'achievements',
        origin: 'profile',
        title: certification.title,
        body: null,
        media: [],
        project: null,
        achievement: {
          title: certification.title,
          issuer: certification.issuer,
          achievedOn: certification.issued_on,
          description: null,
          verificationUrl: certification.verification_url,
        },
        tags: [],
        createdAt: certification.created_at,
        author,
      }),
    ),

    ...profile.achievements.map(
      (achievement): FeedPost => ({
        id: `achievement-${achievement.id}`,
        kind: 'achievement',
        category: 'achievements',
        origin: 'profile',
        title: achievement.title,
        // The description lives in the achievement block below, so it is not
        // repeated as body text as well.
        body: null,
        media: [],
        project: null,
        achievement: {
          title: achievement.title,
          issuer: achievement.issuer,
          achievedOn: achievement.achieved_on,
          description: achievement.description,
          verificationUrl: null,
        },
        tags: achievement.category ? [achievement.category] : [],
        createdAt: achievement.created_at,
        author,
      }),
    ),

    ...profile.education.map((education): FeedPost => {
      const subtitle = education.degree ?? education.field_of_study;
      return {
        id: `education-${education.id}`,
        kind: 'learning',
        category: 'learning',
        origin: 'profile',
        title: education.institution,
        body: education.description,
        media: [],
        project: null,
        achievement: null,
        tags: subtitle ? [subtitle] : [],
        createdAt: education.created_at,
        author,
      };
    }),
  ];

  return sortNewestFirst(records);
}

/* -------------------------------------------------------------------------- */
/* Ordering, filtering, merging                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Newest first, by the record's real timestamp.
 *
 * An unparseable timestamp sorts last rather than to the top, so a malformed
 * record cannot masquerade as the most recent thing in the feed.
 */
export function sortNewestFirst(posts: readonly FeedPost[]): FeedPost[] {
  return [...posts].sort((a, b) => {
    const left = Date.parse(a.createdAt);
    const right = Date.parse(b.createdAt);
    if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : 1;
    if (Number.isNaN(right)) return -1;
    return right - left;
  });
}

/**
 * The posts a filter shows.
 *
 * `latest` keeps chronological order. The other three match **real record
 * types**, so every chip is backed by data the app actually holds. There is
 * deliberately no "For You": no ranking service exists, and a filter that
 * implies personalisation must not be shown.
 */
export function filterFeed(posts: readonly FeedPost[], filter: FeedFilter): FeedPost[] {
  switch (filter) {
    case 'latest':
      return [...posts];
    case 'projects':
      return posts.filter((post) => post.category === 'projects');
    case 'achievements':
      return posts.filter((post) => post.category === 'achievements');
    case 'learning':
      return posts.filter((post) => post.category === 'learning');
  }
}

/** How many posts carry each category — used to explain an empty filter. */
export function countByCategory(posts: readonly FeedPost[]): Record<FeedCategory, number> {
  const counts: Record<FeedCategory, number> = {
    projects: 0,
    achievements: 0,
    learning: 0,
    community: 0,
  };
  for (const post of posts) counts[post.category] += 1;
  return counts;
}

/**
 * The one list the feed renders: real posts first, demo posts after, and demo
 * posts only when they are enabled.
 *
 * `demoEnabled` is a parameter rather than a read of the environment so this
 * stays a pure function of its arguments: the `__DEV__` decision belongs to
 * `demoFeedPosts.ts`, and a test can drive both branches without touching a
 * global.
 */
export function mergeFeed(
  realPosts: readonly FeedPost[],
  demoPosts: readonly FeedPost[],
  options: { readonly demoEnabled: boolean },
): FeedPost[] {
  if (!options.demoEnabled) return [...realPosts];
  return [...realPosts, ...demoPosts];
}

/**
 * Relative time from the record's real timestamp — never a fabricated recency.
 * Returns an empty string for an unparseable value rather than guessing.
 */
export function formatFeedTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return '';

  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;

  const month = then.toLocaleDateString('en-US', { month: 'short' });
  return `${month} ${then.getFullYear()}`;
}
