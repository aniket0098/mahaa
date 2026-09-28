/**
 * Candidate step 1 — the basic profile.
 *
 * A required step, so it offers no Skip: headline, location, and bio are the
 * approved mandatory fields, and a way past them would leave the server refusing
 * to complete the flow with nothing on screen to explain why.
 *
 * Career interests sit on this screen because they are part of the same profile
 * identity, and they are explicitly optional — the step does not read their
 * emptiness as an incomplete form.
 */

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import { updateIdentity } from '@/api/profile';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import {
  HEADLINE_MAX,
  INTEREST_MAX,
  INTERESTS_MAX,
  LOCATION_MAX,
  SUMMARY_MAX,
  stepStyles,
} from '@/features/onboarding/onboardingStyles';
import type { IdentityRead } from '@/types/profile';

export interface BasicsStepProps {
  identity: IdentityRead;
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function BasicsStep({ identity, onNext, busy, canGoBack, onBack }: BasicsStepProps) {
  const [headline, setHeadline] = useState(identity.headline ?? '');
  const [location, setLocation] = useState(identity.location ?? '');
  const [summary, setSummary] = useState(identity.summary ?? '');
  const [interest, setInterest] = useState('');
  const [interests, setInterests] = useState<string[]>(identity.interests);

  const save = useMutation({
    mutationFn: () =>
      updateIdentity({
        headline: headline.trim(),
        location: location.trim(),
        summary: summary.trim(),
        interests,
      }),
  });
  const errors = fieldErrors(save.error);
  // Only a client-visible hard block disables Continue; anything the server
  // validates is submitted so its own message can be shown.
  const ready =
    headline.trim().length > 0 && location.trim().length > 0 && summary.trim().length > 0;

  const addInterest = () => {
    const value = interest.trim();
    if (!value || interests.length >= INTERESTS_MAX || interests.includes(value)) return;
    setInterests([...interests, value]);
    setInterest('');
  };

  return (
    <StepBody
      onNext={() => onNext(() => save.mutateAsync())}
      ready={ready}
      busy={busy || save.isPending}
      canGoBack={canGoBack}
      onBack={onBack}>
      {save.isError ? (
        <StatusBanner
          title="That did not save"
          description={save.error instanceof ApiError ? save.error.message : 'Please try again.'}
          onRetry={() => save.mutate()}
        />
      ) : null}

      <Card style={stepStyles.card}>
        <TextField
          label="Headline"
          value={headline}
          onChangeText={setHeadline}
          placeholder="Software Engineering Intern"
          maxLength={HEADLINE_MAX}
          error={errors.headline}
          helper="One line a recruiter reads first."
          required
        />
        <TextField
          label="Location"
          value={location}
          onChangeText={setLocation}
          placeholder="Pune"
          maxLength={LOCATION_MAX}
          error={errors.location}
          helper="City is enough."
          required
        />
        <TextField
          label="About"
          value={summary}
          onChangeText={setSummary}
          placeholder="Two sentences on what you are working towards."
          multiline
          maxLength={SUMMARY_MAX}
          error={errors.summary}
          helper={`${summary.length} / ${SUMMARY_MAX}`}
          required
        />
      </Card>

      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Career interests
        </AppText>
        <AppText variant="small" tone="tertiary">
          {`${interests.length} of ${INTERESTS_MAX} · optional`}
        </AppText>
        {interests.length > 0 ? (
          <View style={stepStyles.chipRow}>
            {interests.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${value}`}
                hitSlop={8}
                onPress={() => setInterests(interests.filter((entry) => entry !== value))}
                style={stepStyles.chip}>
                <AppText style={stepStyles.chipLabel}>{`${value}  ×`}</AppText>
              </Pressable>
            ))}
          </View>
        ) : null}
        <TextField
          label="Add an interest"
          value={interest}
          onChangeText={setInterest}
          onSubmitEditing={addInterest}
          placeholder="Data Science"
          maxLength={INTEREST_MAX}
          returnKeyType="done"
        />
        <Button
          label="Add"
          variant="secondary"
          disabled={interest.trim().length === 0 || interests.length >= INTERESTS_MAX}
          onPress={addInterest}
        />
      </Card>
    </StepBody>
  );
}
