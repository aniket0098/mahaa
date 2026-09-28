/**
 * College step 1 — the contact person.
 *
 * A college registers as a person first, exactly like an employer does, so name,
 * email, and password are already stored by `POST /auth/signup`. This screen shows
 * them read-only and collects only the optional designation and phone — the same
 * shape as the employer's recruiter step, because it is the same fact about the
 * same kind of account.
 *
 * Nothing here is required, so Skip is offered. The college's required data is the
 * institution, which is the next step.
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

export interface CollegeContactStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function CollegeContactStep({
  onNext,
  busy,
  canGoBack,
  onBack,
}: CollegeContactStepProps) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe });
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
          Your contact account
        </AppText>
        <AppText variant="small" tone="tertiary">
          These came from your sign-up and are already saved. This is the account your
          institution will be attached to.
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
              Email
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
          label="Your designation"
          value={designation ?? me.data?.designation ?? ''}
          onChangeText={setDesignation}
          placeholder="Placement Coordinator"
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
          helper="Optional."
        />
      </Card>
    </StepBody>
  );
}