/**
 * Verification â€” a shared step for the employer and college wizards.
 *
 * **It reports status; it never grants it.** The only thing this screen can do is
 * *request* verification, and the server's response moves the record to `pending` and
 * returns its own note explaining that document review is a later stage. So there is
 * no code path here that could set `verified`, and the copy never claims a badge the
 * server has not granted â€” a fake "Verified" mark is worse than no mark at all,
 * because a candidate will act on it.
 *
 * The status shown is always the server's current value, refetched on mount, so a
 * status changed elsewhere in the app is reflected rather than cached.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';

import { ApiError } from '@/api/errors';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { StepBody } from '@/features/onboarding/StepBody';
import { stepStyles } from '@/features/onboarding/onboardingStyles';

/** The same four values the server stores. Never narrowed, never asserted. */
type Status = 'unverified' | 'pending' | 'verified' | 'rejected';

const STATUS_COPY: Readonly<Record<Status, { label: string; help: string }>> = {
  unverified: {
    label: 'Not verified',
    help: 'Nobody has checked this organisation yet. You can still post and hire.',
  },
  pending: {
    label: 'Verification requested',
    help: 'Your request is recorded. Document review is a later stage, so it has not been reviewed yet.',
  },
  verified: {
    label: 'Verified',
    help: 'The server has marked this organisation as verified.',
  },
  rejected: {
    label: 'Verification rejected',
    help: 'A previous request did not pass. You can request again.',
  },
};

export interface VerificationTarget {
  id: string;
  status: Status;
}

/** Reads the current status. Implemented separately per organisation type. */
export interface VerificationStepProps {
  /** Null when the organisation does not exist yet â€” the step explains why. */
  target: VerificationTarget | null;
  /** The real current status, used when `target` is still loading. */
  onRequest: () => Promise<{ verification_status: Status; note: string }>;
  /**
   * Cache branches to refresh after a request.
   *
   * Typed as a query-key array rather than a plain string so a key that does not
   * exist in `queryKeys` is a compile error. Passing a hand-typed string here would
   * invalidate nothing and leave the screen showing a stale status.
   */
  invalidates: readonly (readonly unknown[])[];
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
  /** Shown in the header area so the reader knows which organisation this is about. */
  subject: string;
}

export function VerificationStep({
  target,
  onRequest,
  invalidates,
  onNext,
  busy,
  canGoBack,
  onBack,
  subject,
}: VerificationStepProps) {
  const queryClient = useQueryClient();
  const [serverNote, setServerNote] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: onRequest,
    onSuccess: (response) => {
      setServerNote(response.note);
      for (const key of invalidates) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });

  const status: Status = target?.status ?? 'unverified';
  const copy = STATUS_COPY[status];
  // Asking twice is pointless and the server would just return the same pending
  // state, so the button is withdrawn once a request is in.
  const canRequest = Boolean(target) && (status === 'unverified' || status === 'rejected');

  return (
    <StepBody
      onNext={() => onNext()}
      ready
      busy={busy || request.isPending}
      canGoBack={canGoBack}
      onBack={onBack}
      onSkip={() => onNext()}
      skipLabel="Continue">
      {request.isError ? (
        <StatusBanner
          title="That request did not go through"
          description={request.error instanceof ApiError ? request.error.message : 'Please try again.'}
          onRetry={() => request.mutate()}
        />
      ) : null}

      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          {subject}
        </AppText>
        <View style={stepStyles.result}>
          <View style={stepStyles.resultCopy}>
            <AppText variant="label" tone="secondary">
              Current status
            </AppText>
            <AppText variant="body" weight="semibold">
              {copy.label}
            </AppText>
          </View>
        </View>
        <AppText variant="small" tone="tertiary">
          {copy.help}
        </AppText>

        {canRequest ? (
          <Button
            label="Request verification"
            variant="secondary"
            loading={request.isPending}
            onPress={() => request.mutate()}
          />
        ) : null}
        {status === 'pending' ? (
          <AppText variant="caption" tone="tertiary">
            You have already asked. There is nothing further to do here.
          </AppText>
        ) : null}
      </Card>

      {serverNote ? (
        <Card style={stepStyles.card}>
          <AppText variant="label" tone="secondary">
            What the server said
          </AppText>
          <AppText variant="body">{serverNote}</AppText>
        </Card>
      ) : null}
    </StepBody>
  );
}
