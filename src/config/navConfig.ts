/**
 * Route inventory — the single source of truth for every screen in the app.
 *
 * This module is deliberately pure data with no React and no expo-router import,
 * so it can be unit tested in Node (see `routes.test.ts`) and asserted against
 * the files on disk. Three rules are enforced by those tests:
 *
 *  1. **Every tab resolves to a real screen.** A tab whose route does not exist
 *     as a file is a dead navigation item, which is the failure mode this
 *     inventory exists to prevent.
 *  2. **Candidate and employer never mix.** The two tab sets are disjoint
 *     except for the shared entry route, and each role's detail routes live in
 *     that role's own group directory.
 *  3. **A screen is either real or an honest notice.** `dataSource: 'none'`
 *     marks a screen whose backend domain does not exist yet; those render
 *     `StageScreen` and are never given invented content.
 *
 * Route groups mirror the web app's shells (`docs/ARCHITECTURE.md` §7):
 * `(candidate)` and `(employer)` are separate authenticated trees, so a
 * candidate physically cannot reach an employer screen even by deep link.
 */

/** Which roles may open a route. `both` is only used by the shared entry screen. */
export type RouteRole = 'candidate' | 'employer' | 'both';

export interface TabDefinition {
  /** Route name inside the role's group, e.g. `home`. */
  name: string;
  /** Absolute path used for navigation, e.g. `/home`. */
  path: string;
  label: string;
  icon: { ios: string; android: string };
  /** Optional outlined icon used for the inactive state in polished tab bars. */
  iconOutline?: { ios: string; android: string };
  /** `true` when the tab is backed by a real API response today. */
  implemented: boolean;
}

export const CANDIDATE_TABS: readonly TabDefinition[] = [
  {
    name: 'home',
    path: '/home',
    label: 'Home',
    icon: { ios: 'house.fill', android: 'home' },
    iconOutline: { ios: 'house', android: 'home' },
    implemented: true,
  },
  {
    name: 'jobs',
    path: '/jobs',
    label: 'Jobs',
    icon: { ios: 'briefcase.fill', android: 'work' },
    iconOutline: { ios: 'briefcase', android: 'work_outline' },
    implemented: false,
  },
  {
    name: 'messages',
    path: '/messages',
    label: 'Messages',
    icon: { ios: 'bubble.left.and.bubble.right.fill', android: 'chat' },
    iconOutline: { ios: 'bubble.left.and.bubble.right', android: 'chat_bubble_outline' },
    implemented: true,
  },
  {
    name: 'learn',
    path: '/learn',
    label: 'Learn',
    icon: { ios: 'book.fill', android: 'school' },
    iconOutline: { ios: 'book', android: 'school' },
    implemented: true,
  },
  {
    name: 'profile',
    path: '/profile',
    label: 'Profile',
    icon: { ios: 'person.crop.circle.fill', android: 'person' },
    iconOutline: { ios: 'person.crop.circle', android: 'person_outline' },
    implemented: true,
  },
];

/**
 * The Learning Hub's own internal bar — exactly four destinations, nested
 * inside the candidate tree under `learn/`.
 *
 * These are declared here for the same reason the role tab sets are: the route
 * inventory is the single source of truth, so `routeTree.test.ts` can assert
 * that every hub destination has a screen file and that no screen file is
 * unreachable. `name` is the screen name **relative to the hub's own
 * `_layout.tsx`** (`learn/index.tsx` serves `/learn`), which is what a nested
 * `<Tabs.Screen name=…>` needs — `learningHubScreenNameForPath` resolves it
 * from the path so the mapping lives in one place, exactly like
 * `screenNameForPath` does for the role shells.
 *
 * `implemented` keeps its inventory meaning: true only when a real API
 * response backs the tab today. Upload and Saved are honest stage screens —
 * neither lecture publishing nor a saved-items router exists on the server.
 */
