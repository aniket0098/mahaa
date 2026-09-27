/**
 * Employer settings.
 *
 * There is no employer settings endpoint in V1, so this screen does the two
 * things it can do honestly: show the account exactly as `GET /auth/me` returns
 * it, and offer sign-out. It never offers a preference that the server would
 * silently discard.
 */
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { useAuth } from '@/auth/AuthContext';
import { spacing } from '@/theme/tokens';

export default function EmployerSettingsScreen() {
  const { principal, logout } = useAuth();
  const memberships = principal?.memberships ?? [];

  return (
    <Screen testID="employer-settings-screen">
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
          {principal?.role ? (
            <AppText variant="caption" tone="tertiary">
              Role: {principal.role}
            </AppText>
          ) : null}
        </Card>

        <Card style={styles.card}>
          <SectionHeader title="Companies" />
          {memberships.length === 0 ? (
            <AppText variant="small" tone="secondary">
              You are not a member of a company yet.
            </AppText>
          ) : (
            memberships.map((membership) => (
              <AppText key={membership.company_id} variant="small" tone="secondary">
                {membership.company_name} · {membership.role} · {membership.status}
              </AppText>
            ))
          )}
          <AppText variant="caption" tone="tertiary">
            Employer preferences, notification settings, and data export arrive with the settings
            stage. Nothing here is saved locally in the meantime.
          </AppText>
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