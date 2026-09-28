/**
 * Candidate profile.
 *
 * One request to `GET /profile` renders identity, every stored section, and the
 * server-derived completeness breakdown. A second request, `GET /posts/mine`,
 * supplies the published-post count and the Posts & Activity list — the only
 * endpoint that answers "what has this person actually published".
 *
 * The layout follows the approved reference: a cover with the avatar
 * overlapping it, a statistics row, a compact two-column activity grid, then
 * the content sections in hierarchy order. Every number on this page is a count
 * of records the API returned; where a domain does not exist (connections,
 * followers, leaderboard, hobbies, cover uploads, verification) nothing is
 * rendered for it at all.
 *
 * Each section links to its own screen, which reads and writes the matching
 * `/profile/<section>` endpoints — so the app shows only what the API can
 * actually store.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ScrollView, Share, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';

import { fetchProfile } from '@/api/profile';
import { fetchMyPosts } from '@/api/posts';
import { primeMediaAuth } from '@/api/media';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProgressMeter } from '@/components/ui/ProgressMeter';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { AchievementsSection, CareerPreferencesSection } from '@/features/profile/ProfileGallery';
import { ProfileHeader } from '@/features/profile/ProfileHeader';
import { OwnPostsSection } from '@/features/profile/OwnPostsSection';
import {
  AboutSection,
  JourneySection,
  SkillsSection,
} from '@/features/profile/ProfileSections';
import { ActivityStatsGrid, StatRow } from '@/features/profile/ProfileStats';
import {
  EducationSection,
  ExperienceSection,
  ProjectsSection,
} from '@/features/profile/ProfileTimeline';
import {
  buildActivityCards,
  buildHeaderMeta,
  buildProfileShareMessage,
  buildStatEntries,
  PROFILE_ANCHORS,
  type StatLink,
} from '@/features/profile/profileModel';
import { styles } from '@/features/profile/profileStyles';
import { colors, spacing } from '@/theme/tokens';

export default function CandidateProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  /** Anchor name -> its y offset inside the scroll content. */
  const anchors = useRef<Record<string, number>>({});
  const [shareError, setShareError] = useState<string | null>(null);

  const profile = useQuery({
    queryKey: queryKeys.profile,
    queryFn: fetchProfile,
    retry: false,
  });

  const myPosts = useQuery({
    queryKey: queryKeys.myPosts,
    queryFn: () => fetchMyPosts(50, 0),
    retry: false,
  });

  // Fill the in-memory token cache the feed's image components attach to their
  // requests: the API serves media bytes only to the uploader, so a media
  // thumbnail in an own post cannot be loaded as a plain public URL.
  useEffect(() => {
    void primeMediaAuth();
  }, []);

  /**
   * The anchored sections are direct children of the scroll content, so their
   * `layout.y` already is their offset in the content. Subtracting one section
   * gap lands the heading a comfortable distance below the top edge without
   * needing to measure against the window.
   */
  const captureAnchor = useCallback(
    (name: string) => (event: LayoutChangeEvent) => {
      anchors.current[name] = event.nativeEvent.layout.y;
    },
    [],
  );

  const scrollToAnchor = useCallback((name: string) => {
    const y = anchors.current[name];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.lg), animated: true });
  }, []);

  const navigate = useCallback(
    (link: StatLink) => {
      if (link.kind === 'route') {
        router.push(link.path as never);
        return;
      }
      scrollToAnchor(link.anchor);
    },
    [router, scrollToAnchor],
  );

  const openLink = useCallback((url: string) => {
    void WebBrowser.openBrowserAsync(url);
  }, []);

  const shareProfile = useCallback(() => {
    const current = profile.data;
    if (!current) return;
    setShareError(null);
    const meta = buildHeaderMeta(current.identity, current.education);
    void Share.share({ message: buildProfileShareMessage(current.identity, meta) }).catch(
      (error: unknown) => {
        const dismissed =
          typeof error === 'object' &&
          error !== null &&
          String((error as { message?: string }).message ?? '')
            .toLowerCase()
            .includes('dismiss');
        if (dismissed) return;
        setShareError(
          'Sharing did not start on this device. You can copy your details manually instead.',
        );
      },
    );
  }, [profile.data]);

  if (profile.isPending) {
    return (
      <Screen testID="profile-screen">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={4} />
      </Screen>
    );
  }

  if (profile.isError) {
    return (
      <Screen testID="profile-screen">
        <StatusBanner
          title="Could not load your profile"
          description={
            profile.error instanceof Error ? profile.error.message : 'The API did not answer.'
          }
          onRetry={() => void profile.refetch()}
        />
      </Screen>
    );
  }

  const data = profile.data;
  if (!data) return null;

  const meta = buildHeaderMeta(data.identity, data.education);
  const statEntries = buildStatEntries({
    postsTotal: myPosts.data?.total ?? null,
    postsLoading: myPosts.isPending,
    projectCount: data.projects.length,
    skillCount: data.skills.length,
  });
  const activityCards = buildActivityCards(data);
  const postsStatus: 'loading' | 'error' | 'ready' = myPosts.isPending
    ? 'loading'
    : myPosts.isError
      ? 'error'
      : 'ready';

  return (
    <Screen testID="profile-screen" scrollable={false} flush>
      <ScrollView
        ref={scrollRef}
        style={styles.root}
        contentContainerStyle={{
          paddingBottom: insets.bottom + spacing.xxl,
          paddingTop: insets.top,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled">
        <View style={styles.page}>
          <ProfileHeader
            identity={data.identity}
            meta={meta}
            onEdit={() => router.push('/profile/edit' as never)}
            onShare={shareProfile}
          />

          {shareError ? (
            <View style={styles.padded}>
              <StatusBanner title="Could not share" description={shareError} />
            </View>
          ) : null}

          <View style={[styles.padded, styles.stack]}>
            <StatRow entries={statEntries} onNavigate={navigate} />

            <View style={styles.section}>
              <SectionHeader
                title="Activity Statistics"
                description="Your progress and achievements"
              />
              <ActivityStatsGrid cards={activityCards} onNavigate={navigate} />
            </View>

            <AboutSection summary={data.identity.summary} onEdit={() => router.push('/profile/edit' as never)} />
            <JourneySection
              interests={data.identity.interests}
              onEdit={() => router.push('/profile/edit' as never)}
            />
            <SkillsSection
              skills={data.skills}
              onEdit={() => router.push('/profile/skills' as never)}
            />
            <EducationSection
              education={data.education}
              onEdit={() => router.push('/profile/education' as never)}
            />
            <ExperienceSection
              experience={data.experience}
              onEdit={() => router.push('/profile/experience' as never)}
            />
            <ProjectsSection
              projects={data.projects}
              onEdit={() => router.push('/profile/projects' as never)}
              onOpenLink={openLink}
            />
            <AchievementsSection
              certifications={data.certifications}
              achievements={data.achievements}
              onEditCertifications={() => router.push('/profile/certifications' as never)}
              onEditAchievements={() => router.push('/profile/achievements' as never)}
              onOpenLink={openLink}
            />
            <CareerPreferencesSection
              preferences={data.preferences}
              onEdit={() => router.push('/profile/preferences' as never)}
            />
          </View>

          {/* Both anchored blocks are direct children of the scroll content, so
              their `layout.y` is the offset the Posts statistic scrolls to. */}
          <View
            style={styles.padded}
            onLayout={captureAnchor(PROFILE_ANCHORS.posts)}
            collapsable={false}>
            <OwnPostsSection
              status={postsStatus}
              posts={myPosts.data?.items ?? []}
              total={myPosts.data?.total ?? 0}
              errorMessage={myPosts.error instanceof Error ? myPosts.error.message : null}
              onRetry={() => void myPosts.refetch()}
              onCreate={() => router.push('/add-post' as never)}
              onOpenProfile={() => undefined}
              onOpenLink={openLink}
            />
          </View>

          <View
            style={[styles.padded, styles.stack]}
            onLayout={captureAnchor(PROFILE_ANCHORS.completeness)}
            collapsable={false}>
            <Card style={styles.card}>
              <ProgressMeter
                value={data.completeness.percent}
                label="Profile completeness"
                caption="Calculated by the server, not this app."
              />
              <View style={styles.sections}>
                {data.completeness.sections.map((section) => (
                  <View key={section.key} style={styles.sectionRow}>
                    <View
                      style={[
                        styles.marker,
                        {
                          backgroundColor: section.complete
                            ? colors.colorSuccess
                            : colors.colorBorderStrong,
                        },
                      ]}
                    />
                    <View style={styles.sectionText}>
                      <AppText variant="small" weight="semibold">
                        {section.label}
                      </AppText>
                      <AppText variant="caption" tone="tertiary">
                        {section.hint}
                      </AppText>
                    </View>
                  </View>
                ))}
              </View>
            </Card>

            <Card style={styles.card}>
              <SectionHeader title="Account" />
              <Button
                label="Notifications"
                variant="ghost"
                fullWidth
                onPress={() => router.push('/notifications' as never)}
              />
              <Button
                label="Settings"
                variant="ghost"
                fullWidth
                onPress={() => router.push('/settings' as never)}
              />
            </Card>

            <Button
              label="Refresh"
              variant="ghost"
              fullWidth
              onPress={() => {
                void profile.refetch();
                void myPosts.refetch();
              }}
            />
          </View>
        </View>
      </ScrollView>
    </Screen>
  );
}