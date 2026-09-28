/**
 * The end of onboarding â€” a confirmation, then the way to the dashboard.
 *
 * Reached only after the server has reported every required step complete, so the
 * screen never has to decide anything itself. It shows the **server's** public ID
 * and the server's completion percentage rather than anything computed locally,
 * because those are the two numbers a person will quote to somebody else.
 *
 * If the server ever says the flow is *not* complete (a step was undone from
 * another screen between finishing and arriving here), this screen says so and
 * offers the wizard rather than pretending the job is done.
 */

import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { fetchOnboardingState } from '@/api/onboarding';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { useAuth } from '@/auth/AuthContext';
import { ONBOARDING_ROUTE, homePathForRole } from '@/auth/roleHome';
import { useRouter } from 'expo-router';
import { spacing } from '@/theme/tokens';

export default function OnboardingCompleteScreen() {
  const router = useRouter();
  const { principal } = useAuth();

  const state = useQuery({
    queryKey: queryKeys.onboarding,
    queryFn: fetchOnboardingState,
    refetchOnMount: 'always',
  });

  const done = state.data?.state === 'completed';
  const home = homePathForRole(principal?.role ?? 'candidate');

  return (
    <Screen testID="onboarding-complete-screen">
      <View style={styles.stack}>
        <AppText variant="h1" accessibilityRole="header">
          {done ? 'You are all set' : 'Not finished yet'}
        </AppText>
        <AppText variant="body" tone="secondary">
          {done
            ? 'Your account is ready. You can change any of this later from your profile.'
            : 'Something is still outstanding. The server has not marked your onboarding complete.'}
        </AppText>

        {!done ? (
          <StatusBanner
            title="There is still work to do"
            description="Go back to the step that is not finished yet."
          />
        ) : null}

        <Card style={styles.card}>
          <AppText variant="label" tone="secondary">
            Your public ID
          </AppText>
          <AppText variant="h2" accessibilityRole="header">
            {principal?.public_id ?? 'â€”'}
          </AppText>
          <AppText variant="small" tone="tertiary">
            This is permanent and is how employers and colleges identify you. It never changes.
          </AppText>
        </Card>

        {state.data ? (
          <Card style={styles.card}>
            <AppText variant="label" tone="secondary">
              Profile completeness
            </AppText>
            <AppText variant="h2" accessibilityRole="header">
              {`${state.data.percent}%`}
            </AppText>
            <AppText variant="small" tone="tertiary">
              This is the server&rsquo;s own number. It will keep rising as you add
              photo, and a resume.
            </AppText>
          </Card>
        ) : null}

        {done ? (
          <Button
            label="Go to my dashboard"
            size="lg"
            fullWidth
            onPress={() => router.replace(home as never)}
          />
        ) : (
          <Button
            label="Back to onboarding"
            size="lg"
            fullWidth
            onPress={() => router.replace(ONBOARDING_ROUTE as never)}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  card: { gap: spacing.md },
});
