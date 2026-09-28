/**
 * The Review step — the last screen of every role's wizard.
 *
 * It is deliberately the only screen that re-reads `GET /onboarding/state` as its
 * source of truth, because this is where the claim "you are done" is made. Every
 * other step trusts local form state; this one trusts the server, and the Finish
 * button is disabled until the server itself reports every required step complete.
 *
 * **There is no "mark complete" call.** The server derives completion from stored
 * data, so this screen's only job is to confirm what the server already decided and
 * then hand the person to their dashboard. That is what makes onboarding
 * impossible to bypass: a client cannot declare itself finished, and the wizard has
 * no endpoint to ask.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';

import { ApiError } from '@/api/errors';
import { fetchOnboardingState } from '@/api/onboarding';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { StepBody } from '@/features/onboarding/StepBody';
import { allRequiredComplete } from '@/features/onboarding/onboardingLogic';
import { stepStyles } from '@/features/onboarding/onboardingStyles';

export interface ReviewStepProps {
  /** Re-read the server's state; the wizard invalidates this after every save. */
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
  /** Called once the server confirms completion. The host does the navigation. */
  onFinish: () => void | Promise<void>;
}

export function ReviewStep({ onNext, busy, canGoBack, onBack, onFinish }: ReviewStepProps) {
  const queryClient = useQueryClient();

  // Always refetched: this screen's whole purpose is to ask the server *now*, not
  // to trust whatever the cache held when the person arrived.
  const state = useQuery({
    queryKey: queryKeys.onboarding,
    queryFn: fetchOnboardingState,
    refetchOnMount: 'always',
  });

  const refresh = useMutation({
    mutationFn: fetchOnboardingState,
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKeys.onboarding, fresh);
    },
  });

  const required = state.data?.steps.filter((step) => step.required) ?? [];
  const ready = allRequiredComplete(state.data);
  const outstanding = required.filter((step) => !step.complete);

  return (
    <StepBody
      onNext={() => (ready ? onFinish() : onNext(() => refresh.mutateAsync()))}
      ready={ready}
      busy={busy || state.isFetching}
      canGoBack={canGoBack}
      onBack={onBack}
      nextLabel={ready ? 'Finish and go to my dashboard' : 'Check again'}>
      {state.isError ? (
        <StatusBanner
          title="Your progress could not be checked"
          description={state.error instanceof ApiError ? state.error.message : 'Please try again.'}
          onRetry={() => void state.refetch()}
        />
      ) : null}

      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          {ready ? 'Everything required is saved' : 'Still to do'}
        </AppText>
        <AppText variant="small" tone="tertiary">
          This list comes from the server, not from this screen. A step is ticked only when
          the data behind it is actually stored.
        </AppText>

        {required.map((step) => (
          <View key={step.key} style={stepStyles.result}>
            <View style={stepStyles.resultCopy}>
              <AppText variant="body" weight="semibold">
                {step.label}
              </AppText>
              {!step.complete && step.hint ? (
                <AppText variant="caption" tone="tertiary">
                  {step.hint}
                </AppText>
              ) : null}
            </View>
            <AppText variant="label" tone={step.complete ? 'success' : 'secondary'}>
              {step.complete ? 'Done' : 'To do'}
            </AppText>
          </View>
        ))}

        {ready ? null : (
          <Button
            label="Go back to the first unfinished step"
            variant="secondary"
            onPress={() => onBack()}
          />
        )}
        {outstanding.length > 0 ? (
          <AppText variant="caption" tone="tertiary">
            {`${outstanding.length} required ${outstanding.length === 1 ? 'step' : 'steps'} left. Use the dots above to jump back.`}
          </AppText>
        ) : null}
      </Card>
    </StepBody>
  );
}