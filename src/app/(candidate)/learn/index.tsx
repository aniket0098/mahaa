/**
 
 *
 * Premium learning home: a featured hero banner, Recommended lectures,
 * Popular Topics, a working demo playlist, and the full All Lectures
 * catalogue â€” all backed by real server rows.
 *
 * Data spine, all real server rows:
 *  - GET /courses â€” the catalogue page (q = search, category = topic filter)
 *  - GET /courses/{id} for a bounded slice â€” the only way the server
 *    exposes lectures (there is no lecture-feed endpoint).
 *
 * There is no lecture-feed endpoint, no popularity counts, and no comments
 * API on the server. The Trending band is honestly labeled Recommended;
 * topics are derived from real course categories; the playlist is a clearly
 * labeled demo. Nothing here is invented.
 */

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { fetchCourse, fetchCourses } from '@/api/courses';
import { queryKeys } from '@/api/queryKeys';
import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { FeaturedLectureCard } from '@/features/learningHub/FeaturedLectureCard';
import { HubHeader } from '@/features/learningHub/HubHeader';
import { LectureCard } from '@/features/learningHub/LectureCard';
import { DemoLectureCard } from '@/features/learningHub/DemoLectureCard';
import { PlaylistCard } from '@/features/learningHub/PlaylistCard';
import { DEMO_PLAYLIST } from '@/features/learningHub/demoPlaylist';
import {
  FEED_COURSE_LIMIT,
  buildCatalog,
  buildLectureFeed,
  filterCatalogItems,
  hubFeedView,
  pickRecommendedLectures,
  topicsFromCourses,
  type CatalogItem,
  type CatalogFilter,
  type LectureFeedItem,
  type TopicChip,
} from '@/features/learningHub/learningHubModel';
import { formatLectureDuration } from '@/features/learn/courseDetailModel';
import { useSavedItems } from '@/features/learn/savedModel';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';

const SEARCH_DEBOUNCE_MS = 300;