export const LEARNING_HUB_TABS: readonly TabDefinition[] = [
  {
    name: 'home',
    path: '/home',
    label: 'Home',
    icon: { ios: 'house.fill', android: 'home' },
    iconOutline: { ios: 'house', android: 'home' },
    implemented: true,
  },
  {
    name: 'index',
    path: '/learn',
    label: 'Lectures',
    icon: { ios: 'play.rectangle.fill', android: 'video_library' },
    iconOutline: { ios: 'play.rectangle', android: 'video_library' },
    implemented: true,
  },
  {
    name: 'courses',
    path: '/learn/courses',
    label: 'Courses',
    icon: { ios: 'book.fill', android: 'menu_book' },
    iconOutline: { ios: 'book', android: 'menu_book' },
    implemented: true,
  },
  {
    name: 'upload',
    path: '/learn/upload',
    label: 'Upload',
    icon: { ios: 'square.and.arrow.up.fill', android: 'file_upload' },
    iconOutline: { ios: 'square.and.arrow.up', android: 'file_upload' },
    implemented: true,
  },
  {
    name: 'saved',
    path: '/learn/saved',
    label: 'Saved',
    icon: { ios: 'bookmark.fill', android: 'bookmark' },
    iconOutline: { ios: 'bookmark', android: 'bookmark' },
    implemented: true,
  },
];

/** The hub layout directory inside the candidate group, for the route tests. */
export const LEARNING_HUB_GROUP_PATH = '/learn';

/**
 * The nested navigator's screen name for a declared hub path.
 *
 *   `/learn`          -> `index`   (app/(candidate)/learn/index.tsx)
 *   `/learn/courses`  -> `courses` (app/(candidate)/learn/courses.tsx)
 *
 * The mirror of `screenNameForPath`, scoped to the hub: expo-router strips the
 * group directory, and a nested layout addresses its children relative to its
 * own directory, so only the segment below `/learn` remains — with the root
 * route's file name (`index`) as the special case.
 */
export function learningHubScreenNameForPath(path: string): string {
  const rest = path.replace(/^\/learn\/?/, '');
  return rest === '' ? 'index' : rest;
}

export const EMPLOYER_TABS: readonly TabDefinition[] = [
  {
    name: 'home',
    path: '/employer/home',
    label: 'Dashboard',
    icon: { ios: 'chart.bar.fill', android: 'dashboard' },
    implemented: true,
  },
  {
    name: 'company',
    path: '/employer/company',
    label: 'Company',
    icon: { ios: 'building.2.fill', android: 'business' },
    implemented: true,
  },
  {
    name: 'jobs',
    path: '/employer/jobs',
    label: 'Jobs',
    icon: { ios: 'briefcase.fill', android: 'work' },
    implemented: false,
  },
  {
    name: 'applicants',
    path: '/employer/applicants',
    label: 'Applicants',
    icon: { ios: 'person.2.fill', android: 'group' },
    implemented: false,
  },
  {
    name: 'more',
    path: '/employer/more',
    label: 'More',
    icon: { ios: 'ellipsis.circle.fill', android: 'more_horiz' },
    implemented: true,
  },
];

/**
 * College tabs. A third tree, for the same reason the other two are separate: a
 * college is neither a candidate nor an employer, and its workspace is organised
 * around institutions and programs rather than jobs. Namespaced under
 * `/college/*` so a stale link into the candidate tree is a wrong-role bounce
 * rather than a half-rendered screen.
 */
export const COLLEGE_TABS: readonly TabDefinition[] = [
  {
    name: 'college/home',
    path: '/college/home',
    label: 'Dashboard',
    icon: { ios: 'chart.bar.fill', android: 'dashboard' },
    implemented: true,
  },
  {
    name: 'college/institution',
    path: '/college/institution',
    label: 'Institution',
    icon: { ios: 'building.2.fill', android: 'business' },
    implemented: true,
  },
  {
    name: 'college/programs',
    path: '/college/programs',
    label: 'Programs',
    icon: { ios: 'list.bullet.rectangle.fill', android: 'list' },
    implemented: true,
  },
  {
    name: 'college/more',
    path: '/college/more',
    label: 'More',
    icon: { ios: 'ellipsis.circle.fill', android: 'more_horiz' },
    implemented: true,
  },
];

export const COLLEGE_DETAIL_ROUTES: readonly DetailRoute[] = [
  { path: '/college/settings', title: 'Settings', implemented: true },
];

