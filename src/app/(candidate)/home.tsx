/**
 * Candidate Home.
 *
 * Native reconstruction of the web candidate dashboard
 * (`apps/web/src/routes/candidate/HomePage.tsx`), preserving the section order
 * that page declares:
 *
 *   1. Opportunity stories   4. Personalized feed
 *   2. Composer              5. Continue Learning
 *   3. Quick actions         6. Career snapshot
 *
 * The header sits above all of it as navigation chrome, not as a page section.
 *
 * **One request feeds the whole page.** The web app reads only the profile
 * aggregate (`GET /profile`) and derives completeness, skills, preferences and
 * the feed from it; this screen does the same rather than issuing a second
 * `/profile/completeness` call, so the percentage and the feed can never
 * disagree and there is no duplicate fetching.
 *
 * There is deliberately **no greeting block**: the original removed it so the
 * story row could sit directly under the chrome.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import { fetchProfile } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { useAuth } from '@/auth/AuthContext';
import { CareerSnapshot } from '@/features/home/CareerSnapshot';
import { DashboardHeader } from '@/features/home/DashboardHeader';
import { LearningSection } from '@/features/home/LearningSection';
import { OpportunityStories } from '@/features/home/OpportunityStories';
import { PersonalizedFeed } from '@/features/home/PersonalizedFeed';
import { PostComposer } from '@/features/home/PostComposer';
import { QuickActions } from '@/features/home/QuickActions';
import { styles } from '@/features/home/homeStyles';
import { spacing } from '@/theme/tokens';

export default function CandidateHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { principal } = useAuth();
  const scrollRef = useRef<ScrollView>(null);
  const [learningY, setLearningY] = useState(0);

  const profile = useQuery({
    queryKey: queryKeys.profile,
    queryFn: fetchProfile,
  });

  const status = profile.isPending ? 'loading' : profile.isError ? 'error' : 'ready';
  const message = profile.error instanceof Error ? profile.error.message : null;
  const data = profile.data;
  const retry = () => void profile.refetch();

  const openProfile = useCallback(() => router.push('/profile' as never), [router]);
  const openJobs = useCallback(() => router.push('/jobs' as never), [router]);
  const openLink = useCallback((url: string) => {
    // Project/credential links are the only outbound URLs, and they open in the
    // system browser rather than inside the app.
    void WebBrowser.openBrowserAsync(url);
  }, []);

  const scrollToLearning = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, learningY - spacing.sm), animated: true });
  }, [learningY]);

  if (!principal) return null;

  return (
    <View style={styles.root} testID="home-screen">
      <ScrollView
        ref={scrollRef}
        style={styles.root}
        contentContainerStyle={[
          styles.page,
          { paddingTop: insets.top + spacing.xs, paddingBottom: insets.bottom + spacing.xxl },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        {/* Chrome, not a page section: the header is chrome, and the first
            content section under it is the story row. */}
        <DashboardHeader principal={principal} />

        <OpportunityStories stories={[]} />

        <PostComposer
          name={data?.identity.name ?? principal.name}
          avatarUrl={data?.identity.avatar_url ?? null}
        />

        <QuickActions onScrollToLearning={scrollToLearning} />

        <PersonalizedFeed
          status={status}
          profile={data}
          errorMessage={message}
          onRetry={retry}
          onOpenProfile={openProfile}
          onOpenJobs={openJobs}
          onOpenLink={openLink}
        />

        <LearningSection onLayout={setLearningY} />

        <CareerSnapshot
          status={status}
          profile={data}
          errorMessage={message}
          onRetry={retry}
        />

        <AppText variant="caption" tone="tertiary" style={styles.footnote}>
          Sections light up as their real stages land. Nothing on this page is invented.
        </AppText>
      </ScrollView>
    </View>
  );
}
