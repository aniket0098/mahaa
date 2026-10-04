/**
 * Candidate step 2 — **About You**: education and skills on one screen.
 *
 * These were two consecutive required steps ("Education", then "Skills"). Both
 * wrote to the same profile through the same APIs, both remain independently
 * editable from `/profile/education` and `/profile/skills` (neither changed),
 * and neither is needed before the app is useful. Asking a brand-new user to fill
 * a degree form and then pick three catalogue skills before they had seen a single
 * screen of the product is what the old flow did; this asks for both in one place.
 *
 * **One screen, one save, one step.** Continue persists the education entry, then
 * lets the wizard advance. A rejection surfaces its own message and the person is
 * not moved past data that did not save. Completion still comes from the server's
 * count of real rows — this screen never decides that for itself.
 *
 * **Skills are a recommendation, not a gate**, and the server now agrees: the
 * `about` step completes on one real education row (`backend/.../onboarding.py`).
 * It previously also required `skills >= 3`, a condition this screen never asked
 * for, which is what produced the reported "That did not save" on a request that
 * had returned `201` — and Retry, which replays the same save, could never clear
 * it. `MIN_SKILLS` is the server's *completeness* threshold, not a validation
 * rule, and the copy below says so. Somebody with an education entry and no
 * catalogue match is not blocked.
 */

import { useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { addSkill, educationApi, fetchMySkills, searchSkillCatalog } from '@/api/profile';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import { saveFailureMessage } from '@/features/onboarding/aboutYouSave';
import { institutionError, normaliseEndDate } from '@/features/onboarding/educationForm';
import {
  DEGREE_MAX,
  INSTITUTION_MAX,
  MIN_SKILLS,
  stepStyles,
} from '@/features/onboarding/onboardingStyles';
import {
  catalogCaption,
  catalogMode,
  catalogRequest,
  catalogTerm,
  catalogViewState,
  ownedSkillIds,
  showMoreLabel,
} from '@/features/onboarding/skillsBrowse';
import type { EducationCreate, EducationLevel } from '@/types/profile';

/** The levels the server accepts, in the order they are offered. */
const LEVELS: readonly { value: EducationLevel; label: string }[] = [
  { value: 'undergraduate', label: 'Undergraduate' },
  { value: 'postgraduate', label: 'Postgraduate' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'doctorate', label: 'Doctorate' },
  { value: 'school', label: 'School' },
  { value: 'other', label: 'Other' },
];

export interface AboutYouStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}
export function AboutYouStep({ onNext, busy, canGoBack, onBack }: AboutYouStepProps) {
  const queryClient = useQueryClient();

  // --- Education half --------------------------------------------------------
  const [institution, setInstitution] = useState('');
  const [degree, setDegree] = useState('');
  const [level, setLevel] = useState<EducationLevel>('undergraduate');
  const [current, setCurrent] = useState(true);
  const [endDate, setEndDate] = useState('');
  /**
   * Set once this screen has saved one, so the form does not render as empty
   * afterwards and a second entry is not created on a second Continue.
   *
   * Also mirrored into a ref, because the save function runs later than the
   * render that produced it: `saveAll` is handed to the host once and re-invoked
   * by Retry, so a plain `useState` read inside it would still be the value from
   * the render that created the closure. The ref is always current.
   */
  const [educationSaved, setEducationSaved] = useState(false);
  const educationSavedRef = useRef(false);

  /**
   * The outcome of a skill add that the server refused, so it can be shown next
   * to the list it happened in.
   *
   * State rather than the mutation's `isError`, because several adds can be in
   * flight at once and react-query's `error` holds only the most recent one —
   * which is how a 404 from the second of three taps became invisible.
   */
  const [skillProblem, setSkillProblem] = useState<string | null>(null);

  /**
   * The exact row last handed to the server, kept so the banner's Retry can
   * resubmit *it*.
   *
   * `education.mutate()` with no argument was the old Retry, and the mutation
   * now takes its row as a parameter — so a bare call had nothing to send. The
   * retry has to be the same write, not merely a re-render.
   */
  const lastSubmitted = useRef<EducationCreate | null>(null);

  const existingEducation = useQuery({
    queryKey: queryKeys.education,
    // `educationApi.list` takes optional paging arguments, so it is wrapped rather
    // than passed directly: react-query would otherwise call it with its own
    // query-context object as the first parameter.
    queryFn: () => educationApi.list(),
  });
  const hasEducation = educationSaved || (existingEducation.data?.items.length ?? 0) > 0;

  /**
   * Takes the row as an argument rather than closing over the form fields.
   *
   * The values are read by `saveAll` at the moment of the save, which is the
   * only moment they are correct: a closure captured at render would submit
   * whatever the fields held when Continue was *wired up*, not what they hold
   * when it is pressed.
   */
  const education = useMutation({
    mutationFn: (row: EducationCreate) => educationApi.create(row),
    onSuccess: () => {
      educationSavedRef.current = true;
      setEducationSaved(true);
    },
  });

  // --- Skills half -----------------------------------------------------------
  const [query, setQuery] = useState('');
  const mine = useQuery({ queryKey: queryKeys.mySkills, queryFn: () => fetchMySkills() });
  const skillCount = mine.data?.items.length ?? 0;
  const owned = ownedSkillIds(mine.data?.items);

  // Trimmed once, here, so a stray space cannot silently turn a search into a
  // browse-all (or the reverse).
  const term = catalogTerm(query);
  const mode = catalogMode(term);

  /*
   * The same paging shape the old SkillsStep used, unchanged: the request object
   * carries `q`/`limit`/`offset`, the next page is the last page's offset plus its
   * own length, and the visible list is every fetched page flattened. `offset` —
   * not a page index — is what the server's `Page` envelope reports, so anything
   * that inferred "page 2" from an array index would silently skip rows.
   */
  const catalog = useInfiniteQuery({
    queryKey: queryKeys.skillCatalogBrowse(term),
    queryFn: ({ pageParam }) => {
      const page = catalogRequest(term, pageParam);
      return searchSkillCatalog(page.q, page.limit, page.offset);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.items.length : undefined,
  });

  const add = useMutation({
    // `level` is required by the create schema; 'intermediate' is what the old
    // step sent and what the Profile skills screen sends for a plain add.
    mutationFn: (skillId: string) => addSkill({ skill_id: skillId, level: 'intermediate' }),
    onSuccess: () => {
      // Only the skill list is affected. Invalidating the whole `profile` branch
      // would re-download the entire aggregate on every tap, which is the kind of
      // thing that turns adding three skills into fifteen requests.
      void queryClient.invalidateQueries({ queryKey: queryKeys.mySkills });
    },
  });

  /**
   * Adds are fired as they are tapped, and **their promises are kept**.
   *
   * `add.mutate(id)` resolves to `void` — it starts the request and returns — so
   * there was no handle on the three POSTs a person triggers by tapping three
   * skills. Continue then awaited only the education write, read the server's
   * step state while two skill writes were still in flight, saw the step as
   * still incomplete and raised "That did not register as saved". Holding the
   * promises is the fix: each add stores its own, and the save drains them
   * before it asks the server whether the step is complete.
   *
   * **The rejections are kept, not flattened to `undefined`.** The old
   * `.catch(() => undefined)` made every failure indistinguishable from
   * success, which is precisely what let a genuinely failed skill POST vanish
   * behind a message about the *education* save. Each entry now carries its own
   * outcome, so `saveAll` can report which skill did not save and why.
   */
  const pendingAdds = useRef<Promise<{ ok: boolean; message?: string }>[]>([]);
  const addSkillNow = (skillId: string) => {
    pendingAdds.current.push(
      add
        .mutateAsync(skillId)
        .then(() => ({ ok: true }))
        .catch((error: unknown) => ({
          ok: false,
          message:
            error instanceof ApiError ? error.message : 'That skill could not be added.',
        })),
    );
  };

  const errors = fieldErrors(education.error);
  // Every fetched page, flattened — matching what was on screen before the merge.
  const items = catalog.data?.pages.flatMap((page) => page.items) ?? [];
  const view = catalogViewState({
    mode,
    hasData: Boolean(catalog.data),
    isFetching: catalog.isFetching,
    shown: items.length,
  });
  const lastPage = catalog.data?.pages[catalog.data.pages.length - 1];
  const total = lastPage?.total ?? 0;

  /**
   * Persist whatever is filled in, then let the wizard move on.
   *
   * **Order matters, and so does waiting.** Skill adds are already on the wire by
   * the time this runs — they are fired as the user taps, because the list has to
   * respond to the tap — so this drains those in-flight writes *first*. Only then
   * is the education entry written. Awaiting the education write alone (the
   * previous behaviour) let Continue race the skill writes.
   *
   * **The step's gate is education, and this function satisfies it.** That
   * agreement is the fix for the reported "That did not save" on a `201`:
   * `about` was completing on `education > 0 and skills >= 3`, a condition this
   * screen never asked for and could not reason about, so a correct save read as
   * a failed one and Retry — which replays this exact function — could never
   * clear it. Skills are collected here as a recommendation and reported when
   * they fail; they are not part of what this step requires.
   *
   * A failed skill write is not retried and does not abort the education write:
   * it is surfaced next to the list it was tapped in.
   */
  const saveAll = async () => {
    const inFlight = pendingAdds.current;
    pendingAdds.current = [];
    const outcomes = await Promise.all(inFlight);

    /*
     * A failed skill add is reported rather than swallowed, and it does **not**
     * stop the education write.
     *
     * The old code drained with `.catch(() => undefined)`, so a 404 from a stale
     * catalogue id and a 201 were the same value. The step then advanced on a
     * skill that was never stored, or reported the education save as the thing
     * that failed. Skills are a recommendation rather than a gate, so a failed
     * add must never block the person — but it must be *said*, next to the list
     * they tapped it in.
     */
    const failed = outcomes.filter((outcome) => !outcome.ok);
    if (failed.length > 0) {
      setSkillProblem(
        failed[0].message ?? 'That skill could not be added. You can add it again.',
      );
    }

    /*
     * `hasEducation` is re-read from the server immediately before the write,
     * not from the render's cached value.
     *
     * This is the duplicate-row bug. `existingEducation` is a 30-second-fresh
     * query that nothing invalidated after a successful create, so a Retry —
     * which replays this same function — saw `hasEducation === false` and
     * created a *second* identical row. Verified against the running API before
     * the fix: two Continues left two rows with the same institution. One
     * request here, whose answer is authoritative, removes the ambiguity
     * entirely; the cache is only ever a hint about what to render.
     */
    if (institutionError(institution) === null) {
      const alreadySaved = await queryClient.fetchQuery({
        queryKey: queryKeys.education,
        queryFn: () => educationApi.list(),
        staleTime: 0,
      });
      if (alreadySaved.items.length === 0 && !educationSavedRef.current) {
        const result = normaliseEndDate(endDate);
        if (result.kind === 'invalid') {
          throw new Error(result.message);
        }
        const row: EducationCreate = {
          institution: institution.trim(),
          degree: degree.trim() || null,
          level,
          current,
          // A still-studying entry has no end date, and the server's own rule is
          // that "current" and "has an end date" cannot both be true.
          end_date: current || result.kind === 'empty' ? null : result.value,
        };
        lastSubmitted.current = row;
        await education.mutateAsync(row);
        educationSavedRef.current = true;
        void queryClient.invalidateQueries({ queryKey: queryKeys.education });
      }
    }
  };

  const busyNow = busy || education.isPending || add.isPending;
  const ready = hasEducation || institutionError(institution) === null;

  /*
   * Parsed once per render so the field and the save cannot disagree about
   * what the field contains. Only a local `invalid` result renders; `empty` and
   * `ok` are both fine to submit.
   */
  const endDateResult = useMemo(() => normaliseEndDate(endDate), [endDate]);
  const endDateError = endDateResult.kind === 'invalid' ? endDateResult.message : null;

  return (
    <StepBody
      onNext={() => onNext(saveAll)}
      ready={ready}
      busy={busyNow}
      canGoBack={canGoBack}
      onBack={onBack}>
      {education.isError ? (
        <StatusBanner
          /*
           * The server's own field message, not "that did not save".
           *
           * A 422 from `POST /profile/education` names the offending field in its
           * envelope, and `ApiError.message` already carries the best message for
           * the status. Reporting a generic failure over the top of it throws away
           * the only sentence that tells somebody what to change. Retry here runs
           * the same mutation again rather than only dismissing the banner.
           */
          title="Your education details did not save"
          description={saveFailureMessage(
            education.error instanceof ApiError && education.error.isValidation
              ? 'field'
              : education.error instanceof ApiError && education.error.isUnauthenticated
                ? 'auth'
                : 'unknown',
            education.error instanceof ApiError ? education.error.message : null,
          )}
          onRetry={() => {
            const row = lastSubmitted.current;
            // The banner only renders after a failed mutation, so a row is
            // always present; the guard is here so the type is honest rather
            // than asserted away.
            if (row) void education.mutate(row);
          }}
        />
      ) : null}
      {skillProblem ? (
        <StatusBanner
          /*
           * Skills are a recommendation, so a refused add is information rather
           * than a blocked step: the person can carry on and add it later. It is
           * reported because the alternative — silently dropping it — is what
           * made a stale catalogue look like a broken save.
           */
          title="That skill was not added"
          description={skillProblem}
        />
      ) : null}
      {catalog.isError ? (
        <StatusBanner
          title="The catalog did not load"
          description={
            catalog.error instanceof ApiError ? catalog.error.message : 'Please try again.'
          }
          onRetry={() => void catalog.refetch()}
        />
      ) : null}

      {/*
       * Education. Rendered as already-satisfied when a row exists, so a returning
       * user is not asked to add a second degree — the one place this merge could
       * otherwise have made things worse than the two separate steps it replaced.
       */}
      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Education
        </AppText>

        {hasEducation ? (
          <View style={stepStyles.result}>
            <AppText variant="body">Education already on your profile</AppText>
            <AppText variant="label" tone="accent">
              Added
            </AppText>
          </View>
        ) : (
          <>
            <TextField
              label="College or institution"
              value={institution}
              onChangeText={setInstitution}
              placeholder="MIT Pune"
              maxLength={INSTITUTION_MAX}
              /*
               * The server's 422 wins when there is one; the local rule only
               * covers what the client can see. Both name the field, so a
               * rejected institution is never reported as "that did not save".
               */
              error={errors.institution ?? institutionError(institution)}
              helper="Required to finish this step."
            />
            <TextField
              label="Course or degree"
              value={degree}
              onChangeText={setDegree}
              placeholder="B.Tech Computer Science"
              maxLength={DEGREE_MAX}
              error={errors.degree}
              helper="Optional. Any way you normally write it is fine."
            />

            <AppText variant="label" tone="secondary">
              Level
            </AppText>
            <View style={stepStyles.choiceRow}>
              {LEVELS.map((option) => {
                const selected = option.value === level;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={option.label}
                    onPress={() => setLevel(option.value)}
                    style={[stepStyles.choice, selected ? stepStyles.choiceSelected : null]}>
                    <AppText variant="small" tone={selected ? 'accent' : 'secondary'}>
                      {option.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: current }}
              accessibilityLabel="I am still studying here"
              onPress={() => setCurrent(!current)}
              style={stepStyles.result}>
              <AppText variant="body">I am still studying here</AppText>
              <AppText variant="label" tone={current ? 'accent' : 'tertiary'}>
                {current ? 'Yes' : 'No'}
              </AppText>
            </Pressable>

            {current ? null : (
              <TextField
                label="Graduation year or end date"
                value={endDate}
                onChangeText={setEndDate}
                placeholder="2026 or 2026-06"
                /*
                 * A local parse error is shown here rather than thrown at the
                 * banner: an impossible date is the field's problem, and the
                 * server's `end_date` message (when it has one) still wins.
                 */
                error={errors.end_date ?? endDateError}
                helper="A year or a month is enough. The server checks the range against your start date."
              />
            )}
          </>
        )}
      </Card>

      {/*
       * Skills. Chosen from the database catalogue, never free text: a skill
       * nobody can match on is not a skill, which is why this is a search over
       * `GET /skills/catalog` rather than a comma-separated field. The catalogue
       * browses before anybody types, because you cannot search for a word you
       * have never been shown.
       */}
      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Skills
        </AppText>
        <AppText variant="small" tone="tertiary">
          {`${skillCount} added · ${MIN_SKILLS} recommended. You can add more later from your profile.`}
        </AppText>
        <TextField
          label="Search the skill catalog"
          value={query}
          onChangeText={setQuery}
          placeholder="Python"
          autoCorrect={false}
          returnKeyType="search"
        />

        {view === 'loading' ? <SkeletonCard lines={3} /> : null}

        {view === 'catalogue-empty' ? (
          <AppText variant="small" tone="tertiary">
            The skill catalogue is empty right now. Search will fill in as soon as it does.
          </AppText>
        ) : null}

        {view === 'no-matches' ? (
          <AppText variant="small" tone="tertiary">
            No catalog skill matches that. Try a shorter word.
          </AppText>
        ) : null}

        {view === 'results' ? (
          <View style={stepStyles.results}>
            {/* Says what is on screen and how much is left, so a partial page
                never reads as the whole catalogue. */}
            <AppText variant="caption" tone="tertiary">
              {catalogCaption({ mode, term, shown: items.length, total })}
            </AppText>

            {items.map((item) => {
              const already = owned.has(item.id);
              return (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={already ? `${item.name}, already added` : `Add ${item.name}`}
                  accessibilityState={{ disabled: already }}
                  disabled={already}
                  onPress={() => addSkillNow(item.id)}
                  style={stepStyles.result}>
                  <View style={stepStyles.resultCopy}>
                    <AppText variant="body" weight="semibold">
                      {item.name}
                    </AppText>
                    {item.category ? (
                      <AppText variant="caption" tone="tertiary">
                        {item.category}
                      </AppText>
                    ) : null}
                  </View>
                  <AppText variant="label" tone={already ? 'tertiary' : 'accent'}>
                    {already ? 'Added' : 'Add'}
                  </AppText>
                </Pressable>
              );
            })}

            {catalog.hasNextPage ? (
              <Button
                label={showMoreLabel(items.length, total)}
                variant="ghost"
                fullWidth
                loading={catalog.isFetchingNextPage}
                onPress={() => void catalog.fetchNextPage()}
              />
            ) : null}
          </View>
        ) : null}
      </Card>
    </StepBody>
  );
}
