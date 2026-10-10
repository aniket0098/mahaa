/**
 * Discover — the pure model behind the candidate opportunity screen.
 *
 * Everything here is a function of its arguments with no React and no Expo, so
 * it runs in Node under Vitest (see `discoverFilters.test.ts`) and can never
 * drift from what the API actually accepts. The screen, the cards and the
 * detail route all read from this file rather than re-deriving labels, filter
 * keys, or formatting, so there is exactly one place a wire value becomes a
 * human sentence.
 *
 * **Only filters the backend supports are modelled.** `GET /opportunities`
 * (`backend/app/api/v1/endpoints/opportunities.py`) accepts exactly `type`,
 * `work_mode`, `q`, `page`, `page_size` — nothing else. A salary, experience,
 * industry, skill, or location filter would be a control that cannot affect
 * the results, so none is offered here.
 *
 * Source of truth for the value sets: `src/types/opportunity.ts`, kept in
 * strict parity with `backend/app/schemas/opportunities.py` and
 * `backend/app/models/enums.py`.
 */

import type {
  CompPeriod,
  EmploymentType,
  Opportunity,
  OpportunityType,
  WorkMode,
} from '@/types/opportunity';
import type { FastApiPage } from '@/types/story';

/* ============================ Categories ============================ */

export interface DiscoverCategory {
  /** Stable id used as React key and in the selected-state comparison. */
  readonly id: string;
  /** Visible chip label. */
  readonly label: string;
  /** The API `type` this category maps to, or undefined for "All" (no filter). */
  readonly type?: OpportunityType;
  /**
   * SF Symbol (iOS) / Material icon (Android) shown beside the label. The label
   * still carries the meaning — the icon is never the only signal — but it makes
   * five same-shaped chips scannable at a glance. Both names are required because
   * `AppIcon` renders SF Symbols on iOS and Material symbols on Android.
   */
  readonly icon: { ios: string; android: string };
}

/**
 * The five in-page categories. Four map to real `OpportunityType` values; "All"
 * deliberately carries no type so the request omits the parameter and the feed
 * returns everything, exactly as `fetchOpportunities` treats an absent `type`.
 */
export const DISCOVER_CATEGORIES: readonly DiscoverCategory[] = [
  { id: 'all', label: 'All', icon: { ios: 'square.grid.2x2', android: 'grid_view' } },
  { id: 'jobs', label: 'Jobs', type: 'job', icon: { ios: 'briefcase.fill', android: 'work' } },
  {
    id: 'internships',
    label: 'Internships',
    type: 'internship',
    icon: { ios: 'graduationcap.fill', android: 'school' },
  },
  {
    id: 'apprenticeships',
    label: 'Apprenticeships',
    type: 'apprenticeship',
    icon: { ios: 'wrench.and.screwdriver.fill', android: 'build' },
  },
  {
    id: 'projects-gigs',
    label: 'Projects & Gigs',
    type: 'project_gig',
    icon: { ios: 'rocket.fill', android: 'rocket_launch' },
  },
];

export const DEFAULT_CATEGORY_ID = 'all';

/** The API `type` a category id maps to, or undefined for "All"/unknown. */
export function categoryToType(categoryId: string): OpportunityType | undefined {
  return DISCOVER_CATEGORIES.find((category) => category.id === categoryId)?.type;
}

/* ============================ Label vocabularies ============================ */

export const OPPORTUNITY_TYPE_LABELS: Record<OpportunityType, string> = {
  job: 'Job',
  internship: 'Internship',
  apprenticeship: 'Apprenticeship',
  project_gig: 'Project & gig',
};

export const WORK_MODE_LABELS: Record<WorkMode, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
};

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  internship: 'Internship',
  contract: 'Contract',
};

export const COMP_PERIOD_LABELS: Record<CompPeriod, string> = {
  hour: 'hour',
  month: 'month',
  year: 'year',
};

/* ============================ Filter state -> query ============================ */

/**
 * The discover screen's filter state, kept as one value so the query key is a
 * pure function of it and the two can never disagree.
 */
export interface DiscoverFilterState {
  /** Selected category id (see {@link DISCOVER_CATEGORIES}). */
  category: string;
  /** Selected `work_mode`, or null for "Any". */
  workMode: WorkMode | null;
  /** The (debounced) search text; empty means no `q`. */
  query: string;
}

/**
 * The cache-key/fetch record for a filter state.
 *
 * Keys mirror the camelCase field names `fetchOpportunities` accepts
 * (`type`, `workMode`, `query`) so the record can be spread into the request.
 * Absent/empty fields are omitted rather than stored as undefined/empty, so
 * the key is identical whether a field was never touched or was cleared, and a
 * cleared filter is genuinely a new query rather than a differently-keyed one.
 */
export function filterToQueryRecord(state: DiscoverFilterState): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  const type = categoryToType(state.category);
  if (type) record.type = type;
  if (state.workMode) record.workMode = state.workMode;
  const query = state.query.trim();
  if (query) record.query = query;
  return record;
}

/** Reads the fetch params back out of the record the key was built from. */
export function recordToFetchParams(record: Record<string, unknown>): {
  type?: OpportunityType;
  workMode?: WorkMode;
  query?: string;
} {
  return {
    type: record.type as OpportunityType | undefined,
    workMode: record.workMode as WorkMode | undefined,
    query: record.query as string | undefined,
  };
}

