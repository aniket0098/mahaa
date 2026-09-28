/**
 * Candidate step 4 — experience and projects. Optional, so Skip is offered.
 *
 * Nothing here gates onboarding, and the screen says so. The common case for this
 * product is a student or a first-job seeker, for whom "no experience yet" is the
 * accurate answer, and a form that insists on inventing one teaches them to write
 * fiction on a profile a recruiter will read.
 *
 * Entries save immediately through the section endpoints rather than being held in
 * a local draft, so a Skip after typing does not silently discard what was written:
 * each row is written when it is added, and the person is told that.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { experienceApi, projectsApi } from '@/api/profile';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import { stepStyles } from '@/features/onboarding/onboardingStyles';

const TITLE_MAX = 160;
const DESCRIPTION_MAX = 2000;

export interface ExperienceStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function ExperienceStep({ onNext, busy, canGoBack, onBack }: ExperienceStepProps) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<'experience' | 'project'>('experience');
  const [title, setTitle] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [description, setDescription] = useState('');

  const experience = useQuery({
    queryKey: queryKeys.experience,
    queryFn: () => experienceApi.list(),
  });
  const projects = useQuery({ queryKey: queryKeys.projects, queryFn: () => projectsApi.list() });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding });
  };

  const addExperience = useMutation({
    mutationFn: () =>
      experienceApi.create({
        title: title.trim(),
        // The server requires this field — it is not optional, so an entry with no
        // organisation is refused outright rather than saved with a blank.
        company_name: organisation.trim(),
        description: description.trim() || null,
      }),
    onSuccess: () => {
      setTitle('');
      setOrganisation('');
      setDescription('');
      invalidate();
    },
  });

  const addProject = useMutation({
    mutationFn: () =>
      projectsApi.create({ title: title.trim(), description: description.trim() || null }),
    onSuccess: () => {
      setTitle('');
      setOrganisation('');
      setDescription('');
      invalidate();
    },
  });

  const pending = kind === 'experience' ? addExperience : addProject;
  const errors = fieldErrors(pending.error);
  const ready = title.trim().length > 0;
  const existing = kind === 'experience' ? experience.data?.items ?? [] : projects.data?.items ?? [];

  return (
    <StepBody
      // No save: every row is already written when it is added, so Continue only
      // moves on. Passing a save here would imply unsaved state that does not exist.
      onNext={() => onNext()}
      ready
      busy={busy}
      canGoBack={canGoBack}
      onBack={onBack}
      onSkip={() => onNext()}
      skipLabel="Skip for now">
      {pending.isError ? (
        <StatusBanner
          title="That entry did not save"
          description={
            pending.error instanceof ApiError ? pending.error.message : 'Please try again.'
          }
          onRetry={() => pending.mutate()}
        />
      ) : null}
      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Add a role or a project
        </AppText>
        <AppText variant="small" tone="tertiary">
          Optional. Each entry saves the moment you add it, so leaving now keeps what is
          already here.
        </AppText>

        <View style={stepStyles.choiceRow}>
          {(
            [
              { value: 'experience', label: 'Experience' },
              { value: 'project', label: 'Project' },
            ] as const
          ).map((option) => {
            const selected = kind === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                onPress={() => setKind(option.value)}
                style={[stepStyles.choice, selected ? stepStyles.choiceSelected : null]}>
                <AppText variant="small" tone={selected ? 'accent' : 'secondary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <TextField
          label={kind === 'experience' ? 'Role title' : 'Project name'}
          value={title}
          onChangeText={setTitle}
          placeholder={kind === 'experience' ? 'Software Engineering Intern' : 'Campus water tracker'}
          maxLength={TITLE_MAX}
          error={errors.title}
        />
        {kind === 'experience' ? (
          <TextField
            label="Organisation"
            value={organisation}
            onChangeText={setOrganisation}
            placeholder="Acme Labs"
            maxLength={TITLE_MAX}
            error={errors.company_name}
            helper="Required by the server for a role entry."
          />
        ) : null}
        <TextField
          label="What you did"
          value={description}
          onChangeText={setDescription}
          placeholder="One or two lines."
          multiline
          maxLength={DESCRIPTION_MAX}
          error={errors.description}
        />
        <Button
          label="Add"
          variant="secondary"
          disabled={!ready || pending.isPending}
          onPress={() => (kind === 'experience' ? addExperience.mutate() : addProject.mutate())}
        />
      </Card>

      <Card style={stepStyles.card}>
        <AppText variant="label" tone="secondary">
          {kind === 'experience'
            ? `Saved roles (${existing.length})`
            : `Saved projects (${existing.length})`}
        </AppText>
        {existing.length === 0 ? (
          <AppText variant="small" tone="tertiary">
            Nothing saved yet.
          </AppText>
        ) : (
          existing.map((entry) => (
            <View key={entry.id} style={stepStyles.result}>
              <View style={stepStyles.resultCopy}>
                <AppText variant="body" weight="semibold">
                  {entry.title}
                </AppText>
              </View>
            </View>
          ))
        )}
      </Card>
    </StepBody>
  );
}