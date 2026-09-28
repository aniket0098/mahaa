/**
 * Profile model — the pure derivations behind the candidate profile screen.
 *
 * Everything here is a function of the real `GET /profile` aggregate and the
 * real `GET /posts/mine` response. Nothing in this module invents a number, a
 * rank, or a label: where the backend has no domain (connections, followers,
 * leaderboard, hobbies) the corresponding derivation simply does not exist, and
 * the screen renders nothing for it.
 *
 * Kept separate from the screen so it can be unit tested in Node without a
 * React Native renderer.
 */

import { formatRecordDate } from '@/features/feed/feedModel';
import type {
  AchievementRead,
  CertificationRead,
  EducationRead,
  IdentityRead,
  ProfileAggregate,
} from '@/types/profile';

/* -------------------------------------------------------------------------- */
/* Navigation targets                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Where a statistic leads. `route` is an ordinary push; `scroll` is an anchor
 * inside the profile screen itself, because the Posts statistic and the
 * completeness meter are sections of the very page they sit on.
 */
export type StatLink = { kind: 'route'; path: string } | { kind: 'scroll'; anchor: string };

/** Anchors on the profile page, used by the `scroll` link kind. */
export const PROFILE_ANCHORS = {
  posts: 'profile-section-posts',
  completeness: 'profile-section-completeness',
} as const;

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

export interface HeaderMeta {
  /** Course line, e.g. `B.Tech · Computer Science`. */
  course: string | null;
  /** Institution the candidate actually has on file. */
  institution: string | null;
  /** Graduation year (or `Present`) when the record carries one. */
  graduation: string | null;
  location: string | null;
}

/* -------------------------------------------------------------------------- */
/* Statistics row                                                              */
/* -------------------------------------------------------------------------- */

export interface StatEntry {
  key: 'posts' | 'projects' | 'skills';
  label: string;
  /**
   * The count itself. `null` means it is not known — the request is still in
   * flight, or it failed — and the column renders an em dash rather than a `0`,
   * because an unanswered request is not evidence of zero records.
   */
  value: number | null;
  /** `true` only while the request is in flight, which is what a skeleton shows. */
  loading: boolean;
  link: StatLink;
}

export interface StatInput {
  /** Server total from `GET /posts/mine`, or `null` when it is not known. */
  postsTotal: number | null;
  /** Whether `GET /posts/mine` is still in flight. */
  postsLoading: boolean;
  projectCount: number;
  skillCount: number;
}

/**
 * The three-column statistics row. Each entry maps to a destination that really
 * exists: the two section counts open their section editor, and the post count
 * scrolls to the Posts & Activity section of this same page.
 *
 * Connections and followers are absent on purpose — the backend has no such
 * domain, so a number for either could only be invented.
 */
export function buildStatEntries(input: StatInput): StatEntry[] {
  return [
    {
      key: 'posts',
      label: 'Posts',
      value: input.postsTotal,
      loading: input.postsLoading,
      link: { kind: 'scroll', anchor: PROFILE_ANCHORS.posts },
    },
    {
      key: 'projects',
      label: 'Projects',
      value: input.projectCount,
      loading: false,
      link: { kind: 'route', path: '/profile/projects' },
    },
    {
      key: 'skills',
      label: 'Skills',
      value: input.skillCount,
      loading: false,
      link: { kind: 'route', path: '/profile/skills' },
    },
  ];
}

/* -------------------------------------------------------------------------- */
/* Activity statistics grid                                                    */
/* -------------------------------------------------------------------------- */

export interface ActivityCard {
  key: string;
  title: string;
  value: number;
  caption: string;
  icon: { ios: string; android: string };
  /** `null` when there is no destination — the card is then not pressable. */
  link: StatLink | null;
}

/**
 * The compact two-column grid. The section is deliberately **not** called a
 * leaderboard: no ranking, score, or percentile exists in the backend, so
 * presenting one would be fiction. Every card is a count of records the
 * candidate genuinely owns, and the categories are disjoint from the statistics
 * row above so nothing is shown twice.
 */
export function buildActivityCards(profile: ProfileAggregate): ActivityCard[] {
  return [
    {
      key: 'achievements',
      title: 'Achievements',
      value: profile.achievements.length,
      caption: 'Recorded',
      icon: { ios: 'trophy.fill', android: 'emoji_events' },
      link: { kind: 'route', path: '/profile/achievements' },
    },
    {
      key: 'certifications',
      title: 'Certificates',
      value: profile.certifications.length,
      caption: 'Issued',
      icon: { ios: 'checkmark.seal.fill', android: 'workspace_premium' },
      link: { kind: 'route', path: '/profile/certifications' },
    },
    {
      key: 'experience',
      title: 'Experience',
      value: profile.experience.length,
      caption: profile.experience.length === 1 ? 'Role' : 'Roles',
      icon: { ios: 'briefcase.fill', android: 'work' },
      link: { kind: 'route', path: '/profile/experience' },
    },
    {
      key: 'education',
      title: 'Education',
      value: profile.education.length,
      caption: profile.education.length === 1 ? 'Record' : 'Records',
      icon: { ios: 'graduationcap.fill', android: 'school' },
      link: { kind: 'route', path: '/profile/education' },
    },
    {
      key: 'links',
      title: 'Links',
      value: profile.links.length,
      caption: 'Professional',
      icon: { ios: 'link', android: 'link' },
      link: null,
    },
    {
      key: 'completeness',
      title: 'Profile strength',
      value: profile.completeness.percent,
      caption: '% complete',
      icon: { ios: 'chart.bar.fill', android: 'insights' },
      link: { kind: 'scroll', anchor: PROFILE_ANCHORS.completeness },
    },
  ];
}

