/**
 * Candidate step 2 — education.
 *
 * A required step, so no Skip. The "still studying" switch is prominent because
 * the students this step is written for are the common case, and asking them for
 * a graduation year they do not have yet would push them to invent one.
 *
 * One entry is enough: the server counts presence, not volume, and a second entry
 * is available from the profile screen whenever somebody wants it.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import { educationApi } from '@/api/profile';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import { DEGREE_MAX, INSTITUTION_MAX, stepStyles } from '@/features/onboarding/onboardingStyles';
import type { EducationLevel } from '@/types/profile';

/**
 * The levels the server accepts, in the order they are offered.
 *
 * Typed as `EducationLevel` rather than `string` so the picker cannot drift from
 * the server's enum: a value that is not in the union is a compile error here
 * rather than a 422 the user discovers after typing.
 */
const LEVELS: readonly { value: EducationLevel; label: string }[] = [
  { value: 'undergraduate', label: 'Undergraduate' },
  { value: 'postgraduate', label: 'Postgraduate' },
  { value: 'diploma', label: 'Diploma' },
  { value: 'doctorate', label: 'Doctorate' },
  { value: 'school', label: 'School' },
  { value: 'other', label: 'Other' },
];

export interface EducationStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function EducationStep({ onNext, busy, canGoBack, onBack }: EducationStepProps) {
  const [institution, setInstitution] = useState('');
  const [degree, setDegree] = useState('');
  const [level, setLevel] = useState<EducationLevel>('undergraduate');
  const [current, setCurrent] = useState(true);
  const [endDate, setEndDate] = useState('');

  const save = useMutation({
    mutationFn: () =>
      educationApi.create({
        institution: institution.trim(),
        degree: degree.trim() || null,
        level,
        current,
        // A still-studying entry has no end date, and the server's own rule is
        // that "current" and "has an end date" cannot both be true.
        end_date: current || endDate.trim() === '' ? null : endDate.trim(),
      }),
  });
  const errors = fieldErrors(save.error);
  const ready = institution.trim().length > 0;

  return (
    <StepBody
      onNext={() => onNext(() => save.mutateAsync())}
      ready={ready}
      busy={busy || save.isPending}
      canGoBack={canGoBack}
      onBack={onBack}>
      {save.isError ? (
        <StatusBanner
          title="That education entry did not save"
          description={save.error instanceof ApiError ? save.error.message : 'Please try again.'}
          onRetry={() => save.mutate()}
        />
      ) : null}

      <Card style={stepStyles.card}>
        <TextField
          label="College or institution"
          value={institution}
          onChangeText={setInstitution}
          placeholder="MIT Pune"
          maxLength={INSTITUTION_MAX}
          error={errors.institution}
          required
        />
        <TextField
          label="Course or degree"
          value={degree}
          onChangeText={setDegree}
          placeholder="B.Tech Computer Science"
          maxLength={DEGREE_MAX}
          error={errors.degree}
          helper="Optional."
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
            placeholder="2026-06"
            error={errors.end_date}
            helper="YYYY-MM. The server checks the range against your start date."
          />
        )}
      </Card>
    </StepBody>
  );
}
