/**
 * The onboarding host ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â the wizard screen for every role.
 *
 * One screen, three flows, because the *shape* of the problem is identical for all
 * of them: ask the server where this person is, render that step, save it, ask
 * again, move on. Role differences live in `onboardingSteps.ts` (which screens) and
 * in the step components themselves (what they collect), never in the navigation
 * logic here. A second host per role would be three places for the redirect rules
 * to drift apart, and they always do.
 *
 * **The wizard has no opinion about whether onboarding is finished.** It asks
 * `GET /onboarding/state` on mount, renders the step the server names, and on the
 * final step re-reads it. Completion is the server's derived verdict, so a client
 * cannot shortcut the flow by navigating straight to the last screen: that screen
 * checks the same state and refuses to enable Finish until the server agrees.
 *
 * The current step lives in the URL (`?step=`) so a refresh, a deep link, and a
 * Back press all resolve to the same place. The index is *not* trusted on its own:
 * `resolveStep` clamps it to the wizard and honours the server's `next_step` when
 * the URL does not name one.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ScrollView, StyleSheet } from 'react-native';

import { fetchOnboardingState } from '@/api/onboarding';
import { queryKeys } from '@/api/queryKeys';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { useAuth } from '@/auth/AuthContext';
import { homePathForRole } from '@/auth/roleHome';
import { OnboardingStepView } from '@/features/onboarding/OnboardingStepView';
import { StepHeader } from '@/features/onboarding/StepHeader';
import { resolveStep, isLastStep, stepStatus } from '@/features/onboarding/onboardingLogic';
import { stepsForRole } from '@/features/onboarding/onboardingSteps';
import { spacing } from '@/theme/tokens';

export default function OnboardingScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { principal } = useAuth();
  const params = useLocalSearchParams<{ step?: string }>();

  const role = principal?.role;
  const steps = useMemo(() => stepsForRole(role), [role]);

  // Always refetched: the whole point is to ask the server *now* rather than trust
  // a cache entry that a previous step save may have just invalidated.
  const state = useQuery({
    queryKey: queryKeys.onboarding,
    queryFn: fetchOnboardingState,
    refetchOnMount: 'always',
  });

  /**
   * The step is *derived* from three inputs â€” the server's state, the URL, and any
   * local move the person just made â€” rather than stored and synchronised.
   *
   * Storing it and syncing it in an effect meant two sources of truth: a tap on a
   * step dot set the index, then the next server answer overwrote it, and a
   * refresh could land on a different screen than the one the person left. Deriving
   * it collapses that to a single value that is always consistent with what the
   * server last said.
   *
   * `movedTo` records an explicit navigation so it wins over the server's
   * `next_step` until the URL changes again â€” that is what lets Back and the step
   * dots actually move the person instead of snapping them back.
   */
  const [movedTo, setMovedTo] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const urlStep = params.step === undefined ? Number.NaN : Number(params.step);
  // `undefined` (not null) is the "no request" sentinel `resolveStep` expects, and
  // it means "let the server's next_step decide".
  const requested = Number.isNaN(urlStep) ? (movedTo ?? undefined) : urlStep;

  const index = resolveStep(state.data, steps, requested);
  const current = steps[index];
  const status = stepStatus(state.data, current?.key ?? '');

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(next, steps.length - 1));
      setMovedTo(clamped);
      router.setParams({ step: String(clamped) });
    },
    [router, steps.length],
  );

  /**
   * Leave the wizard once the server has confirmed completion.
   *
   * Re-reads the state rather than trusting the value passed in, because the role's
   * own guard re-checks the server and would bounce an unfinished account straight
   * back to this screen. A navigate-then-bounce is worse than a clear refusal.
   */
  const handleFinish = useCallback(async () => {
    const fresh = await queryClient.fetchQuery({
      queryKey: queryKeys.onboarding,
      queryFn: fetchOnboardingState,
      staleTime: 0,
    });
    if (fresh.state !== 'completed') {
      setFatal(
        'Some required steps are still outstanding. Use the dots above to go back to them.',
      );
      return;
    }
    router.replace(homePathForRole(role ?? 'candidate') as never);
  }, [queryClient, role, router]);

  /**
   * Save, then advance.
   *
   * The save runs *before* the move, and a failure stops the move. That ordering is
   * the whole contract of the Continue button: the wizard never advances past data
   * the server refused, so a person who retries finds their earlier steps intact
   * and the step they failed on still open.
   */
  const handleNext = useCallback(
    async (save?: () => Promise<unknown>) => {
      setBusy(true);
      setFatal(null);
      try {
        if (save) await save();
        // Re-read before moving: a step is only "done" once the server says so.
        const fresh = await queryClient.fetchQuery({
          queryKey: queryKeys.onboarding,
          queryFn: fetchOnboardingState,
        });

        // The review step is where the wizard ends, so advancing past it has to
        // leave the wizard. Without this, `goTo` clamps to the last index and
        // Continue silently does nothing on the final screen ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â which is exactly
        // how an account gets stuck on "Review and finish" forever.
        if (isLastStep(index, steps.length)) {
          if (fresh.state === 'completed') {
            handleFinish();
          } else {
            // The server is the authority, so an unfinished flow stays in the
            // wizard rather than being waved through to a dashboard.
            setFatal(
              'Some required steps are still outstanding. Use the dots above to go back to them.',
            );
          }
          return;
        }

        const nowComplete =
          fresh.steps.find((s) => s.key === current?.key)?.complete ?? false;
        if (nowComplete || current?.required === false) {
          goTo(index + 1);
          return;
        }
        // The save returned without error but the server still disagrees. Refusing
        // to move is the honest outcome: advancing would strand the person in a
        // wizard that looks finished and can never complete.
        setFatal('That did not register as saved. Check the highlighted fields and try again.');
      } catch (error) {
        setFatal(
          error instanceof Error ? error.message : 'Something went wrong. Please try again.',
        );
      } finally {
        setBusy(false);
      }
    },
    [current, goTo, handleFinish, index, queryClient, steps.length],
  );


  // A role with no steps would render an empty wizard, which is a dead screen.
  if (!current) {
    return (
      <Screen testID="onboarding-screen">
        <StatusBanner
          title="No onboarding steps"
          description="This account type has nothing to set up."
        />
      </Screen>
    );
  }

  return (
    /*
     * `scrollable={false}` is essential, not cosmetic. `Screen` wraps its children
     * in a ScrollView by default, so the obvious `<Screen><ScrollView>` nests two
     * scrollers ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â and `StepBody` gives its action bar `flex: 1`, which collapses
     * to zero height inside an unbounded scroll container. The result is a wizard
     * that renders perfectly and has no visible Continue button. Handing the
     * scrolling to a single, correctly-configured ScrollView here keeps the action
     * bar in normal flow, so it is always on screen and reachable.
     */
    <Screen testID="onboarding-screen" scrollable={false}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}>
        <StepHeader
          step={current}
          index={index}
          total={steps.length}
          complete={status.complete}
          onJumpTo={goTo}
        />

        {fatal ? (
          <StatusBanner
            title="That did not save"
            description={fatal}
            onRetry={() => setFatal(null)}
          />
        ) : null}
        {state.isError ? (
          <StatusBanner
            title="Your progress could not be loaded"
            description="Check your connection and try again."
            onRetry={() => void state.refetch()}
          />
        ) : null}

        <OnboardingStepView
          stepKey={current.key}
          role={role}
          onNext={handleNext}
          busy={busy}
          canGoBack={index > 0}
          onBack={() => goTo(index - 1)}
          onFinish={handleFinish}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  /**
   * `flexGrow: 1` lets the content fill a tall screen without forcing the action
   * bar to the bottom on a short one ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬ÃƒÂ¢Ã¢â€šÂ¬Ã‚Â on a small phone the bar follows the fields
   * and is reached by scrolling, which is far better than a bar pinned off-screen.
   * The generous bottom padding keeps the last button clear of the Android gesture
   * area even though `Screen` already adds the safe-area inset.
   */
  scroll: {
    flexGrow: 1,
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
  },
});
