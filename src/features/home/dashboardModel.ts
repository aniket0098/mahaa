/**
 * Dashboard feed model — types and the record flattener.
 *
 * Native port of `apps/web/src/routes/candidate/home/feed.ts`, minus the demo
 * layer. The web app can append fictional "Demo" posts in development so the
 * media-rich layout can be reviewed before a community API exists; the native
 * app does not, because there is no demo mode here and invented records are
 * exactly what this product refuses to ship.
 *
 * The stream is built from the authenticated candidate's **own** MahaJob records
 * — projects, certifications, achievements, education — which the existing
 * `GET /profile` aggregate already returns. There is no posts/feed API, so there
 * are no other authors, likes, comments, or shares to show, and the model
 * carries no engagement counts at all.
 *
 * Everything here is pure so it can be unit tested in Node without a device.
 */

import type { ProfileAggregate } from '@/types/profile';

export type FeedItemKind = 'project' | 'certification' | 'achievement' | 'education';

/** Presentation kind shown on the card badge. */
export type FeedPostKind =
  | 'project'
  | 'achievement'
  | 'learning'
  | 'discussion'
  | 'image'
  | 'video';

/** Which filter chip shows the post — mirrors the real record types. */
export type FeedPostCategory = 'projects' | 'learning' | 'achievements' | 'community';

export interface FeedItemLink {
  label: string;
  url: string;
}

export interface FeedItem {
  id: string;
  kind: FeedItemKind;
  title: string;
  description: string | null;
  /** Role, issuer, institution, or category — whatever the record really has. */
  context: string | null;
  tags: string[];
  links: FeedItemLink[];
  createdAt: string;
}

export interface FeedPostAuthor {
  name: string;
  headline: string | null;
  avatarUrl: string | null;
  /** Native route for the author, or null when none exists. */
  profileHref: string | null;
}

export interface FeedPost {
  id: string;
  kind: FeedPostKind;
  category: FeedPostCategory;
  title: string;
  description: string | null;
  context: string | null;
  tags: string[];
  links: FeedItemLink[];
  createdAt: string;
  author: FeedPostAuthor;
}

export const feedFilters = [
  { value: 'all', label: 'All' },
  { value: 'projects', label: 'Projects' },
  { value: 'learning', label: 'Learning' },
  { value: 'achievements', label: 'Achievements' },
] as const;

export type FeedFilter = (typeof feedFilters)[number]['value'];

const postKindLabels: Record<FeedPostKind, string> = {
  project: 'Project Showcase',
  achievement: 'Achievement',
  learning: 'Learning Update',
  discussion: 'Technical Discussion',
  image: 'Innovation',
  video: 'Video Demo',
};

export function feedPostLabel(kind: FeedPostKind): string {
  return postKindLabels[kind];
}

const itemKindMapping: Record<FeedItemKind, Pick<FeedPost, 'kind' | 'category'>> = {
  project: { kind: 'project', category: 'projects' },
  certification: { kind: 'learning', category: 'learning' },
  education: { kind: 'learning', category: 'learning' },
  achievement: { kind: 'achievement', category: 'achievements' },
};

/** Flattens the profile's real records into one newest-first stream. */
export function buildFeedItems(profile: ProfileAggregate): FeedItem[] {
  const items: FeedItem[] = [
    ...profile.projects.map((project) => ({
      id: `project-${project.id}`,
      kind: 'project' as const,
      title: project.title,
      description: project.description,
      context: project.role,
      tags: project.skills.map((skill) => skill.name),
      links: [
        ...(project.source_url ? [{ label: 'Source code', url: project.source_url }] : []),
        ...(project.live_url ? [{ label: 'Live demo', url: project.live_url }] : []),
      ],
      createdAt: project.created_at,
    })),
    ...profile.certifications.map((certification) => ({
      id: `certification-${certification.id}`,
      kind: 'certification' as const,
      title: certification.title,
      description: null,
      context: certification.issuer,
      tags: [],
      links: certification.verification_url
        ? [{ label: 'Verify credential', url: certification.verification_url }]
        : [],
      createdAt: certification.created_at,
    })),
    ...profile.achievements.map((achievement) => ({
      id: `achievement-${achievement.id}`,
      kind: 'achievement' as const,
      title: achievement.title,
      description: achievement.description,
      context: achievement.category,
      tags: [],
      links: [],
      createdAt: achievement.created_at,
    })),
    ...profile.education.map((education) => ({
      id: `education-${education.id}`,
      kind: 'education' as const,
      title: education.institution,
      description: education.description,
      context: education.degree ?? education.field_of_study,
      tags: [],
      links: [],
      createdAt: education.created_at,
    })),
  ];

  return items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

/**
 * Presentation view model for the candidate's own records.
 *
 * The author is always the authenticated candidate (their real name, headline
 * and avatar from the aggregate), and `profileHref` points at the real profile
 * route. There is no media because the profile API exposes no images or videos,
 * and no engagement counts because no engagement API exists.
 */
export function buildFeedPosts(profile: ProfileAggregate): FeedPost[] {
  const author: FeedPostAuthor = {
    name: profile.identity.name,
    headline: profile.identity.headline,
    avatarUrl: profile.identity.avatar_url,
    profileHref: '/profile',
  };

  return buildFeedItems(profile).map((item): FeedPost => ({
    id: item.id,
    kind: itemKindMapping[item.kind].kind,
    category: itemKindMapping[item.kind].category,
    title: item.title,
    description: item.description,
    context: item.context,
    tags: item.tags,
    links: item.links,
    createdAt: item.createdAt,
    author,
  }));
}

/** Real record-type filters; `all` keeps chronological order. */
export function filterFeedPosts(posts: FeedPost[], filter: FeedFilter): FeedPost[] {
  switch (filter) {
    case 'all':
      return posts;
    case 'projects':
      return posts.filter((post) => post.category === 'projects');
    case 'learning':
      return posts.filter((post) => post.category === 'learning');
    case 'achievements':
      return posts.filter((post) => post.category === 'achievements');
  }
}

/** Relative time from the record's real timestamp — never a fabricated recency. */
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