/**
 * The active facets of a filter state, in a stable order, as removable chips.
 *
 * Each facet carries the id the results summary uses as a React key and an
 * `onRemove` the screen supplies; only "All / any / no search" produces none,
 * so the summary never shows a chip that would not change the results. The
 * search facet shows the trimmed term, and the others their human label — the
 * same vocabulary the API request is built from, so a chip always names a real
 * narrowing of the feed.
 */
export interface DiscoverFacet {
  readonly id: 'query' | 'category' | 'workMode';
  readonly label: string;
  readonly onRemove: () => void;
}

export function activeFacets(state: DiscoverFilterState, remove: {
  onClearSearch: () => void;
  onClearCategory: () => void;
  onClearWorkMode: () => void;
}): DiscoverFacet[] {
  const facets: DiscoverFacet[] = [];
  const query = state.query.trim();
  if (query) facets.push({ id: 'query', label: `“${query}”`, onRemove: remove.onClearSearch });
  const category = DISCOVER_CATEGORIES.find((item) => item.id === state.category);
  if (category?.type) facets.push({ id: 'category', label: category.label, onRemove: remove.onClearCategory });
  if (state.workMode) {
    facets.push({ id: 'workMode', label: WORK_MODE_LABELS[state.workMode], onRemove: remove.onClearWorkMode });
  }
  return facets;
}

/**
 * The next 1-based page to fetch, or undefined when the feed is exhausted.
 *
 * The envelope is `FastApiPage` (`{page, page_size, pages}`), and `pages` is
 * `ceil(total / page_size)` — so `page < pages` is exactly "there is another
 * page". An empty feed has `pages: 0`, so this returns undefined immediately.
 */
export function nextPageParam(lastPage: FastApiPage<Opportunity>): number | undefined {
  return lastPage.page < lastPage.pages ? lastPage.page + 1 : undefined;
}

/* ============================ Formatting ============================ */

/** Thousands grouping without relying on `Intl`, so it is deterministic everywhere. */
function groupThousands(value: number): string {
  const rounded = Number.isInteger(value) ? value : Math.round(value * 100) / 100;
  const [intPart, fracPart] = String(rounded).split('.');
  const grouped = (intPart ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return fracPart ? `${grouped}.${fracPart}` : grouped;
}

/**
 * A human compensation string, or null when neither figure is set.
 *
 * Only what the API returns is shown: a min alone reads "₹X+", a max alone
 * "Up to ₹X", both "₹X – ₹Y", and the period (if any) is appended. Null stays
 * null — a posting with no compensation says nothing rather than guessing.
 */
export function formatCompensation(
  min: number | null,
  max: number | null,
  currency: string | null,
  period: CompPeriod | null,
): string | null {
  if (min == null && max == null) return null;
  const symbol = currency ? `${currency} ` : '';
  const suffix = period ? ` / ${COMP_PERIOD_LABELS[period]}` : '';
  let range: string;
  if (min != null && max != null) {
    // The currency is stated once, before the range, rather than on each bound.
    range = `${symbol}${groupThousands(min)} – ${groupThousands(max)}`;
  } else if (min != null) {
    range = `${symbol}${groupThousands(min)}+`;
  } else {
    range = `Up to ${symbol}${groupThousands(max as number)}`;
  }
  return `${range}${suffix}`;
}

const MONTH_ABBREVIATIONS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * A deadline's display state:
 *   - `normal` — more than a week out, shown in the neutral tone;
 *   - `soon`   — today through seven days out, shown amber ("closing soon");
 *   - `past`   — before today, shown red.
 * `isPast` is kept as the single source of truth for the boolean; `urgency` is
 * derived from it plus the day gap, so no caller recomputes either.
 */
export type DeadlineUrgency = 'normal' | 'soon' | 'past';

export interface DeadlineInfo {
  readonly label: string;
  /** True once the deadline day is before today — the card marks these. */
  readonly isPast: boolean;
  /** The card's tone: `soon` is today..7 days out, `past` is before today. */
  readonly urgency: DeadlineUrgency;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Parses `YYYY-MM-DD` as a *local* date so a deadline never shifts a day. */
function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Apply by 12 Oct 2026", plus whether that day has already passed, and its tone. */
export function formatDeadline(deadline: string | null, now: Date = new Date()): DeadlineInfo | null {
  if (!deadline) return null;
  const date = parseLocalDate(deadline);
  if (!date) return null;
  const isPast = startOfDay(date).getTime() < startOfDay(now).getTime();
  // Whole days from today to the deadline, rounded so a partial day reads as a
  // full one and "today" is 0. `soon` covers today through seven days out.
  const daysUntil = Math.round((startOfDay(date).getTime() - startOfDay(now).getTime()) / 86_400_000);
  const urgency: DeadlineUrgency = isPast ? 'past' : daysUntil <= 7 ? 'soon' : 'normal';
  return {
    label: `Apply by ${date.getDate()} ${MONTH_ABBREVIATIONS[date.getMonth()]} ${date.getFullYear()}`,
    isPast,
    urgency,
  };
}

/** A compact relative age ("Posted 3d ago"), or null when there is no timestamp. */
export function formatRelativePublishedAt(
  publishedAt: string | null,
  now: Date = new Date(),
): string | null {
  if (!publishedAt) return null;
  const then = new Date(publishedAt);
  if (Number.isNaN(then.getTime())) return null;
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/** True only for the one server value that means "verified" — never assumed. */
export function companyIsVerified(verificationStatus: string | null | undefined): boolean {
  return verificationStatus === 'verified';
}
