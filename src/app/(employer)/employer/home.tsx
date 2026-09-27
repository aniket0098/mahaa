/**
 * Employer dashboard.
 *
 * The only real employer signal today is the membership list `GET /auth/me`
 * returns, so that is exactly what is rendered: company name, role, status, with
 * no invented pipeline counts. When the employer holds a real membership the
 * screen links into the company workspace, which is backed by `/companies`.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/auth/AuthContext';
import { ConnectionCard } from '@/features/home/ConnectionCard';
import { greeting } from '@/features/home/greeting';
import { colors, radius, spacing } from '@/theme/tokens';

export default function EmployerHomeScreen() {
  const router = useRouter();
  const { principal, logout } = useAuth();
  const memberships = principal?.memberships ?? [];

  return (
    <Screen testID="employer-home-screen">
      <View style={styles.stack}>
        <View style={styles.header}>
          <AppText variant="label" tone="tertiary" uppercase>
            Employer
          </AppText>
          <AppText variant="h1" accessibilityRole="header">
            {greeting(principal?.name ?? 'there')}
          </AppText>
          {principal?.email ? (
            <AppText variant="small" tone="secondary">
              {principal.email}
            </AppText>
          ) : null}
        </View>

        <Card style={styles.card}>
          <AppText variant="label" tone="secondary">
            Your companies
          </AppText>

          {memberships.length === 0 ? (
            <View style={styles.empty}>
              <AppText variant="body">You are not a member of a company yet.</AppText>
              <AppText variant="small" tone="secondary">
                Set up the company you represent to start posting roles.
              </AppText>
              <Button
                label="Set up your company"
                fullWidth
                onPress={() => router.push('/employer/company' as never)}
              />
            </View>
          ) : (
            memberships.map((membership) => (
              <View key={membership.company_id} style={styles.membership}>
                <View style={styles.membershipText}>
                  <AppText variant="body" weight="semibold">
                    {membership.company_name}
                  </AppText>
                  <AppText variant="small" tone="secondary">
                    {membership.role} · {membership.status}
                  </AppText>
                </View>
              </View>
            ))
          )}

          {memberships.length > 0 ? (
            <Button
              label="Open company workspace"
              variant="secondary"
              fullWidth
              onPress={() => router.push('/employer/company' as never)}
            />
          ) : null}
        </Card>

        <Card style={styles.card}>
          <AppText variant="label" tone="secondary">
            Hiring pipeline
          </AppText>
          <AppText variant="small" tone="secondary">
            Opportunities, applicants, messaging, and interviews are not available yet. This app
            shows no metrics for them, because there is no data behind them.
          </AppText>
        </Card>

        <ConnectionCard />

        <Button label="Sign out" variant="ghost" fullWidth onPress={() => void logout()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  header: { gap: 2 },
  card: { gap: spacing.md },
  empty: { gap: spacing.sm },
  membership: {
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    padding: spacing.md,
  },
  membershipText: { gap: 2 },
});