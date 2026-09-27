/**
 * Skills — real CRUD against `/profile/skills`, with catalogue search.
 *
 * Adding requires choosing a skill from the database-backed catalogue
 * (`AddSkillPanel`), never typing a free-text name — an invented skill would be
 * a profile entry the server could never match against an opportunity.
 *
 * `verified` is server-owned and absent from the create body, so nothing on
 * this screen claims a skill is verified.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { fetchMySkills, removeSkill } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { AddSkillPanel } from '@/features/profile/AddSkillPanel';
import { spacing } from '@/theme/tokens';

export default function SkillsScreen() {
  const queryClient = useQueryClient();
  const mine = useQuery({ queryKey: queryKeys.mySkills, queryFn: () => fetchMySkills(100, 0) });

  const remove = useMutation({
    mutationFn: (id: string) => removeSkill(id),
    onSuccess: () => {
      // The aggregate drives the completeness percentage, so refresh it too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.mySkills });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });

  const owned = new Set(mine.data?.items.map((skill) => skill.skill_id) ?? []);

  return (
    <Screen testID="skills-screen">
      <View style={styles.stack}>
        <BackButton />
        <AppText variant="h1" accessibilityRole="header">
          Skills
        </AppText>
        <AppText variant="body" tone="secondary">
          Add skills from the catalogue so they can be matched against real
          opportunities.
        </AppText>

        {remove.isError ? (
          <StatusBanner
            title="That skill was not removed"
            description={
              remove.error instanceof ApiError ? remove.error.message : 'Please try again.'
            }
          />
        ) : null}

        <Card style={styles.card}>
          <SectionHeader title="Your skills" />
          {mine.isPending ? (
            <SkeletonCard lines={2} />
          ) : mine.isError ? (
            <StatusBanner
              title="Could not load your skills"
              description={
                mine.error instanceof Error ? mine.error.message : 'The API did not answer.'
              }
              onRetry={() => void mine.refetch()}
            />
          ) : mine.data && mine.data.items.length === 0 ? (
            <AppText variant="small" tone="secondary">
              No skills added yet. Search the catalogue below to add your first one.
            </AppText>
          ) : (
            mine.data?.items.map((skill) => (
              <View key={skill.id} style={styles.row}>
                <View style={styles.text}>
                  <AppText variant="body" weight="semibold">
                    {skill.name}
                  </AppText>
                  <AppText variant="caption" tone="tertiary">
                    {skill.level}
                    {skill.category ? ` · ${skill.category}` : ''}
                  </AppText>
                </View>
                <Button
                  label="Remove"
                  variant="ghost"
                  onPress={() => remove.mutate(skill.id)}
                />
              </View>
            ))
          )}
        </Card>

        <AddSkillPanel owned={owned} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  card: { gap: spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  text: { flex: 1, gap: 2 },
});