/**
 * Employer step 1 — the recruiter's own profile. Optional, so Skip is offered.
 *
 * Name, email, and password were already collected and stored by `POST /auth/signup`,
 * which is why this screen shows them read-only instead of re-asking: the account
 * exists, and re-typing a password on a step that has nothing new to store is how
 * people end up with two different passwords in their head.
 *
 * Designation and phone go through `PATCH /users/me`. Neither is required, so this
 * step never blocks.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import { fetchMe, updateMe } from '@/api/users';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import { stepStyles } from '@/features/onboarding/onboardingStyles';

const DESIGNATION_MAX = 120;

export interface RecruiterProfileStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function RecruiterProfileStep({
  onNext,
  busy,
  canGoBack,
  onBack,
}: RecruiterProfileStepProps) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe });
  // Null means "not edited yet", which is distinct from "" (deliberately cleared) —
  // `UserUpdate` treats an absent key as "leave alone", so the initialised value
  // must come from the server rather than from an empty string.
  const [designation, setDesignation] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: () =>
      updateMe({
        designation: (designation ?? '').trim() || null,
        phone: (phone ?? '').trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
      void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding });
    },
  });
  const errors = fieldErrors(save.error);

  return (
    <StepBody
      onNext={() => onNext(() => save.mutateAsync())}
      ready
      busy={busy || save.isPending || me.isLoading}
      canGoBack={canGoBack}
      onBack={onBack}
      onSkip={() => onNext()}
      skipLabel="Skip for now">
      {save.isError ? (
        <StatusBanner
          title="That did not save"
          description={save.error instanceof ApiError ? save.error.message : 'Please try again.'}
          onRetry={() => save.mutate()}
        />
      ) : null}

      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Your account
        </AppText>
        <AppText variant="small" tone="tertiary">
          These came from your sign-up and are already saved. Change your name or email from
          Account settings later.
        </AppText>
        <View style={stepStyles.result}>
          <View style={stepStyles.resultCopy}>
            <AppText variant="label" tone="secondary">
              Name
            </AppText>
            <AppText variant="body">{me.data?.name ?? '—'}</AppText>
          </View>
        </View>
        <View style={stepStyles.result}>
          <View style={stepStyles.resultCopy}>
            <AppText variant="label" tone="secondary">
              Work email
            </AppText>
            <AppText variant="body">{me.data?.email ?? '—'}</AppText>
          </View>
        </View>
      </Card>

      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Optional details
        </AppText>
        <TextField
          label="Designation"
          value={designation ?? me.data?.designation ?? ''}
          onChangeText={setDesignation}
          placeholder="Talent Acquisition Lead"
          maxLength={DESIGNATION_MAX}
          error={errors.designation}
          helper="Optional."
        />
        <TextField
          label="Phone"
          value={phone ?? me.data?.phone ?? ''}
          onChangeText={setPhone}
          placeholder="+91 98765 43210"
          keyboardType="phone-pad"
          error={errors.phone}
          helper="Optional. Only shown when you choose to share it."
        />
      </Card>
    </StepBody>
  );
}