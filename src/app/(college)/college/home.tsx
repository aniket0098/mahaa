/**
 * College dashboard — the college's own home, behind the role guard.
 *
 * Everything shown comes from `GET /institutions/mine`, so the counts are real
 * `COUNT`s from the database rather than numbers invented for a nicer-looking
 * screen. A college that has finished onboarding always has at least one
 * institution, so the "none yet" branch is a safety net rather than the normal
 * case.
 */

import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { fetchMyInstitutions } from '@/api/institutions';
import { queryKeys } from '@/api/queryKeys';
import { ApiError } from '@/api/errors';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { RequireRole } from '@/auth/RoleGuard';
import { useAuth } from '@/auth/AuthContext';
import { spacing } from '@/theme/tokens';

export default function CollegeHomeScreen() {
  return (
    <RequireRole allow="college">
      <CollegeHome />
    </RequireRole>
  );
}

function CollegeHome() {
  const { principal } = useAuth();
  const institutions = useQuery({
    queryKey: queryKeys.myInstitutions,
    queryFn: fetchMyInstitutions,
  });

  const mine = institutions.data ?? [];

  return (
    <Screen testID="college-home-screen">
      <View style={styles.stack}>
        <AppText variant="h1" accessibilityRole="header">
          {institutionLabel(principal?.name)}
        </AppText>
        <AppText variant="body" tone="secondary">
          Your institution workspace, your programs, and how employers see them.
        </AppText>

        {institutions.isError ? (
          <StatusBanner
            title="Your institution did not load"
            description={
              institutions.error instanceof ApiError
                ? institutions.error.message
                : 'Please try again.'
            }
            onRetry={() => void institutions.refetch()}
          />
        ) : null}

        {mine.length === 0 && !institutions.isLoading ? (
          <Card style={styles.card}>
            <AppText variant="h3" accessibilityRole="header">
              No institution yet
            </AppText>
            <AppText variant="body" tone="secondary">
              This should not happen after onboarding. If it does, the Institution tab can add
              one.
            </AppText>
          </Card>
        ) : null}

        {mine.map((entry) => (
          <Card key={entry.institution.id} style={styles.card}>
            <AppText variant="h3" accessibilityRole="header">
              {entry.institution.name}
            </AppText>
            {entry.institution.location ? (
              <AppText variant="small" tone="secondary">
                {entry.institution.location}
              </AppText>
            ) : null}
            <AppText variant="label" tone="secondary">
              {`${entry.program_count} ${entry.program_count === 1 ? 'program' : 'programs'}`}
            </AppText>
            <AppText variant="label" tone="secondary">
              {`Verification: ${entry.institution.verification_status}`}
            </AppText>
          </Card>
        ))}
      </View>
    </Screen>
  );
}

/** Falls back to a neutral heading rather than rendering an empty string. */
function institutionLabel(name: string | undefined): string {
  const trimmed = name?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : 'College workspace';
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  card: { gap: spacing.md },
});