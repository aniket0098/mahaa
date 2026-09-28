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
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { addSkill, fetchMySkills, searchSkillCatalog } from '@/api/profile';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import { MIN_SKILLS, stepStyles } from '@/features/onboarding/onboardingStyles';

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

  const catalog = useQuery({
    queryKey: queryKeys.skillCatalog(query),
    queryFn: () => searchSkillCatalog(query, 12, 0),
    // No search, no request: an empty query would ask the server to list the
    // whole catalog to show a suggestion list nobody asked for.
    enabled: query.trim().length > 0,
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

        {query.trim().length > 0 && catalog.data ? (
          <View style={stepStyles.results}>
            {catalog.data.items.length === 0 ? (
              <AppText variant="small" tone="tertiary">
                No catalog skill matches that. Try a shorter word.
              </AppText>
            ) : (
              catalog.data.items.map((item) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Add ${item.name}`}
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
                  <AppText variant="label" tone="accent">
                    Add
                  </AppText>
                </Pressable>
              ))
            )}
          </View>
        ) : null}
      </Card>
    </StepBody>
  );
}