/**
 * Secondary (non-tab) routes per role. These are reached from within a tab —
 * a job detail, an applicant detail, a section editor — and deliberately carry
 * no tab bar, so they can never widen the visible navigation.
 */
export interface DetailRoute {
  path: string;
  title: string;
  implemented: boolean;
}

export const CANDIDATE_DETAIL_ROUTES: readonly DetailRoute[] = [
  { path: '/jobs/[id]', title: 'Job details', implemented: true },
  { path: '/story/[id]', title: 'Story', implemented: true },
  { path: '/course/[courseId]', title: 'Course', implemented: true },
  /**
   * A single lecture player inside a course. `courseId` is passed as a query
   * parameter so the screen can rebuild course context (curriculum, actions)
   * without fetching the course twice. Real server data from `GET /courses/{id}`;
   * the lecture itself is located within the course's ordered sections.
   */
  { path: '/lecture/[id]', title: 'Lecture', implemented: true },
    /**
     * A demo lesson preview — honest state for sample lessons that carry no
     * server lecture id and no media source. Playback is not available.
     */
    { path: '/learn/demo/[id]', title: 'Demo lesson', implemented: true },
  /**
   * My Learning — the caller's own enrolled courses, opened from the Learning
   * Hub header rather than a fifth tab (the bar stays at five). Real server
   * rows from `GET /courses/enrollments/mine`, so `implemented` is true.
   */
  { path: '/my-learning', title: 'My Learning', implemented: true },
  /**
   * A public person profile, opened from Home's people search. Keyed by the
   * immutable public id from `GET /users/lookup` — deliberately not `/profile`,
   * which always loads the caller's own aggregate and would show the wrong
   * person with edit controls.
   */
  { path: '/user/[id]', title: 'Profile', implemented: true },
  /**
   * A one-to-one conversation, opened from a Messages row or the supported
   * start-conversation flow. Keyed by the conversation id the server owns —
   * deliberately not `/user/[id]`, which names a person, not a thread.
   */
  { path: '/conversation/[id]', title: 'Conversation', implemented: true },
  /**
   * The active call screen, opened by starting a call from a conversation or by
   * answering an incoming one. Keyed by the call id the server owns — the row
   * is what the screen tracks (ringing → answered → ended), not a room name a
   * client could invent. Carries no tab bar, exactly like the conversation.
   */
  { path: '/call/[id]', title: 'Call', implemented: true },
  { path: '/applications', title: 'Applications', implemented: false },
  { path: '/community', title: 'Community', implemented: false },
  { path: '/saved', title: 'Saved', implemented: false },
  /**
   * Message-section destinations. The Message screen's Connections and
   * Companies tabs push here rather than widening the bottom bar, so each is a
   * detail route with no tab bar of its own. Connections is now the real
   * connection-request surface (incoming Accept/Decline, sent Cancel, accepted
   * list) on the main backend's `/connections`; Companies remains an honest
   * later-phase scaffold, so its `implemented` is false.
   */
  { path: '/connections', title: 'Connections', implemented: true },
  { path: '/companies', title: 'Companies', implemented: false },
  { path: '/add-post', title: 'Add post', implemented: true },
  /**
   * Story publication. Phase 12 added the screen because `POST /stories` had
   * always existed on the server with no mobile caller, which made a story
   * readable but never creatable.
   */
  { path: '/add-story', title: 'New story', implemented: true },
  { path: '/innovation-lab', title: 'Innovation Lab', implemented: false },
  { path: '/profile/skills', title: 'Skills', implemented: true },
  { path: '/profile/education', title: 'Education', implemented: true },
  { path: '/profile/experience', title: 'Experience', implemented: true },
  { path: '/profile/projects', title: 'Projects', implemented: true },
  { path: '/profile/certifications', title: 'Certificates', implemented: true },
  { path: '/profile/achievements', title: 'Achievements', implemented: true },
  { path: '/profile/preferences', title: 'Career preferences', implemented: true },
  { path: '/profile/edit', title: 'Edit profile', implemented: true },
  { path: '/notifications', title: 'Notifications', implemented: true },
  { path: '/settings', title: 'Settings', implemented: true },
];

