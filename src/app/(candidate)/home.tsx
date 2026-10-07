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
 * The stories row keeps its own Create (+) entry, and a compact blue Create Post
 * (+) circle sits beside it. Both open the same `/add-post` screen, so there is
 * one composer rather than two — and no composer card between Stories and Feed.
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { AppState, ScrollView, View } from 'react-native';
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
import { resumePlayback, setViewport, suspendPlayback } from '@/features/feed/feedPlayback';
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
  // The visible viewport height, captured once the ScrollView lays out, so the
  // playback coordinator has a viewport before the first scroll event — without
  // it the first video could never be chosen as active and nothing would autoplay
  // on open. The offset rests at zero until the reader moves.
  const scrollOffsetRef = useRef(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  // Content-relative y of the wrapper around the feed. The wrapper sits between
  // the ScrollView and the feed section, so the feed's own `onLayout` y starts
  // at zero inside it — without adding this, every video slot would be measured
  // from the wrapper instead of from the top of the page and autoplay would fire
  // at the wrong scroll position (or never).
  const [feedOriginY, setFeedOriginY] = useState(0);

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

  // The identity the header, the stories row and the composer card all show. Read
  // from the one profile aggregate rather than re-fetched per section, so the
  // avatar in a story bubble cannot disagree with the one in the header.
  const profileName = data?.identity.name ?? principal?.username ?? 'You';
  const profileAvatar = data?.identity.avatar_url ?? null;

  const openProfile = useCallback(() => router.push('/profile' as never), [router]);
  const openLink = useCallback((url: string) => {
    // Project/credential links are the only outbound URLs, and they open in the
    // system browser rather than inside the app.
    void WebBrowser.openBrowserAsync(url);
  }, []);

  const scrollToLearning = useCallback(() => {
    scrollRef.current?.scrollTo({ y: Math.max(0, learningY - spacing.sm), animated: true });
  }, [learningY]);

  // **The coordinator needs a viewport before the first scroll event.** `onLayout`
  // supplies the visible height; the offset rests at zero until the reader moves.
  useEffect(() => {
    if (viewportHeight > 0) {
      setViewport({ offset: scrollOffsetRef.current, height: viewportHeight });
    }
  }, [viewportHeight]);

  // **Pause the feed's audio whenever Home is not the front screen.** Blur (a
  // pushed screen or another tab) and backgrounding both stop playback; returning
  // resumes it. The AppState listener lives only while focused, because
  // `useFocusEffect`'s cleanup removes it on blur.
  useFocusEffect(
    useCallback(() => {
      resumePlayback();
      const subscription = AppState.addEventListener('change', (state) => {
        if (state === 'active') resumePlayback();
        else suspendPlayback();
      });
      return () => {
        suspendPlayback();
        subscription.remove();
      };
    }, []),
  );

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
        keyboardShouldPersistTaps="handled"
        // **The feed's playback coordinator needs the scroll offset.** A video
        // cannot know whether it is on screen without knowing where the reader is,
        // and a nested scroll view inside the feed would break the single page
        // scroll the Home layout depends on. `scrollEventThrottle` is what turns
        // this from "on scroll end" into a live signal; without it the coordinator
        // would only ever see the resting position.
        scrollEventThrottle={32}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
        onScroll={(event) => {
          const { contentOffset, layoutMeasurement } = event.nativeEvent;
          scrollOffsetRef.current = contentOffset.y;
          setViewport({
            offset: contentOffset.y,
            height: layoutMeasurement.height,
          });
        }}>
        {/* Chrome, not a page section: the header is chrome, and the first
            content section under it is the story row. */}
        <DashboardHeader principal={principal} />

        {/* The stories row's first bubble needs the caller's own avatar, which
            Home already has from the same profile aggregate the header reads —
            so it is threaded through rather than fetched a second time. */}
        <OpportunityStories stories={stories} name={profileName} avatarUrl={profileAvatar} />

        {/* The feed sits directly under the Stories & Opportunities row — no
            composer card in between, and only a small rhythm gap. The feed runs
            its own `/posts` request; see the note above. */}
        <View
          style={styles.feedPullUp}
          onLayout={({ nativeEvent }) => setFeedOriginY(nativeEvent.layout.y)}>
          <CommunityFeed
            originOffset={feedOriginY}
            status={status}
            errorMessage={message}
            onRetry={retry}
            onOpenProfile={openProfile}
            onOpenLink={openLink}
          />
        </View>

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
