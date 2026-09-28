/**
 * The college's programs, managed after onboarding.
 *
 * The same endpoints the wizard used, so there is one code path for programs
 * rather than a wizard version and an edit version that can disagree.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, StyleSheet, View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import { createProgram, deleteProgram, fetchMyInstitutions, listPrograms } from '@/api/institutions';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { RequireRole } from '@/auth/RoleGuard';
import { spacing } from '@/theme/tokens';

const NAME_MAX = 200;
const LEVEL_MAX = 120;

export default function CollegeProgramsScreen() {
  return (
    <RequireRole allow="college">
      <ProgramsManager />
    </RequireRole>
  );
}

function ProgramsManager() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [level, setLevel] = useState('');

  const institutions = useQuery({
    queryKey: queryKeys.myInstitutions,
    queryFn: fetchMyInstitutions,
  });
  const institutionId = institutions.data?.[0]?.institution.id ?? null;

  const programs = useQuery({
    queryKey: queryKeys.programs(institutionId ?? ''),
    queryFn: () => listPrograms(institutionId as string),
    enabled: Boolean(institutionId),
  });

  const invalidate = () => {
    if (!institutionId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.programs(institutionId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.myInstitutions });
  };

  const add = useMutation({
    mutationFn: () =>
      createProgram(institutionId as string, {
        name: name.trim(),
        level: level.trim() || null,
      }),
    onSuccess: () => {
      setName('');
      setLevel('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (programId: string) => deleteProgram(institutionId as string, programId),
    onSuccess: invalidate,
  });

  const errors = fieldErrors(add.error);
  const existing = programs.data ?? [];

  return (
    <Screen testID="college-programs-screen">
      <View style={styles.stack}>
        <AppText variant="h1" accessibilityRole="header">
          Programs
        </AppText>

        {institutionId === null && !institutions.isLoading ? (
          <StatusBanner
            title="No institution to attach programs to"
            description="Add your institution first, then programs can be saved against it."
          />
        ) : null}

        <Card style={styles.card}>
          <AppText variant="h3" accessibilityRole="header">
            Add a program
          </AppText>
          <TextField
            label="Program name"
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            error={errors.name}
            required
          />
          <TextField
            label="Level"
            value={level}
            onChangeText={setLevel}
            placeholder="Undergraduate"
            maxLength={LEVEL_MAX}
            error={errors.level}
            helper="Optional."
          />
          <Button
            label="Add program"
            loading={add.isPending}
            disabled={name.trim().length === 0 || institutionId === null}
            onPress={() => add.mutate()}
          />
          {add.isError ? (
            <StatusBanner
              title="That program did not save"
              description={add.error instanceof ApiError ? add.error.message : 'Please retry.'}
            />
          ) : null}
        </Card>

        <Card style={styles.card}>
          <AppText variant="label" tone="secondary">
            {`Saved programs (${existing.length})`}
          </AppText>
          {existing.length === 0 && !programs.isLoading ? (
            <AppText variant="small" tone="tertiary">
              None yet.
            </AppText>
          ) : null}
          {existing.map((program) => (
            <View key={program.id} style={styles.row}>
              <View style={styles.rowCopy}>
                <AppText variant="body" weight="semibold">
                  {program.name}
                </AppText>
                {program.level ? (
                  <AppText variant="caption" tone="tertiary">
                    {program.level}
                  </AppText>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${program.name}`}
                hitSlop={8}
                onPress={() => remove.mutate(program.id)}>
                <AppText variant="label" tone="danger">
                  Remove
                </AppText>
              </Pressable>
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  card: { gap: spacing.md },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 44,
  },
  rowCopy: { flex: 1, gap: 2 },
});