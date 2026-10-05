/**
 * DEMO feed posts â€” development-only sample content for the Community Feed.
 *
 * A direct port of the contract `features/stories/demoStories.ts` already
 * proves, with the same four guarantees:
 *
 *  - **It is never data.** Nothing here is sent to the API and nothing is
 *    written to the database, so no environment's feed can contain a demo post.
 *  - **It is namespaced.** Every id starts with {@link DEMO_POST_ID_PREFIX}, so
 *    a demo post is recognisable *before* any request could be made.
 *  - **It cannot claim verification.** No demo author is verified, no demo post
 *    carries a credential-verification URL, and there are no engagement counts
 *    anywhere in the model for a demo post to inflate.
 *  - **It is impossible in production.** The gate is compile-time `__DEV__` plus
 *    an `EXPO_PUBLIC_DEMO_FEED=off` kill switch (see {@link shouldShowDemoFeed}).
 *
 * It also states out loud what it is: every demo card renders a DEMO chip, the
 * section renders a note beneath its heading, and each embedded image carries a
 * "DEMO - ILLUSTRATIVE MOCKUP" watermark.
 *
 * Imports no React and no React Native, so every rule above is testable in plain
 * Node (`demoFeedPosts.test.ts`).
 */

import { NO_ENGAGEMENT, type FeedPost } from './feedModel';
import { DEMO_FEED_IMAGES } from './demoFeedAssets';

/** Namespace that makes a demo id impossible to confuse with a backend uuid. */
export const DEMO_POST_ID_PREFIX = 'demo-';

/** Text rendered on every demo card, so demo is never implicit. */
export const DEMO_POST_BADGE = 'DEMO';

/** Shown under a demo post's external links, whose targets do not exist. */
export const DEMO_EXTERNAL_LINK_NOTE =
  'Demo link â€” illustrative address, no such page exists.';

/** Why an author is not a real person, shown in place of a real headline. */
const DEMO_HEADLINE_SUFFIX = 'Demo profile';

export type DemoPost = FeedPost & { readonly origin: 'demo'; readonly demo: true };

/** True when `id` belongs to the local demo set rather than a posts API. */
export function isDemoPostId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith(DEMO_POST_ID_PREFIX);
}

/**
 * True for a demo post, whichever signal says so: the explicit `demo` flag, the
 * `origin` field, or the id namespace. All three are checked so a demo post can
 * never be mistaken for real content by a screen that holds only one of them.
 */
export function isDemoPost(
  post: { readonly id: string } & Partial<Pick<FeedPost, 'origin'>> & { readonly demo?: boolean },
): boolean {
  return post.demo === true || post.origin === 'demo' || isDemoPostId(post.id);
}

/**
 * Whether demo posts may be rendered.
 *
 * Production is a hard `false` regardless of the environment variable, because
 * `__DEV__` is a compile-time constant: a release bundle can never render them.
 * In development the flag is on unless explicitly switched off, so
 * `EXPO_PUBLIC_DEMO_FEED` accepts `off`, `0`, or `false` as the kill switch.
 */
export function shouldShowDemoFeed(options: {
  readonly isDev: boolean;
  readonly flag?: string | null;
}): boolean {
  if (!options.isDev) return false;
  const flag = options.flag?.trim().toLowerCase();
  return flag !== 'off' && flag !== '0' && flag !== 'false';
}

/** The runtime answer, used by the feed; the rules above stay pure for tests. */
export function isDemoFeedEnabled(): boolean {
  return shouldShowDemoFeed({
    // `typeof` keeps this safe in Node, where `__DEV__` is not a global.
    isDev: typeof __DEV__ !== 'undefined' && __DEV__ === true,
    flag: process.env.EXPO_PUBLIC_DEMO_FEED,
  });
}

/** An ISO instant a whole number of days (and hours) before `nowIso`. */
function isoBefore(nowIso: string, days: number, hours = 0): string {
  const base = Date.parse(nowIso);
  const safeBase = Number.isNaN(base) ? Date.now() : base;
  return new Date(safeBase - days * 86_400_000 - hours * 3_600_000).toISOString();
}

/** A demo author. Fictional: no verification, and no profile route to open. */
function demoAuthor(name: string, headline: string) {
  return {
    name,
    // Deliberately null rather than a made-up handle. A demo post that carried a
    // real-looking `@name` could be mistaken for a real account, and the ids
    // namespace alone does not protect the text a reader sees.
    username: null,
    publicId: null,
    headline: `${DEMO_HEADLINE_SUFFIX} Â· ${headline}`,
    // No avatar URL: an initials bubble is honest, a stock face is not.
    avatarUrl: null,
    // There is no other-user profile screen, so a demo name is not tappable.
    profileHref: null,
    // No verification service exists, so nothing can be verified â€” ever.
    verified: false,
  };
}

/**
 * The four demo posts, built fresh so their relative times read as recent
 * whenever the app is opened rather than as the day this file was written.
 *
 * The set deliberately covers all four card types â€” project, achievement,
 * image, text â€” so every renderer, the multi-image count, the See-more control,
 * and the full-screen viewer are all reviewable in development.
 */
