/**
 * Candidate step 3 — skills.
 *
 * A required step, so no Skip, but the "three skills" bar is a **recommendation**
 * rather than a hard block: the server awards the section's completion at three,
 * and this screen says so plainly instead of pretending three is a rule the user
 * is breaking by adding two.
 *
 * Skills are chosen from the database catalog, never typed free text. That is the
 * server's rule (`POST /profile/skills` takes a `skill_id`), and it is why this
 * screen has a search box rather than a comma-separated field: a skill nobody can
 * match on is not a skill.
 *
 * **The catalogue is browsable before anybody types.** This used to be gated on
 * `enabled: query.trim().length > 0`, which made the step open on an empty card —
 * a search box, a counter, and nothing to look at. You cannot search for a word
 * you have never been shown, and the catalogue is the thing that says what is
 * even on offer. `GET /skills/catalog` treats an empty `q` as list-all for
 * exactly this (`search_catalog`'s docstring says so), so the first page is just
 * a request with no filter. Paging and the two distinct empty states live in
 * `skillsBrowse.ts`.
 *
 * Skills already on the profile render as "Added" and cannot be added twice.
 * That mattered little when the list only existed during a search and vanished
 * on the first add; with a persistent browse list an already-held skill stays on
 * screen, so the guard is now load-bearing rather than incidental.
 */

import { useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { addSkill, fetchMySkills, searchSkillCatalog } from '@/api/profile';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import { MIN_SKILLS, stepStyles } from '@/features/onboarding/onboardingStyles';
import {
  catalogCaption,
  catalogMode,
  catalogRequest,
  catalogTerm,
  catalogViewState,
  ownedSkillIds,
  showMoreLabel,
} from '@/features/onboarding/skillsBrowse';

export interface SkillsStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function SkillsStep({ onNext, busy, canGoBack, onBack }: SkillsStepProps) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');

  const mine = useQuery({ queryKey: queryKeys.mySkills, queryFn: () => fetchMySkills() });
  const count = mine.data?.items.length ?? 0;
  const owned = ownedSkillIds(mine.data?.items);

  // Trimmed once, here, so a stray space cannot silently turn a search into a
  // browse-all (or the reverse).
  const term = catalogTerm(query);
  const mode = catalogMode(term);

  /*
   * `useInfiniteQuery` rather than a growing `limit`: "Show more" should fetch
   * the rows it has not already got. Widening the limit instead re-requests the
   * whole prefix on every tap, which is the "download the catalogue repeatedly"
   * this step is meant to avoid. `has_more` comes from the server's own `Page`
   * envelope, so the last page is detected server-side rather than guessed from a
   * short page.
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

  const items = catalog.data?.pages.flatMap((page) => page.items) ?? [];
  const total = catalog.data?.pages[0]?.total ?? 0;

  const view = catalogViewState({
    mode,
    hasData: catalog.data !== undefined,
    isFetching: catalog.isFetching,
    shown: items.length,
  });

  const add = useMutation({
    mutationFn: (skillId: string) => addSkill({ skill_id: skillId, level: 'intermediate' }),
    onSuccess: () => {
      setQuery('');
      // The profile aggregate and the onboarding state both read this data, so
      // both must refresh before the wizard is allowed to move on.
      void queryClient.invalidateQueries({ queryKey: queryKeys.mySkills });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding });
    },
  });

  const ready = count >= MIN_SKILLS;

  return (
    <StepBody
      onNext={() => onNext()}
      ready={ready}
      busy={busy || add.isPending}
      canGoBack={canGoBack}
      onBack={onBack}>
      <Card style={stepStyles.card}>
        <AppText variant="small" tone="secondary">
          {`${count} added · ${MIN_SKILLS} recommended to finish this step`}
        </AppText>
        <TextField
          label="Search the skill catalog"
          value={query}
          onChangeText={setQuery}
          placeholder="Python"
          autoCorrect={false}
          returnKeyType="search"
        />

        {add.isError ? (
          <StatusBanner
            title="That skill could not be added"
            description={add.error instanceof ApiError ? add.error.message : 'Please try again.'}
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
                  onPress={() => add.mutate(item.id)}
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
