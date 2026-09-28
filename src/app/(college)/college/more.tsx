/**
 * College "More" — the hub for destinations that do not warrant a tab.
 *
 * Four tabs is the documented maximum for this tree, so settings is reached from
 * here rather than by widening the bar. Every entry is a real route.
 */

import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { RequireRole } from '@/auth/RoleGuard';
import { useAuth } from '@/auth/AuthContext';
import { spacing } from '@/theme/tokens';

const DESTINATIONS = [
  { path: '/college/settings', title: 'Settings', hint: 'Account and preferences' },
] as const;

export default function CollegeMoreScreen() {
  return (
    <RequireRole allow="college">
      <CollegeMore />
    </RequireRole>
  );
}

function CollegeMore() {
  const router = useRouter();
  const { principal, logout } = useAuth();

  return (
    <Screen testID="college-more-screen">
      <View style={styles.stack}>
        <AppText variant="h1" accessibilityRole="header">
          More
        </AppText>

        <Card style={styles.card}>
          <AppText variant="label" tone="secondary">
            Your account
          </AppText>
          <AppText variant="body" weight="semibold">
            {principal?.name ?? 'Signed in'}
          </AppText>
          {principal?.email ? (
            <AppText variant="small" tone="secondary">
              {principal.email}
            </AppText>
          ) : null}
          {principal?.public_id ? (
            <AppText variant="caption" tone="tertiary">
              {principal.public_id}
            </AppText>
          ) : null}
        </Card>

        <Card style={styles.card}>
          <AppText variant="label" tone="secondary">
            Go to
          </AppText>
          {DESTINATIONS.map((destination) => (
            <Button
              key={destination.path}
              label={`${destination.title} — ${destination.hint}`}
              variant="secondary"
              fullWidth
              onPress={() => router.push(destination.path as never)}
            />
          ))}
        </Card>

        <Button label="Sign out" variant="ghost" fullWidth onPress={() => void logout()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  card: { gap: spacing.md },
});