export function createDemoFeedPosts(nowIso: string): DemoPost[] {
  const projectShot = DEMO_FEED_IMAGES['campus-event-platform'];
  const certificateShot = DEMO_FEED_IMAGES['certificate-course-completion'];
  const workshopOne = DEMO_FEED_IMAGES['workshop-opening-session'];
  const workshopTwo = DEMO_FEED_IMAGES['workshop-hackathon-day-one'];
  const workshopThree = DEMO_FEED_IMAGES['workshop-open-source-drive'];

  const posts: DemoPost[] = [
    {
      id: `${DEMO_POST_ID_PREFIX}campus-event-platform`,
      kind: 'project',
      category: 'projects',
      origin: 'demo',
      demo: true,
      title: 'Campus Event Platform',
      body: 'A booking and check-in platform for college fests. Students reserve seats, organisers approve them, and the door team scans a QR code at the gate â€” replacing the spreadsheet we used last year.',
      media: [
        {
          id: 'demo-media-campus-event-platform',
          kind: 'image',
          uri: projectShot.uri,
          width: projectShot.width,
          height: projectShot.height,
          alt: 'Illustrative mockup of an events dashboard with a sidebar, three summary cards, and a list of registered events.',
        },
      ],
      project: {
        title: 'Campus Event Platform',
        description: 'Seat booking, approval, and QR check-in for campus events.',
        technologies: ['React', 'FastAPI', 'PostgreSQL', 'Docker'],
        category: 'Web Development',
        status: 'Academic project',
        team: 'Team project Â· 4 students',
        role: 'Backend and database',
        sourceUrl: 'https://github.com/example-org/campus-event-platform',
        liveUrl: null,
      },
      achievement: null,
      tags: ['WebDevelopment', 'CampusTech', 'FinalYearProject'],
      createdAt: isoBefore(nowIso, 1, 3),
      author: demoAuthor('Rohan Deshmukh', 'B.Tech CSE, final year'),
      // Demo content has no server behind it, so a number here would be invented.
      engagement: NO_ENGAGEMENT,
    },

    {
      id: `${DEMO_POST_ID_PREFIX}fullstack-certificate`,
      kind: 'achievement',
      category: 'achievements',
      origin: 'demo',
      demo: true,
      title: 'Full-Stack Web Development Certificate',
      body: 'Finished the six-month track and passed the final assessment. The deployment module was the part that finally made CI feel worth the setup time.',
      media: [
        {
          id: 'demo-media-fullstack-certificate',
          kind: 'image',
          uri: certificateShot.uri,
          width: certificateShot.width,
          height: certificateShot.height,
          alt: 'Illustrative mockup of a certificate of completion with a seal, a signature line, and a date line.',
        },
      ],
      project: null,
      achievement: {
        title: 'Full-Stack Web Development',
        issuer: 'Demo Academy of Technology',
        achievedOn: isoBefore(nowIso, 2),
        description:
          'A six-month course covering front-end fundamentals, REST APIs, relational databases, testing, and deployment.',
        // Deliberately empty: no credential verification service exists, so a
        // demo post must not imply that its certificate can be verified.
        verificationUrl: null,
      },
      tags: ['WebDevelopment', 'Certification'],
      createdAt: isoBefore(nowIso, 2, 5),
      author: demoAuthor('Priya Sharma', 'B.Sc IT, 3rd year'),
      // Demo content has no server behind it, so a number here would be invented.
      engagement: NO_ENGAGEMENT,
    },

    {
      id: `${DEMO_POST_ID_PREFIX}accessibility-workshop`,
      kind: 'image',
      category: 'community',
      origin: 'demo',
      demo: true,
      title: null,
      body: 'Snapshots from the accessibility workshop our club ran this weekend. Three photos: the opening session, hackathon day one, and the open-source contribution drive.',
      media: [
        {
          id: 'demo-media-workshop-1',
          kind: 'image',
          uri: workshopOne.uri,
          width: workshopOne.width,
          height: workshopOne.height,
          alt: 'Illustrative mockup of a workshop room with a banner, a projector screen, and seated rows.',
        },
        {
          id: 'demo-media-workshop-2',
          kind: 'image',
          uri: workshopTwo.uri,
          width: workshopTwo.width,
          height: workshopTwo.height,
          alt: 'Illustrative mockup of a hackathon room with a green accent banner and a projector screen.',
        },
        {
          id: 'demo-media-workshop-3',
          kind: 'image',
          uri: workshopThree.uri,
          width: workshopThree.width,
          height: workshopThree.height,
          alt: 'Illustrative mockup of an open-source drive with an amber accent banner and a projector screen.',
        },
      ],
      project: null,
      achievement: null,
      tags: ['Workshop', 'Accessibility', 'CampusLife'],
      createdAt: isoBefore(nowIso, 4, 2),
      author: demoAuthor('Aarav Iyer', 'Computer Engineering, 2nd year'),
      // Demo content has no server behind it, so a number here would be invented.
      engagement: NO_ENGAGEMENT,
    },

    {
      id: `${DEMO_POST_ID_PREFIX}looking-for-collaborators`,
      kind: 'text',
      category: 'community',
      origin: 'demo',
      demo: true,
      title: null,
      body: 'Looking for two collaborators for a semester project on timetable scheduling. I have the backend roughly sketched out, but I am stuck on how to model room and faculty constraints so the solver stays fast once the department has a few hundred slots. Has anyone here solved a constraint problem this size, and would you use a solver library or write the heuristics yourself? Happy to share the repository once it is cleaned up.',
      media: [],
      project: null,
      achievement: null,
      tags: ['OpenSource', 'Algorithms', 'TeamUp'],
      createdAt: isoBefore(nowIso, 6, 7),
      author: demoAuthor('Neha Kulkarni', 'MCA, 1st year'),
      // Demo content has no server behind it, so a number here would be invented.
      engagement: NO_ENGAGEMENT,
    },
  ];

  return posts;
}