/** Inline search field for the lecture feed. */
function SearchBar({
  value,
  onChangeText,
  onClear,
  isFocused,
  onFocus,
  onBlur,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
  isFocused: boolean;
  onFocus: () => void;
  onBlur: () => void;
}) {
  const inputRef = useRef<TextInput>(null);
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel="Search lectures"
      accessibilityHint="Type to search lectures by title, topic or skills"
      onPress={() => void inputRef.current?.focus()}
      hitSlop={8}
      style={[styles.searchContainer, isFocused && styles.searchContainerFocused]}>
      <AppIcon
        name={{ ios: 'magnifyingglass', android: 'search' }}
        size={20}
        color={isFocused ? colors.colorPrimary : colors.colorTextTertiary}
      />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={onFocus}
        onBlur={onBlur}
        placeholder="Search lectures, topics or skills"
        placeholderTextColor={colors.colorTextTertiary}
        style={styles.searchInput}
        returnKeyType="search"
        spellCheck={false}
        autoCapitalize="none"
        autoCorrect={false}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={onClear}
          hitSlop={8}
          accessibilityLabel="Clear search"
          accessibilityHint="Clears the search query and restores the catalogue"
          style={styles.clearButton}>
          <AppIcon
            name={{ ios: 'xmark.circle.fill', android: 'close' }}
            size={20}
            color={colors.colorTextTertiary}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

/** One recommended lecture in the horizontal Recommended band. */
function RecommendedRow({ item, onPress }: { item: LectureFeedItem; onPress: (item: LectureFeedItem) => void }) {
  const duration = (() => {
    const m = Math.floor((item.durationSeconds ?? 0) / 60);
    const s = (item.durationSeconds ?? 0) % 60;
    return item.durationSeconds != null ? `${m}:${s.toString().padStart(2, '0')}` : null;
  })();
  return (
    <View style={styles.recommendedCard}>
      <Pressable
        onPress={() => onPress(item)}
        accessibilityLabel="Lecture: From ."
        style={styles.recommendedPressable}>
        <View style={styles.recommendedThumb}>
          <View style={styles.recommendedPoster} />
          {renderDurationChip(duration)}
        </View>
        <View style={styles.recommendedBody}>
          <AppText variant="small" tone="secondary" numberOfLines={1} style={styles.recommendedCategory}>
            {item.category ?? ''}
          </AppText>
          <AppText variant="body" weight="semibold" numberOfLines={2} style={styles.recommendedTitle}>
            {item.title}
          </AppText>
          <AppText variant="caption" tone="secondary" numberOfLines={1} style={styles.recommendedMeta}>
            {item.instructorName}
          </AppText>
        </View>
      </Pressable>
    </View>
  );
}

function renderDurationChip(duration: string | null) {
  if (!duration) return null;
  return (
    <View style={styles.recommendedDurationChip}>
      <AppText variant="caption" weight="medium" tone="onPrimary">
        {duration}
      </AppText>
    </View>
  );
}

export default function LecturesHomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const { savedItems, saveMutation, unsaveMutation } = useSavedItems();
  const isSavePending = saveMutation.isPending || unsaveMutation.isPending;

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<'recent' | 'title'>('recent');
  const [isSearchFocused, setIsSearchFocused] = useState(false);

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    const timer = setTimeout(() => setDebouncedSearch(text), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const clearSearch = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
  }, []);

  const clearFilters = useCallback(() => {
    clearSearch();
    setTopic(null);
    setSort('recent');
  }, [clearSearch]);

  const params = useMemo(() => {
    const p: { q?: string; category?: string; page_size?: number } = { page_size: 20 };
    if (debouncedSearch.trim()) p.q = debouncedSearch.trim();
    if (topic) p.category = topic;
    return p;
  }, [debouncedSearch, topic]);

  const coursesQuery = useQuery({
    queryKey: [...queryKeys.courses(), params],
    queryFn: () => fetchCourses(params),
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
  });

  const courses = coursesQuery.data?.items ?? [];
  const courseIds = courses.slice(0, FEED_COURSE_LIMIT).map((c: any) => c.id);

  const detailsQueries = useQueries({
    queries: courseIds.map((courseId: string) => ({
      queryKey: queryKeys.course(courseId),
      queryFn: () => fetchCourse(courseId),
      staleTime: 60_000,
    })),
    combine: (results) => results.map((r) => r.data),
  });

  const details = detailsQueries.data ?? [];
  const items = buildLectureFeed(courses, details);
  const view = hubFeedView({
    coursesHasData: coursesQuery.data != null,
    coursesLoading: coursesQuery.isLoading,
    coursesError: coursesQuery.error,
    detailsPending: detailsQueries.length - details.filter(Boolean).length,
    detailsFailed: detailsQueries.filter((r) => r.isError).length,
    detailError: detailsQueries.find((r) => r.error)?.error ?? null,
    items,
  });

  const featured = (view.kind === 'ready' && view.featured) || items[0] ?? null;
  const recommended = pickRecommendedLectures(items, RECOMMENDED_LIMIT);
  const topics: TopicChip[] = topicsFromCourses(courses);

  const catalog = useMemo(() => {
    return buildCatalog(items, DEMO_PLAYLIST.lectures, DEMO_PLAYLIST.title);
  }, [items]);

  const filter = useMemo<CatalogFilter>(() => ({ search: debouncedSearch, topic, sort }), [debouncedSearch, topic, sort]);

  const allItems = useMemo(() => {
    return filterCatalogItems(catalog, filter);
  }, [catalog, filter]);

  const hasActiveFilters = debouncedSearch.trim().length > 0 || topic !== null || sort !== 'recent';
  const anyTopics = topics.length > 0;

  const openLecture = (lectureId: string, courseId: string) => {
    void router.push(`/lecture/${lectureId}?courseId=${courseId}` as never);
  };

  const refetchEverything = useCallback(() => {
    void coursesQuery.refetch();
    void detailsQueries[0]?.refetch?.();
  }, [coursesQuery, detailsQueries]);

  const hasAnything =
    view.kind === 'ready' ||
    recommended.length > 0 ||
    anyTopics ||
    allItems.length > 0;

  // When the catalogue fails entirely with no cached data, show the error.
  if (view.kind === 'error' && !hasAnything) {
    return (
      <View style={styles.root}>
        <HubHeader title="Lectures" kicker="LEARNING HUB" onSearch={() => {}} testID="lectures-header" />
        <StatusBanner title="Could not load lectures" onRetry={refetchEverything} />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingBottom: insets.bottom + layout.bottomNavHeight + spacing.xl }]}>
      <HubHeader
        title="Lectures"
        kicker="LEARNING HUB"
        onSearch={() => {}}
        testID="lectures-header"
      />

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <SearchBar
          value={search}
          onChangeText={handleSearchChange}
          onClear={clearSearch}
          isFocused={isSearchFocused}
          onFocus={() => setIsSearchFocused(true)}
          onBlur={() => setIsSearchFocused(false)}
        />
      </View>

      {/* Featured hero */}
      {view.kind === 'ready' && featured ? (
        <View style={styles.sectionWrap}>
          <FeaturedLectureCard item={featured} onPress={(lecture) =>
            openLecture(lecture.lectureId, lecture.courseId)} />
        </View>
      ) : null}

      {/* Recommended lectures */}
      {view.kind === 'ready' && recommended.length > 0 ? (
        <View style={styles.sectionWrap}>
          <SectionHeader
            title="Recommended"
            description="Picked for you from the catalogue"
            action={
              <Pressable onPress={() => {}} accessibilityLabel="See all lectures">
                <AppText variant="small" weight="semibold" style={styles.seeAll}>
                  See All
                </AppText>
              </Pressable>
            }
          />
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={recommended}
            keyExtractor={(item: any) => item.lectureId}
            renderItem={({ item }) => (
              <RecommendedRow item={item} onPress={(lecture) =>
                openLecture(lecture.lectureId, lecture.courseId)} />
            )}
            contentContainerStyle={styles.recommendedList}
            ItemSeparatorComponent={() => <View style={styles.recommendedSeparator} />}
          />
        </View>
      ) : null}

      {/* Popular Topics */}
      {anyTopics ? (
        <View style={styles.sectionWrap}>
          <SectionHeader
            title="Popular Topics"
            description="Browse lectures by topic"
            action={
              <Pressable onPress={() => {}} accessibilityLabel="See all topics">
                <AppText variant="small" weight="semibold" style={styles.seeAll}>
                  See All
                </AppText>
              </Pressable>
            }
          />
          <View style={styles.chipList}>
            {topics.map((chip) => {
              const selected = topic === chip.id;
              return (
                <Pressable
                  key={chip.id}
                  onPress={() => setTopic(selected ? null : chip.id)}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  accessibilityLabel={chip.name}
                  testID={`topic-chip-${chip.id}`}
                  style={[styles.topicChip, selected && styles.topicChipSelected]}>
                  <AppText variant="small" weight="medium" style={[styles.topicChipLabel, selected && styles.topicChipLabelSelected]}>
                    {chip.name}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : null}

      {/* Lecture Playlists */}
      <View style={styles.sectionWrap}>
        <SectionHeader
          title="Lecture Playlists"
          description="Guided sequences of lessons"
          action={
            <Pressable onPress={() => {}} accessibilityLabel="See all playlists">
              <AppText variant="small" weight="semibold" style={styles.seeAll}>
                See All
              </AppText>
            </Pressable>
          }
        />
        <View style={styles.playlistRow}>
          <PlaylistCard
            playlist={DEMO_PLAYLIST}
            onPress={(playlist) => {
              void router.push(`/learn/playlists/${playlist.id}` as never);
            }}
          />
        </View>
      </View>

      {/* All Lectures */}
      <View style={styles.sectionWrap}>
        <SectionHeader
          title="All Lectures"
          description={`${allItems.length} lecture${allItems.length === 1 ? "" : "s"} in the catalogue`}
          action={
            <Pressable onPress={() => {}} accessibilityLabel="Open full catalogue">
              <AppText variant="small" weight="semibold" style={styles.seeAll}>
                See All
              </AppText>
            </Pressable>
          }
        />
        {view.kind === 'loading' && allItems.length === 0 ? (
          <View style={styles.states}>
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} lines={3} />
            ))}
          </View>
        ) : allItems.length === 0 ? (
          <View style={styles.emptyState}>
            <AppText variant="h3" weight="semibold" style={styles.emptyTitle}>
              {hasActiveFilters ? 'No lectures found' : 'No lectures available yet'}
            </AppText>
            <AppText variant="small" tone="secondary" style={styles.emptyBody}>
              {hasActiveFilters
                ? 'Try another title, topic, or skill.'
                : 'New learning content will appear here as courses are published.'}
            </AppText>
            {hasActiveFilters ? (
              <Button
                label="Reset filters"
                variant="secondary"
                fullWidth
                onPress={clearFilters}
              />
            ) : null}
          </View>
        ) : (
          <FlatList
            data={allItems}
            keyExtractor={(item: CatalogItem) => item.id}
            renderItem={({ item }) => (
              <View style={styles.feedRow}>
                {item.isDemo ? (
                  <DemoLectureCard
                    item={item}
                    onPress={(demoItem) => {
                      void router.push(
                        `/learn/demo/${demoItem.id}` as never
                      );
                    }}
                  />
                ) : (
                  <LectureCard
                    item={item as LectureFeedItem}
                    onPress={(lecture) =>
                      openLecture(lecture.lectureId, lecture.courseId)}
                  />
                )}
              </View>
            )}
            contentContainerStyle={styles.listContent}
            refreshControl={
              <RefreshControl
                refreshing={coursesQuery.isRefetching || isSavePending}
                onRefresh={refetchEverything}
                tintColor={colors.colorPrimary}
                colors={[colors.colorPrimary]}
              />
            }
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.colorBgPage,
  },
  searchWrap: {
    paddingHorizontal: spacing.pagePadding,
    marginBottom: spacing.sm,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
    minHeight: layout.inputHeight,
  },
  searchContainerFocused: {
    borderColor: colors.colorPrimary,
  },
  searchInput: {
    flex: 1,
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeBody,
  },
  clearButton: {
    padding: spacing.xs,
  },
  sectionWrap: {
    paddingHorizontal: spacing.pagePadding,
    marginBottom: spacing.sm,
  },
  recommendedCard: {
    width: 156,
    marginRight: spacing.sm,
  },
  recommendedPressable: {
    alignItems: 'flex-start',
  },
  recommendedThumb: {
    width: 156,
    height: 88,
    borderRadius: radius.card,
    backgroundColor: colors.colorBgMuted,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: spacing.xs,
  },
  recommendedPoster: {
    width: '100%',
    height: '100%',
  },
  recommendedDurationChip: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    backgroundColor: colors.colorOverlay,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 2,
  },
  recommendedBody: {
    gap: 2,
  },
  recommendedCategory: {
    fontSize: typography.fontSizeCaption,
  },
  recommendedTitle: {
    fontSize: typography.fontSizeBody,
    fontWeight: typography.fontWeightSemibold,
    lineHeight: typography.lineHeightBody,
  },
  recommendedMeta: {
    fontSize: typography.fontSizeCaption,
  },
  recommendedList: {
    paddingHorizontal: spacing.pagePadding,
    paddingBottom: spacing.sm,
  },
  recommendedSeparator: {
    width: spacing.sm,
  },
  chipList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.pagePadding,
    paddingBottom: spacing.sm,
  },
  topicChip: {
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 40,
    alignItems: 'center',
  },
  topicChipSelected: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorPrimary,
  },
  topicChipLabel: {
    fontSize: typography.fontSizeSmall,
    color: colors.colorTextSecondary,
  },
  topicChipLabelSelected: {
    color: colors.colorPrimary,
    fontWeight: typography.fontWeightSemibold,
  },
  playlistRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.pagePadding,
    paddingBottom: spacing.sm,
  },
  states: {
    paddingHorizontal: spacing.pagePadding,
    gap: spacing.sm,
    paddingBottom: spacing.lg,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.pagePadding,
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyTitle: {
    fontSize: typography.fontSizeH3,
    fontWeight: typography.fontWeightSemibold,
    color: colors.colorTextPrimary,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: typography.fontSizeSmall,
    color: colors.colorTextSecondary,
    textAlign: 'center',
  },
  feedRow: {
    paddingHorizontal: spacing.pagePadding,
    marginBottom: spacing.sm,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },
  seeAll: {
    color: colors.colorPrimary,
  },
});