export const EMPLOYER_DETAIL_ROUTES: readonly DetailRoute[] = [
  { path: '/employer/jobs/new', title: 'Post a job', implemented: false },
  { path: '/employer/jobs/[id]', title: 'Manage job', implemented: false },
  { path: '/employer/applicants/[id]', title: 'Applicant details', implemented: false },
  { path: '/employer/messages', title: 'Messages', implemented: false },
  { path: '/employer/notifications', title: 'Notifications', implemented: false },
  { path: '/employer/settings', title: 'Settings', implemented: true },
];

/** Public routes, listed so the root stack and the tests agree on the inventory. */
export const PUBLIC_ROUTES: readonly string[] = [
  '/',
  '/login',
  '/signup',
  '/reset-password',
  '/boot',
  /**
   * The wizard lives in the root stack, outside every role tree. That placement is
   * what makes it escapable: a role layout can redirect *out* to `/onboarding`, but
   * the onboarding screen is not itself behind a role layout, so it cannot be
   * redirected back into the tree it just bounced somebody out of. Putting it
   * inside a role group would guarantee a redirect loop.
   */
  '/onboarding',
  '/onboarding-complete',
];

/** The roles that have their own authenticated tree. */
export type AppRole = 'candidate' | 'employer' | 'college';

export function tabsForRole(role: AppRole): readonly TabDefinition[] {
  if (role === 'candidate') return CANDIDATE_TABS;
  if (role === 'college') return COLLEGE_TABS;
  return EMPLOYER_TABS;
}

export function detailRoutesForRole(role: AppRole): readonly DetailRoute[] {
  if (role === 'candidate') return CANDIDATE_DETAIL_ROUTES;
  if (role === 'college') return COLLEGE_DETAIL_ROUTES;
  return EMPLOYER_DETAIL_ROUTES;
}

/** A detail route expressed the way expo-router names the screen behind it. */
export interface DetailScreen {
  /**
   * The screen name inside the role's group directory, which is what
   * `<Tabs.Screen name=...>` needs.
   */
  name: string;
  title: string;
  implemented: boolean;
}

/**
 * The expo-router screen name for a declared URL path.
 *
 * expo-router strips a route-group directory from the URL, so the screen name a
 * `<Tabs.Screen name=...>` needs is simply the declared path minus its leading
 * slash — measured from the group layout, not from the URL root. The employer
 * tree keeps a literal `employer/` segment on disk (`app/(employer)/employer/…`)
 * so its routes stay namespaced, and that segment *is* part of the route name:
 *
 *   `/profile/skills`     -> the screen `profile/skills` in `(candidate)`
 *   `/employer/settings`  -> the screen `employer/settings` in `(employer)`
 *
 * This takes no role argument on purpose: both shells resolve names the same way,
 * and the role is already carried by the path. Stripping the `employer` prefix
 * here (as this function used to) named a route that does not exist, so the
 * employer shell declared screens the navigator could not find and every
 * `/employer/*` push resolved to "Unmatched Route".
 */
export function screenNameForPath(path: string): string {
  return path.replace(/^\//, '');
}

/**
 * Every detail route for a role, in the shape the shells need.
 *
 * The shells must declare these explicitly. expo-router's `Tabs` injects *every*
 * route it discovers under a Tabs layout into the tab navigator, and the only
 * way to keep a screen out of the bar is to declare it with `href: null`. Left
 * implicit, the seven candidate detail screens would each add a tab-bar item and
 * the bar would carry twelve entries instead of the documented five.
 */
export function detailScreensForRole(role: AppRole): readonly DetailScreen[] {
  return detailRoutesForRole(role).map((route) => ({
    name: screenNameForPath(route.path),
    title: route.title,
    implemented: route.implemented,
  }));
}

/**
 * Every route name inside both authenticated groups, for the layouts that must
 * declare routes they do not show (see `routeTree.test.ts`).
 */
export const APP_TAB_NAMES: readonly string[] = [
  ...new Set([...CANDIDATE_TABS, ...EMPLOYER_TABS, ...COLLEGE_TABS].map((tab) => tab.name)),
];
