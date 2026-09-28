/**
 * College step 2 — programs. Required, so no Skip.
 *
 * The server's college rule is "an institution with at least one program", so this
 * step gates exactly that. Programs are created and deleted through the real
 * endpoints rather than accumulated in a local array and posted at the end, so a
 * failed add leaves the ones that worked in place — which is what makes a retry
 * safe and what makes a reload show the truth.
 *
 * Editing goes through `PATCH`, so a typo is corrected in place rather than
 * producing a second near-identical program.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import { createProgram, deleteProgram, listPrograms, updateProgram } from '@/api/institutions';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import { stepStyles } from '@/features/onboarding/onboardingStyles';

const NAME_MAX = 200;
const LEVEL_MAX = 120;
const DESCRIPTION_MAX = 2000;

export interface ProgramsStepProps {
  /** Null until the institution step has saved, which is the normal first run. */
  institutionId: string | null;
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function ProgramsStep({
  institutionId,
  onNext,
  busy,
  canGoBack,
  onBack,
}: ProgramsStepProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [level, setLevel] = useState('');
  const [description, setDescription] = useState('');

  const programs = useQuery({
    queryKey: queryKeys.programs(institutionId ?? ''),
    queryFn: () => listPrograms(institutionId as string),
    enabled: Boolean(institutionId),
  });

  const invalidate = () => {
    if (!institutionId) return;
    void queryClient.invalidateQueries({ queryKey: queryKeys.programs(institutionId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.myInstitutions });
    void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding });
  };

  const add = useMutation({
    mutationFn: () =>
      createProgram(institutionId as string, {
        name: name.trim(),
        level: level.trim() || null,
        description: description.trim() || null,
      }),
    onSuccess: () => {
      setName('');
      setLevel('');
      setDescription('');
      invalidate();
    },
  });

  const remove = useMutation({
    mutationFn: (programId: string) => deleteProgram(institutionId as string, programId),
    onSuccess: invalidate,
  });

  const rename = useMutation({
    mutationFn: ({ id, next }: { id: string; next: string }) =>
      updateProgram(institutionId as string, id, { name: next }),
    onSuccess: invalidate,
  });

  const errors = fieldErrors(add.error);
  const existing = programs.data ?? [];
  // The server needs at least one program, so the list is part of the gate — not
  // just the form in front of it.
  const ready = existing.length > 0;

  if (!institutionId) {
    return (
      <StepBody
        onNext={() => onNext()}
        ready={false}
        busy={busy}
        canGoBack={canGoBack}
        onBack={onBack}>
        <Card style={stepStyles.card}>
          <AppText variant="h3" accessibilityRole="header">
            Save your institution first
          </AppText>
          <AppText variant="body" tone="secondary">
            Programs belong to an institution, so the institution step has to be saved before this
            one can do anything. Go back one step and save the name.
          </AppText>
        </Card>
      </StepBody>
    );
  }

  return (
    <StepBody
      onNext={() => onNext()}
      ready={ready}
      busy={busy || add.isPending}
      canGoBack={canGoBack}
      onBack={onBack}>
      {add.isError ? (
        <StatusBanner
          title="That program did not save"
          description={add.error instanceof ApiError ? add.error.message : 'Please try again.'}
          onRetry={() => add.mutate()}
        />
      ) : null}
      {remove.isError ? (
        <StatusBanner
          title="That program could not be removed"
          description={
            remove.error instanceof ApiError ? remove.error.message : 'Please try again.'
          }
        />
      ) : null}
      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Add a program
        </AppText>
        <AppText variant="small" tone="tertiary">
          At least one is required to finish onboarding. Each is saved as you add it.
        </AppText>

        <TextField
          label="Program name"
          value={name}
          onChangeText={setName}
          placeholder="B.Tech Computer Science"
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
        <TextField
          label="Description"
          value={description}
          onChangeText={setDescription}
          placeholder="One line about the course."
          multiline
          maxLength={DESCRIPTION_MAX}
          error={errors.description}
          helper="Optional."
        />
        <Button
          label="Add program"
          variant="secondary"
          disabled={name.trim().length === 0}
          loading={add.isPending}
          onPress={() => add.mutate()}
        />
      </Card>

      <Card style={stepStyles.card}>
        <AppText variant="label" tone="secondary">
          {`Saved programs (${existing.length})`}
        </AppText>
        {programs.isLoading ? (
          <AppText variant="small" tone="tertiary">
            Loading…
          </AppText>
        ) : null}
        {!programs.isLoading && existing.length === 0 ? (
          <AppText variant="small" tone="tertiary">
            None yet. Add one above to continue.
          </AppText>
        ) : null}
        {existing.map((program) => (
          <ProgramRow
            key={program.id}
            name={program.name}
            level={program.level}
            onRename={(next) => rename.mutate({ id: program.id, next })}
            onRemove={() => remove.mutate(program.id)}
          />
        ))}
      </Card>
    </StepBody>
  );
}

/** One saved program, with inline rename and remove. */
function ProgramRow({
  name,
  level,
  onRename,
  onRemove,
}: {
  name: string;
  level: string | null;
  onRename: (next: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  if (editing) {
    return (
      <View style={stepStyles.card}>
        <TextField label="Program name" value={draft} onChangeText={setDraft} maxLength={NAME_MAX} />
        <View style={stepStyles.choiceRow}>
          <Button
            label="Save"
            variant="secondary"
            disabled={draft.trim().length === 0 || draft.trim() === name}
            onPress={() => {
              onRename(draft.trim());
              setEditing(false);
            }}
          />
          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => {
              setDraft(name);
              setEditing(false);
            }}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={stepStyles.result}>
      <View style={stepStyles.resultCopy}>
        <AppText variant="body" weight="semibold">
          {name}
        </AppText>
        {level ? (
          <AppText variant="caption" tone="tertiary">
            {level}
          </AppText>
        ) : null}
      </View>
      <View style={stepStyles.choiceRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit ${name}`}
          hitSlop={8}
          onPress={() => {
            setDraft(name);
            setEditing(true);
          }}>
          <AppText variant="label" tone="accent">
            Edit
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          hitSlop={8}
          onPress={onRemove}>
          <AppText variant="label" tone="danger">
            Remove
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
