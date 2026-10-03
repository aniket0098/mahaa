/**
 * Browse/search state for the onboarding skill picker — pure, so it is unit
 * testable in Node.
 *
 * Kept separate from `SkillsStep.tsx` for the same reason `connectionHints.ts` is
 * kept away from `useApiConnection`: the component imports `react-native`, and a
 * Node test that reached it would pull React Native's Flow sources into the
 * runner.
 *
 * **The bug this models.** The picker used to run its catalogue query under
 * `enabled: query.trim().length > 0`, on the reasoning that listing the whole
 * catalogue was "a suggestion list nobody asked for". In practice it meant the
 * step opened on an empty card: a search box, a counter, and nothing else, for
 * somebody who does not yet know what the catalogue contains or how it is
 * spelled. People cannot search for a word they have never been shown. The
 * backend was already built for this — `search_catalog`'s own docstring says an
 * empty `q` "lists the whole catalogue, which is what the picker does before
 * anybody types" — so the frontend was the only thing standing in the way.
 *
 * Hence `catalogRequest('')`: an empty term is not "no request", it is a request
 * for the first browse page. `catalogMode` keeps "no term typed" and "a term
 * that matched nothing" as two different states, because they are: the first is
 * a catalogue to browse, the second is a dead end, and showing the same empty
 * message for both tells somebody their filter broke when it did not.
 */

/**
 * Rows per page.
 *
 * 24 is a deliberate choice, not a round number picked by eye:
 *  - it is above the old 12, so a browse page is a real selection rather than a
 *    teaser that hides most of the catalogue behind a button;
 *  - it is well under the server's `MAX_PAGE_LIMIT` (200) and under its default
 *    page size (100), so the request stays a fraction of what the endpoint
 *    allows and nothing is truncated;
 *  - the catalogue is 140 rows, so six taps of "Show more" reach the end while
 *    the first screenful still arrives immediately.
 */
export const CATALOG_PAGE_SIZE = 24;

/** Empty term = browsing the catalogue. Non-empty = filtering it. */
export type CatalogMode = 'browse' | 'search';

export interface CatalogRequest {
  /** The `q` to send. Empty string means "no filter", which the API reads as list-all. */
  q: string;
  limit: number;
  offset: number;
}

/** Trims the raw field, so `"  "` and `""` are the same thing: no filter typed. */
export function catalogTerm(raw: string): string {
  return raw.trim();
}

export function catalogMode(term: string): CatalogMode {
  return term.length > 0 ? 'search' : 'browse';
}

/**
 * The request the picker should be making right now.
 *
 * Always defined — including for an empty term. That is the whole fix: there is
 * no longer a state in which this step issues no catalogue request.
 */
export function catalogRequest(term: string, offset = 0): CatalogRequest {
  const q = catalogTerm(term);
  return {
    q,
    limit: CATALOG_PAGE_SIZE,
    // A negative or non-integer offset would be rejected by the server's
    // `ge=0` bound, so clamp rather than pass whatever the caller had.
    offset: Number.isInteger(offset) && offset > 0 ? offset : 0,
  };
}

/** What the list area should be showing. */
export type CatalogViewState = 'loading' | 'catalogue-empty' | 'no-matches' | 'results';

export interface CatalogViewInput {
  mode: CatalogMode;
  /** True once the query has produced a page at all (even an empty one). */
  hasData: boolean;
  isFetching: boolean;
  /** Rows accumulated across every page fetched so far. */
  shown: number;
}

export function catalogViewState({ mode, hasData, isFetching, shown }: CatalogViewInput): CatalogViewState {
  if (!hasData && isFetching) return 'loading';
  // No page yet and not fetching either: the query has not started. Treat it as
  // loading rather than as an empty catalogue, so the step never flashes "no
  // skills exist" on its way to loading one.
  if (!hasData) return 'loading';
  if (shown > 0) return 'results';
  // The distinction the old code could not make, because it never rendered a
  // browse view at all.
  return mode === 'search' ? 'no-matches' : 'catalogue-empty';
}

/**
 * The line above the list.
 *
 * Gives the two zero-result states their own honest wording and tells the user
 * how much catalogue is left to see, so a truncated list never reads as the
 * whole thing.
 */
export function catalogCaption(input: {
  mode: CatalogMode;
  term: string;
  shown: number;
  total: number;
}): string {
  const { mode, term, shown, total } = input;
  if (mode === 'search') {
    return total === 1 ? `1 match for “${term}”.` : `${total} matches for “${term}”.`;
  }
  if (shown >= total) return `All ${total} catalogue skills.`;
  return `Showing ${shown} of ${total} catalogue skills.`;
}

/** The label for the control that pulls the next page. */
export function showMoreLabel(shown: number, total: number): string {
  const remaining = Math.max(total - shown, 0);
  if (remaining === 1) return 'Show 1 more skill';
  return `Show ${remaining} more skills`;
}

/**
 * Catalogue ids the candidate already holds, for duplicate prevention.
 *
 * The browse view makes this necessary in a way the search-only view never did:
 * the list now stays on screen after an add, so a skill already on the profile
 * is still visible and must not offer a second "Add". Matching on `skill_id`
 * (not the row's own `id`) is what makes the two sides joinable.
 *
 * Takes the query's `items` directly, `undefined` included: that is the normal
 * state of a react-query result before it resolves or after it fails, so
 * handling it here keeps the call site from having to remember a `?? []` that a
 * future caller would silently forget.
 */
export function ownedSkillIds(
  skills: readonly { skill_id: string }[] | null | undefined,
): Set<string> {
  return new Set((skills ?? []).map((skill) => skill.skill_id));
}