/**
 * Header meta derived from the **first** education record — the one the server
 * returns first. Absent fields come back as `null`, never as a placeholder
 * string, so the screen can hide the line entirely rather than render a dash.
 */
export function buildHeaderMeta(
  identity: Pick<IdentityRead, 'location'>,
  education: readonly EducationRead[],
): HeaderMeta {
  const record = education[0];
  const course = record
    ? [record.degree, record.field_of_study].filter(Boolean).join(' · ') || null
    : null;

  let graduation: string | null = null;
  if (record) {
    if (record.end_date) graduation = record.end_date.slice(0, 4);
    else if (record.current) graduation = 'Present';
  }

  return {
    course,
    institution: record?.institution ?? null,
    graduation,
    location: identity.location,
  };
}

/* -------------------------------------------------------------------------- */
/* Chips                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Journey chips from `identity.interests` — trimmed, empties dropped, and
 * case-insensitively deduplicated so a repeated entry does not render twice.
 * An empty list is a legitimate answer and means the section shows its empty
 * state; it never falls back to sample interests. There is no separate hobbies
 * field on the server, so this one list carries both.
 */
export function journeyChips(interests: readonly string[]): string[] {
  const seen = new Set<string>();
  const chips: string[] = [];
  for (const raw of interests) {
    const value = raw.trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push(value);
  }
  return chips;
}

/* -------------------------------------------------------------------------- */
/* About                                                                       */
/* -------------------------------------------------------------------------- */

/** Characters past which the About block collapses and offers "See more". */
export const ABOUT_COLLAPSE_CHARS = 180;
export const ABOUT_COLLAPSED_LINES = 4;

export function needsSeeMore(text: string | null | undefined, threshold = ABOUT_COLLAPSE_CHARS) {
  return (text ?? '').trim().length > threshold;
}

/* -------------------------------------------------------------------------- */
/* Share                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The share payload is plain text built only from fields the server returned.
 * There is no public profile URL in the backend, so none is fabricated — the
 * sheet shares who the candidate is, not a link that would not resolve.
 */
export function buildProfileShareMessage(
  identity: Pick<IdentityRead, 'name' | 'headline'>,
  meta: HeaderMeta,
): string {
  const lines = [identity.name, identity.headline, meta.course, meta.institution, meta.location]
    .map((line) => (line ?? '').trim())
    .filter(Boolean);
  return lines.join('\n');
}


/* -------------------------------------------------------------------------- */
/* Dates and ranges                                                            */
/* -------------------------------------------------------------------------- */

/** `2024-05-01` -> `May 2024`; `null` -> `null`. Never renders an empty date. */
export function monthYear(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * A start/end range in the form `May 2024 – Present`. Returns `null` when the
 * record carries no dates at all, so the line is omitted rather than shown as
 * `— – —`.
 */
export function dateRange(start: string | null, end: string | null, current: boolean) {
  const from = monthYear(start);
  if (current) return from ? `${from} – Present` : 'Present';
  const to = monthYear(end);
  if (!from && !to) return null;
  return `${from ?? '…'} – ${to ?? 'Present'}`;
}

/** An open-ended credential shows only what the server actually recorded. */
export function credentialDate(
  cert: Pick<CertificationRead, 'issued_on' | 'expires_on'>,
): string | null {
  const issued = monthYear(cert.issued_on);
  if (cert.expires_on) {
    const expires = monthYear(cert.expires_on);
    return issued && expires ? `Issued ${issued} · Expires ${expires}` : `Expires ${expires}`;
  }
  return issued ? `Issued ${issued}` : null;
}

/**
 * A verification link is only offered when the server stored one, and only when
 * it is a browsable http(s) value — a non-scheme string would fail silently in
 * the system browser, so it is dropped rather than rendered as a dead control.
 */
export function verificationLink(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  return trimmed;
}

/* -------------------------------------------------------------------------- */
/* Gallery                                                                     */
/* -------------------------------------------------------------------------- */

export interface GalleryEntry {
  id: string;
  kind: 'certificate' | 'achievement';
  title: string;
  issuer: string | null;
  date: string | null;
  detail: string | null;
  /** Only ever non-null when the server stored a real http(s) URL. */
  verificationUrl: string | null;
}

/**
 * Certificates and achievements as one gallery.
 *
 * Neither record type carries an image on the server, so no thumbnail is
 * derived: the card renders an icon tile instead. An achievement has no issuer
 * field in the API either — `AchievementRead.issuer` is legacy client-side drift
 * and is always absent from the response — so its category is shown in the
 * slot an issuer would occupy rather than an invented organisation name.
 */
export function buildGallery(
  certifications: readonly CertificationRead[],
  achievements: readonly AchievementRead[],
): GalleryEntry[] {
  const fromCertificates: GalleryEntry[] = certifications.map((cert) => ({
    id: cert.id,
    kind: 'certificate',
    title: cert.title,
    issuer: cert.issuer,
    date: credentialDate(cert),
    detail: cert.credential_id ? `Credential ${cert.credential_id}` : null,
    verificationUrl: verificationLink(cert.verification_url),
  }));

  const fromAchievements: GalleryEntry[] = achievements.map((achievement) => ({
    id: achievement.id,
    kind: 'achievement',
    title: achievement.title,
    issuer: achievement.category,
    date: formatRecordDate(achievement.achieved_on),
    detail: achievement.description,
    verificationUrl: null,
  }));

  return [...fromCertificates, ...fromAchievements];
}

