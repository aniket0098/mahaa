/**
 * Employer "More" — the hub for destinations that do not warrant a tab.
 *
 * Five tabs is the documented maximum, so messages, notifications, and settings
 * are reached from here rather than by widening the tab bar. Every entry is a
 * real route; the ones whose domain has not shipped say so on their own screen.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/auth/AuthContext';
import { spacing } from '@/theme/tokens';

const DESTINATIONS = [
  { path: '/employer/messages', title: 'Messages', hint: 'Candidate conversations' },
  { path: '/employer/notifications', title: 'Notifications', hint: 'Applicants and reminders' },
  { path: '/employer/settings', title: 'Settings', hint: 'Account and preferences' },
] as const;

export default function EmployerMoreScreen() {
  const router = useRouter();
  const { principal, logout } = useAuth();

  return (
    <Screen testID="employer-more-screen">
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
          {principal?.role ? (
            <AppText variant="caption" tone="tertiary">
              Role: {principal.role}
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