/**
 * Candidate Home.
 *
 * Native reconstruction of the web candidate dashboard
 * (`apps/web/src/routes/candidate/HomePage.tsx`), with the Community Feed
 * sitting directly under the Stories row and no heading, intro copy, or composer
 * card in between — the feed posts themselves start the section:
 *
 *   1. Opportunity stories   3. Quick actions
 *   2. Community Feed        4. Continue Learning
 *                              5. Career snapshot
 *
 * The header sits above all of it as navigation chrome, not as a page section.
 *
 * The stories row keeps its own Create (+) entry, and the composer card below it
 * is the second way in. Both open the same `/add-post` screen, so there is one
 * composer rather than two.
 *
 * **The profile aggregate feeds the header and the snapshot; the feed has its own
 * request.** `GET /profile` supplies identity, completeness, skills and
 * preferences, so there is no second `/profile/completeness` call and the
 * percentage cannot disagree with what is rendered. The Community Feed reads
 * `GET /posts` itself: the feed shows *published posts*, and a published post is
 * not something the profile aggregate contains. Profile records are deliberately
 * not mixed into it — a project belongs on Profile until somebody chooses
 * to post about it.
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
import { fetchStories } from '@/api/stories';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { useAuth } from '@/auth/AuthContext';
import { CareerSnapshot } from '@/features/home/CareerSnapshot';
import { DashboardHeader } from '@/features/home/DashboardHeader';
import { LearningSection } from '@/features/home/LearningSection';
import { OpportunityStories } from '@/features/home/OpportunityStories';
import { CommunityFeed } from '@/features/feed/CommunityFeed';
import { HomeComposerCard } from '@/features/home/HomeComposerCard';
import { QuickActions } from '@/features/home/QuickActions';
import { useStoryList } from '@/features/stories/useStoryList';
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

  const storiesQuery = useQuery({
    queryKey: queryKeys.stories,
    queryFn: () => fetchStories(),
  });

  const status = profile.isPending ? 'loading' : profile.isError ? 'error' : 'ready';
  const message = profile.error instanceof Error ? profile.error.message : null;
  const data = profile.data;
  const retry = () => void profile.refetch();

  const stories = useStoryList(storiesQuery.data?.items);

  const openProfile = useCallback(() => router.push('/profile' as never), [router]);
  // The Home composer is an entry to the one composer: publishing is owned by
  // `/add-post`, so this navigates rather than mounting a second copy.
  const openComposer = useCallback(() => router.push('/add-post' as never), [router]);
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

        <OpportunityStories stories={stories} />

        <HomeComposerCard
          name={data?.identity.name ?? principal.username}
          avatarUrl={data?.identity.avatar_url ?? null}
          onCompose={openComposer}
        />

        {/* The composer and the feed sit directly under the Stories row. The feed
            runs its own `/posts` request; see the note above. */}
        <CommunityFeed
          status={status}
          errorMessage={message}
          onRetry={retry}
          onOpenProfile={openProfile}
          onOpenLink={openLink}
        />

        <QuickActions onScrollToLearning={scrollToLearning} />

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
