/**
 * College settings.
 *
 * Mirrors the employer settings screen: it shows the account exactly as
 * `GET /auth/me` returns it and offers sign-out. It does not offer a preference
 * the server would silently discard, because a control that appears to work and
 * does nothing is worse than an absent one.
 */

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { RequireRole } from '@/auth/RoleGuard';
import { useAuth } from '@/auth/AuthContext';
import { spacing } from '@/theme/tokens';

export default function CollegeSettingsScreen() {
  return (
    <RequireRole allow="college">
      <CollegeSettings />
    </RequireRole>
  );
}

function CollegeSettings() {
  const { principal, logout } = useAuth();

  return (
    <Screen testID="college-settings-screen">
      <View style={styles.stack}>
        <BackButton />
        <AppText variant="h1" accessibilityRole="header">
          Settings
        </AppText>

        <Card style={styles.card}>
          <SectionHeader title="Account" />
          <AppText variant="body" weight="semibold">
            {principal?.name ?? 'Signed in'}
          </AppText>
          {principal?.email ? (
            <AppText variant="small" tone="secondary">
              {principal.email}
            </AppText>
          ) : null}
          {principal?.username ? (
            <AppText variant="caption" tone="tertiary">
              {`@${principal.username}`}
            </AppText>
          ) : null}
          {principal?.public_id ? (
            <AppText variant="caption" tone="tertiary">
              {`Public ID: ${principal.public_id}`}
            </AppText>
          ) : null}
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