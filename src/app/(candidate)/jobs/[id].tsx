/**
 * Opportunity detail — the real `/jobs/[id]` route.
 *
 * Fetches the selected opportunity by the id from the path through
 * `GET /opportunities/{id}` (see `useOpportunityDetail`). It used to echo the
 * id inside a `StageScreen`; it now shows the actual posting. Every outcome is
 * handled honestly:
 *
 *  - no/blank id            -> an "incomplete link" notice with a way back;
 *  - loading                -> a detail-shaped skeleton;
 *  - 404 (unknown/closed)   -> a "no longer available" notice with a way back;
 *  - other fetch failure    -> a persistent error banner with Retry;
 *  - success                -> the opportunity's real fields.
 *
 * The `BackButton` is unconditional: the shells render no header, so without
 * it a detail route reached by deep link would be a dead end (asserted by
 * `routeTree.test.ts`).
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { ApiError } from '@/api/errors';
import { OpportunityDetailContent } from '@/features/jobs/OpportunityDetailContent';
import { OpportunityDetailSkeleton } from '@/features/jobs/OpportunitySkeleton';
import { useOpportunityDetail } from '@/features/jobs/useOpportunityDetail';
import { spacing } from '@/theme/tokens';

export default function JobDetailsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const validId = id && id.trim() ? id : undefined;

  const detail = useOpportunityDetail(validId);
  const isNotFound = detail.error instanceof ApiError && detail.error.status === 404;

  const backToDiscover = () => router.replace('/jobs' as never);

  return (
    <Screen testID="job-detail">
      <BackButton />

      {/* A missing id is checked before the query state: the query is disabled
          without one, so it would otherwise read as "loading" forever. */}
      {!validId ? (
        <Card>
          <View style={styles.notice}>
            <AppText variant="h3" weight="semibold">
              This opportunity link is incomplete
            </AppText>
            <AppText variant="small" tone="secondary">
              No opportunity id was found in the address. Head back to Discover to browse open roles.
            </AppText>
            <Button label="Back to Discover" onPress={backToDiscover} />
          </View>
        </Card>
      ) : detail.isPending ? (
        <OpportunityDetailSkeleton />
      ) : isNotFound ? (
        <Card>
          <View style={styles.notice}>
            <AppText variant="h3" weight="semibold">
              This opportunity is no longer available
            </AppText>
            <AppText variant="small" tone="secondary">
              It may have been removed or closed, or the link may be out of date.
            </AppText>
            <Button label="Back to Discover" onPress={backToDiscover} />
          </View>
        </Card>
      ) : detail.isError ? (
        <Card>
          <StatusBanner
            title="This opportunity could not be loaded"
            description={
              detail.error instanceof Error && detail.error.message
                ? detail.error.message
                : 'Please try again.'
            }
            onRetry={() => void detail.refetch()}
          />
        </Card>
      ) : detail.data ? (
        <OpportunityDetailContent opportunity={detail.data} />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  notice: {
    gap: spacing.sm,
  },
});