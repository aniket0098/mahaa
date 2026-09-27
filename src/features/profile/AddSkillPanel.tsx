/**
 * Catalogue search + add panel for the skills screen.
 *
 * A skill can only be added by picking its **id** from the database-backed
 * catalogue (`GET /skills/catalog`). Free text is deliberately not accepted: an
 * invented skill name would create a profile entry the server can never match
 * against anything, which is exactly the kind of fake data this project refuses
 * to ship.
 *
 * The query is deferred until the user submits a term, so opening the screen
 * does not pull the whole catalogue.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { addSkill, searchSkillCatalog } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/theme/tokens';
import type { SkillLevel } from '@/types/profile';

const LEVELS: readonly SkillLevel[] = ['beginner', 'intermediate', 'advanced', 'expert'];

export function AddSkillPanel({ owned }: { owned: Set<string> }) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState<SkillLevel>('intermediate');

  const catalog = useQuery({
    queryKey: queryKeys.skillCatalog(search),
    queryFn: () => searchSkillCatalog(search, 25, 0),
    enabled: search.length > 0,
  });

  const add = useMutation({
    mutationFn: (skillId: string) => addSkill({ skill_id: skillId, level }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mySkills });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });

  return (
    <Card style={styles.card}>
      <SectionHeader title="Add a skill" description="Search the skill catalogue." />

      <TextField
        label="Search"
        value={query}
        onChangeText={setQuery}
        placeholder="React, Python, Figma…"
        returnKeyType="search"
        onSubmitEditing={() => setSearch(query.trim())}
      />
      <Button
        label="Search catalogue"
        variant="secondary"
        disabled={query.trim().length === 0}
        onPress={() => setSearch(query.trim())}
      />

      <AppText variant="label" tone="secondary">
        Your level
      </AppText>
      <View style={styles.levels}>
        {LEVELS.map((option) => (
          <Button
            key={option}
            label={option}
            variant={level === option ? 'primary' : 'secondary'}
            onPress={() => setLevel(option)}
          />
        ))}
      </View>

      {add.isError ? (
        <StatusBanner
          title="That skill did not save"
          description={add.error instanceof ApiError ? add.error.message : 'Please try again.'}
        />
      ) : null}

      {catalog.isPending ? <SkeletonCard lines={2} /> : null}
      {catalog.isError ? (
        <StatusBanner
          title="Could not search the catalogue"
          description={
            catalog.error instanceof Error ? catalog.error.message : 'The API did not answer.'
          }
          onRetry={() => void catalog.refetch()}
        />
      ) : null}

      {catalog.data?.items.map((item) => {
        const already = owned.has(item.id);
        return (
          <View key={item.id} style={styles.row}>
            <View style={styles.text}>
              <AppText variant="body">{item.name}</AppText>
              {item.category ? (
                <AppText variant="caption" tone="tertiary">
                  {item.category}
                </AppText>
              ) : null}
            </View>
            <Button
              label={already ? 'Added' : 'Add'}
              variant={already ? 'ghost' : 'secondary'}
              disabled={already}
              loading={add.isPending}
              onPress={() => add.mutate(item.id)}
            />
          </View>
        );
      })}

      {catalog.data && catalog.data.items.length === 0 ? (
        <AppText variant="small" tone="secondary">
          No catalogue entries matched “{search}”.
        </AppText>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  row: { alignItems: 'center', flexDirection: 'row', gap: spacing.md, justifyContent: 'space-between' },
  text: { flex: 1, gap: 2 },
  levels: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});