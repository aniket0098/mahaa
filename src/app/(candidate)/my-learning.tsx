/**
 * My Learning — the courses the caller is actually enrolled in.
 *
 * Backed by `GET /courses/enrollments/mine` (Stage 6): the student is the
 * token principal, so there is no way to ask for another account's list, and
 * an empty page is a real empty list — never invented rows. The screen shows
 * only what the server sent: the enrolment rows, their count from the page
 * envelope, and the enrolment date already stamped on each row. There is no
 * completion figure here because no endpoint computes one; the plan is to open
 * the course, not to imply a position inside it.
 */

import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { fetchMyEnrollments } from '@/api/courses';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { CourseCard } from '@/components/ui/CourseCard';
import { Screen } from '@/components/ui/Screen';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { enrolledCountLabel, myLearningView } from '@/features/learn/myLearningModel';
import { colors, spacing } from '@/theme/tokens';

export default function MyLearningScreen() {
  const router = useRouter();

  const enrollmentsQuery = useQuery({
    queryKey: queryKeys.myEnrollments,
    queryFn: () => fetchMyEnrollments({ page_size: 20 }),
    staleTime: 30_000,
  });

  const view = myLearningView(enrollmentsQuery);

  return (
    <Screen scrollable={false} testID="my-learning-screen">
      <BackButton label="Back to courses" />

      <View style={styles.header}>
        <AppText variant="h2" tone="primary" weight="semibold">
          My Learning
        </AppText>
        <AppText variant="body" tone="secondary">
          {"Courses you've enrolled in, straight from your account."}
        </AppText>
        {view.kind === 'ready' && (
          <AppText variant="label" tone="tertiary" uppercase>
            {enrolledCountLabel(view.total)}
          </AppText>
        )}
      </View>

      {view.kind === 'loading' && (
        <View style={styles.skeletons} testID="my-learning-loading">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </View>
      )}

      {view.kind === 'error' && (
        <View style={styles.state} testID="my-learning-error">
          <StatusBanner
            title="Couldn't load your courses"
            description={view.message}
            onRetry={() => void enrollmentsQuery.refetch()}
          />
          <Button
            label="Browse courses"
            variant="secondary"
            fullWidth
            onPress={() => router.push('/learn' as never)}
          />
        </View>
      )}

      {view.kind !== 'loading' &&
        view.kind !== 'error' &&
        view.refreshError !== null && (
          <View style={styles.banner}>
            <StatusBanner
              title="Couldn't refresh your courses"
              description={view.refreshError}
              onRetry={() => void enrollmentsQuery.refetch()}
            />
          </View>
        )}

      {view.kind === 'empty' && (
        <View style={styles.state} testID="my-learning-empty">
          <AppText variant="body" tone="secondary" style={styles.emptyCopy}>
            {"You haven't enrolled in any courses yet."}
          </AppText>
          <Button
            label="Browse courses"
            variant="secondary"
            fullWidth
            onPress={() => router.push('/learn' as never)}
          />
        </View>
      )}

      {view.kind === 'ready' && (
        <FlatList
          testID="my-learning-list"
          style={styles.list}
          data={view.items}
          keyExtractor={(item) => item.enrollment.id}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={enrollmentsQuery.isRefetching}
              onRefresh={() => void enrollmentsQuery.refetch()}
              tintColor={colors.colorPrimary}
              colors={[colors.colorPrimary]}
            />
          }
          renderItem={({ item }) => (
            <CourseCard
              course={item.course}
              enrolledAt={item.enrollment.created_at}
              onPress={(course) => router.push(`/course/${course.id}` as never)}
            />
          )}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    gap: spacing.xs,
    paddingBottom: spacing.md,
  },
  banner: {
    marginBottom: spacing.md,
  },
  skeletons: {
    gap: spacing.sm,
  },
  state: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyCopy: {
    textAlign: 'center',
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
});
