/* Saved section — premium learning library. */

import { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { fetchCourse, fetchCourses } from '@/api/courses';
import { queryKeys } from '@/api/queryKeys';
import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { LecturePoster } from '@/features/learningHub/LecturePoster';
import { formatLectureDuration, lectureKindLabel } from '@/features/learn/courseDetailModel';
import { useSavedItems } from '@/features/learn/savedModel';
import { isVideoLecture } from '@/features/learningHub/learningHubModel';
import type { Course, CourseLecture } from '@/types/course';
import type { SavedItem, SavedItemType } from '@/types/saved';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';

type FilterType = 'all' | 'lecture' | 'course';
type SortOption = 'recent' | 'oldest' | 'title-asc' | 'title-desc';

const SORT_LABELS: Record<SortOption, string> = {
  recent: 'Recent',
  oldest: 'Oldest',
  'title-asc': 'A–Z',
  'title-desc': 'Z–A',
};
function SavedLectureCard({
  item,
  course,
  lecture,
  savedAt,
  isPending,
  onOpen,
  onRemove,
  onMore,
}: {
  item: SavedItem;
  course: Course | undefined;
  lecture: CourseLecture | undefined;
  savedAt: string;
  isPending: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onMore: () => void;
}) {
  const duration = lecture ? formatLectureDuration(lecture.duration_seconds) : null;
  const title = lecture?.title ?? `Lecture ${item.resource_id.slice(0, 8)}`;
  const courseName = course?.title;
  const instructor = course?.instructor?.name;
  const category = course?.category ?? null;
  const kind = lecture?.kind ?? 'hosted_video';

  return (
    <Card padded={false} style={styles.card} testID={`saved-lecture-${item.id}`}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Lecture: ${title}`}
        style={styles.cardPressable}>
        <View style={styles.thumbWrap}>
          <LecturePoster
            kind={kind as any}
            durationLabel={duration}
            style={styles.thumb}
          />
          {isVideoLecture(kind as any) ? (
            <View style={styles.playOverlay}>
              <AppIcon name={{ ios: 'play.fill', android: 'play_arrow' }} size={18} color={colors.colorOnPrimary} />
            </View>
          ) : null}
        </View>
        <View style={styles.cardBody}>
          <AppText variant="h3" weight="semibold" numberOfLines={2} style={styles.title}>
            {title}
          </AppText>
          <View style={styles.metaRow}>
            {courseName ? (
              <AppText variant="small" tone="secondary" numberOfLines={1} style={styles.meta}>
                {courseName}
              </AppText>
            ) : null}
            {instructor ? (
              <AppText variant="small" tone="tertiary" numberOfLines={1} style={styles.meta}>
                {instructor}
              </AppText>
            ) : null}
            {category ? (
              <AppText variant="caption" tone="tertiary" uppercase style={styles.meta}>
                {category}
              </AppText>
            ) : null}
            {savedAt ? (
              <AppText variant="caption" tone="tertiary" style={styles.meta}>
                Saved {savedAt}
              </AppText>
            ) : null}
          </View>
          {duration ? (
            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <AppText variant="caption" weight="medium" tone="secondary">
                  {duration}
                </AppText>
              </View>
              <View style={styles.badge}>
                <AppText variant="caption" weight="medium" tone="secondary">
                  {lectureKindLabel(kind as any)}
                </AppText>
              </View>
            </View>
          ) : null}
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Pressable
          onPress={onRemove}
          disabled={isPending}
          hitSlop={8}
          accessibilityLabel="Remove from saved"
          accessibilityRole="button"
          style={styles.iconBtn}>
          {isPending ? (
            <View style={styles.spinner} />
          ) : (
            <AppIcon name={{ ios: 'bookmark.fill', android: 'bookmark' }} size={20} color={colors.colorPrimary} />
          )}
        </Pressable>
        <Pressable
          onPress={onMore}
          hitSlop={8}
          accessibilityLabel="More actions"
          accessibilityRole="button"
          style={styles.iconBtn}>
          <AppIcon name={{ ios: 'ellipsis', android: 'more_vert' }} size={20} color={colors.colorTextSecondary} />
        </Pressable>
      </View>
    </Card>
  );
}

function SavedCourseCard({
  item,
  course,
  savedAt,
  isPending,
  onOpen,
  onRemove,
  onMore,
}: {
  item: SavedItem;
  course: Course | undefined;
  savedAt: string;
  isPending: boolean;
  onOpen: () => void;
  onRemove: () => void;
  onMore: () => void;
}) {
  const title = course?.title ?? `Course ${item.resource_id.slice(0, 8)}`;
  const instructor = course?.instructor?.name;
  const category = course?.category;
  const level = course?.skill_level;

  return (
    <Card padded={false} style={styles.card} testID={`saved-course-${item.id}`}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Course: ${title}`}
        style={styles.cardPressable}>
        <View style={styles.thumbWrap}>
          <View style={styles.courseThumb}>
            <AppIcon name={{ ios: 'book.fill', android: 'menu_book' }} size={32} color={colors.colorTextTertiary} />
          </View>
        </View>
        <View style={styles.cardBody}>
          <AppText variant="h3" weight="semibold" numberOfLines={2} style={styles.title}>
            {title}
          </AppText>
          <View style={styles.metaRow}>
            {instructor ? (
              <AppText variant="small" tone="secondary" numberOfLines={1} style={styles.meta}>
                {instructor}
              </AppText>
            ) : null}
            {category ? (
              <AppText variant="caption" tone="tertiary" uppercase style={styles.meta}>
                {category}
              </AppText>
            ) : null}
            {level ? (
              <AppText variant="caption" tone="tertiary" uppercase style={styles.meta}>
                {level}
              </AppText>
            ) : null}
            {savedAt ? (
              <AppText variant="caption" tone="tertiary" style={styles.meta}>
                Saved {savedAt}
              </AppText>
            ) : null}
          </View>
        </View>
      </Pressable>
      <View style={styles.actions}>
        <Pressable
          onPress={onRemove}
          disabled={isPending}
          hitSlop={8}
          accessibilityLabel="Remove from saved"
          accessibilityRole="button"
          style={styles.iconBtn}>
          {isPending ? (
            <View style={styles.spinner} />
          ) : (
            <AppIcon name={{ ios: 'bookmark.fill', android: 'bookmark' }} size={20} color={colors.colorPrimary} />
          )}
        </Pressable>
        <Pressable
          onPress={onMore}
          hitSlop={8}
          accessibilityLabel="More actions"
          accessibilityRole="button"
          style={styles.iconBtn}>
          <AppIcon name={{ ios: 'ellipsis', android: 'more_vert' }} size={20} color={colors.colorTextSecondary} />
        </Pressable>
      </View>
    </Card>
  );
}

export default function LearningHubSavedScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { savedItems, isLoading, isRefetching, error, refetch, unsaveMutation } = useSavedItems();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<FilterType>('all');
  const [selectedSort, setSelectedSort] = useState<SortOption>('recent');
  const [sortMenuVisible, setSortMenuVisible] = useState(false);
  const [moreMenu, setMoreMenu] = useState<{ id: string; type: SavedItemType; resourceId: string } | null>(null);
  const [pendingUnsaveId, setPendingUnsaveId] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const coursesCatalogue = useQuery({
    queryKey: queryKeys.courses({ page_size: 50 }),
    queryFn: () => fetchCourses({ page_size: 50 }),
    staleTime: 60_000,
  });

  const savedCourseIds = useMemo(
    () => [...new Set(savedItems.filter((i) => i.resource_type === 'course').map((i) => i.resource_id))],
    [savedItems],
  );

  const catalogueIds = useMemo(
    () => (coursesCatalogue.data?.items ?? []).map((c) => c.id),
    [coursesCatalogue.data],
  );

  const allCourseIds = useMemo(
    () => [...new Set([...catalogueIds, ...savedCourseIds])],
    [catalogueIds, savedCourseIds],
  );

  const courseDetailQueries = useQueries({
    queries: allCourseIds.map((id) => ({
      queryKey: queryKeys.course(id),
      queryFn: () => fetchCourse(id),
      staleTime: 60_000,
    })),
  });

  const { courseMap, lectureMap } = useMemo(() => {
    const cm = new Map<string, Course>();
    const lm = new Map<string, { course: Course; lecture: CourseLecture }>();
    courseDetailQueries.forEach((q) => {
      if (q.data) {
        cm.set(q.data.id, q.data);
        for (const section of q.data.sections ?? []) {
          for (const lec of section.lectures ?? []) {
            lm.set(lec.id, { course: q.data, lecture: lec });
          }
        }
      }
    });
    return { courseMap: cm, lectureMap: lm };
  }, [courseDetailQueries]);

  const totalSaved = savedItems.length;
  const lectureCount = savedItems.filter((i) => i.resource_type === 'lecture').length;
  const courseCount = savedItems.filter((i) => i.resource_type === 'course').length;

  const visibleItems = useMemo(() => {
    let list = savedItems;
    if (selectedType === 'lecture') list = list.filter((i) => i.resource_type === 'lecture');
    if (selectedType === 'course') list = list.filter((i) => i.resource_type === 'course');

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((i) => {
        if (i.resource_type === 'course') {
          const c = courseMap.get(i.resource_id);
          const title = c?.title ?? '';
          const instr = c?.instructor?.name ?? '';
          const cat = c?.category ?? '';
          return [title, instr, cat, i.resource_id].some((v) => v.toLowerCase().includes(q));
        }
        const found = lectureMap.get(i.resource_id);
        const title = found?.lecture.title ?? '';
        const courseName = found?.course.title ?? '';
        const instr = found?.course.instructor?.name ?? '';
        return [title, courseName, instr, i.resource_id].some((v) => v.toLowerCase().includes(q));
      });
    }

    const sorted = [...list];
    switch (selectedSort) {
      case 'recent':
        sorted.sort((a, b) => (b.created_at > a.created_at ? 1 : b.created_at < a.created_at ? -1 : 0));
        break;
      case 'oldest':
        sorted.sort((a, b) => (a.created_at > b.created_at ? 1 : a.created_at < b.created_at ? -1 : 0));
        break;
      case 'title-asc':
        sorted.sort((a, b) => {
          const ta = titleFor(a, courseMap, lectureMap).toLowerCase();
          const tb = titleFor(b, courseMap, lectureMap).toLowerCase();
          return ta < tb ? -1 : ta > tb ? 1 : 0;
        });
        break;
      case 'title-desc':
        sorted.sort((a, b) => {
          const ta = titleFor(a, courseMap, lectureMap).toLowerCase();
          const tb = titleFor(b, courseMap, lectureMap).toLowerCase();
          return ta > tb ? -1 : ta < tb ? 1 : 0;
        });
        break;
    }
    return sorted;
  }, [savedItems, selectedType, searchQuery, selectedSort, courseMap, lectureMap]);

  const handleUnsave = useCallback(
    (item: SavedItem) => {
      setMutationError(null);
      setPendingUnsaveId(item.id);
      unsaveMutation.mutate(item.id, {
        onError: (err: any) => {
          setMutationError(err?.message ?? 'Could not remove item. Please try again.');
        },
        onSettled: () => {
          setPendingUnsaveId(null);
        },
      });
    },
    [unsaveMutation],
  );

  const openItem = useCallback(
    (item: SavedItem) => {
      if (item.resource_type === 'course') {
        router.push(`/course/${item.resource_id}` as never);
      } else {
        const found = lectureMap.get(item.resource_id);
        if (found) {
          router.push(`/lecture/${item.resource_id}?courseId=${found.course.id}` as never);
        } else {
          setMutationError('This lecture could not be opened right now.');
        }
      }
    },
    [router, lectureMap],
  );

  if (isLoading) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="h2" tone="primary" weight="semibold">Saved</AppText>
          <AppText variant="small" tone="secondary">Keep your favorite lectures and courses close at hand.</AppText>
        </View>
        <View style={styles.searchSkeleton} />
        <View style={styles.chipSkeletonRow}>
          <View style={styles.chipSkeleton} />
          <View style={styles.chipSkeleton} />
          <View style={styles.chipSkeleton} />
        </View>
        <View style={styles.skeletonList}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + layout.bottomNavHeight }]}>
        <View style={styles.header}>
          <AppText variant="h2" tone="primary" weight="semibold">Saved</AppText>
          <AppText variant="small" tone="secondary">Keep your favorite lectures and courses close at hand.</AppText>
        </View>
        <View style={styles.stateWrap}>
          <StatusBanner
            title="Could not load your saved items"
            description={error}
            onRetry={() => void refetch()}
          />
        </View>
      </View>
    );
  }

  const isEmpty = savedItems.length === 0;
  const isSearchEmpty = !isEmpty && visibleItems.length === 0 && searchQuery.trim().length > 0;
  const isCategoryEmpty = !isEmpty && visibleItems.length === 0 && !searchQuery.trim();

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + layout.bottomNavHeight + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => void refetch()}
            tintColor={colors.colorPrimary}
            colors={[colors.colorPrimary]}
          />
        }>
        <View style={styles.header}>
          <AppText variant="h2" tone="primary" weight="semibold">Saved</AppText>
          <AppText variant="small" tone="secondary">Keep your favorite lectures and courses close at hand.</AppText>
        </View>

        <View style={styles.searchWrap}>
          <View style={styles.searchContainer}>
            <AppIcon name={{ ios: 'magnifyingglass', android: 'search' }} size={20} color={colors.colorTextTertiary} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Search saved lectures and courses"
              placeholderTextColor={colors.colorTextTertiary}
              style={styles.searchInput}
              returnKeyType="search"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Search saved lectures and courses"
            />
            {searchQuery.length > 0 ? (
              <Pressable onPress={() => setSearchQuery('')} hitSlop={8} accessibilityLabel="Clear search" style={styles.clearBtn}>
                <AppIcon name={{ ios: 'xmark.circle.fill', android: 'cancel' }} size={18} color={colors.colorTextTertiary} />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View style={styles.summary}>
          <AppText variant="label" tone="secondary" uppercase>Your library</AppText>
          <AppText variant="small" tone="tertiary">
            {totalSaved} saved item{totalSaved === 1 ? '' : 's'}
            {lectureCount > 0 && courseCount > 0 ? ` · ${lectureCount} lecture${lectureCount === 1 ? '' : 's'} · ${courseCount} course${courseCount === 1 ? '' : 's'}` : ''}
          </AppText>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipList}>
          {(['all', 'lecture', 'course'] as FilterType[]).map((t) => {
            const label = t === 'all' ? 'All' : t === 'lecture' ? 'Lectures' : 'Courses';
            const selected = selectedType === t;
            return (
              <Pressable
                key={t}
                onPress={() => setSelectedType(t)}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                style={[styles.chip, selected && styles.chipSelected]}>
                <AppText
                  variant="body"
                  weight="medium"
                  style={{ color: selected ? colors.colorOnPrimary : colors.colorTextPrimary }}>
                  {label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.sortRow}>
          <AppText variant="small" tone="secondary">
            {visibleItems.length} item{visibleItems.length === 1 ? '' : 's'}
          </AppText>
          <Pressable
            onPress={() => setSortMenuVisible(true)}
            accessibilityRole="button"
            accessibilityLabel="Sort saved items"
            style={styles.sortBtn}>
            <AppIcon name={{ ios: 'arrow.up.arrow.down', android: 'sort' }} size={16} color={colors.colorTextSecondary} />
            <AppText variant="small" tone="secondary" weight="medium">{SORT_LABELS[selectedSort]}</AppText>
          </Pressable>
        </View>

        {mutationError ? (
          <View style={styles.bannerWrap}>
            <StatusBanner title="Action failed" description={mutationError} />
          </View>
        ) : null}

        {isEmpty ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIconWrap}>
              <AppIcon name={{ ios: 'bookmark', android: 'bookmark_border' }} size={40} color={colors.colorPrimary} />
            </View>
            <AppText variant="h3" tone="primary" weight="semibold" style={styles.emptyTitle}>
              Your learning library starts here
            </AppText>
            <AppText variant="small" tone="secondary" style={styles.emptyBody}>
              Save lectures and courses you want to revisit, and they’ll appear here.
            </AppText>
            <View style={styles.emptyActions}>
              <Button label="Explore Lectures" variant="primary" fullWidth onPress={() => router.push('/learn' as never)} />
              <Button label="Explore Courses" variant="secondary" fullWidth onPress={() => router.push('/learn/courses' as never)} />
            </View>
          </View>
        ) : isSearchEmpty ? (
          <View style={styles.emptyState}>
            <AppText variant="h3" tone="primary" weight="semibold" style={styles.emptyTitle}>
              No matching saved items
            </AppText>
            <AppText variant="small" tone="secondary" style={styles.emptyBody}>
              Try another title or clear your search.
            </AppText>
            <View style={styles.emptyActions}>
              <Button label="Clear Search" variant="secondary" fullWidth onPress={() => setSearchQuery('')} />
              {selectedType !== 'all' ? (
                <Button label="Show All Saved Items" variant="ghost" fullWidth onPress={() => { setSelectedType('all'); setSearchQuery(''); }} />
              ) : null}
            </View>
          </View>
        ) : isCategoryEmpty ? (
          <View style={styles.emptyState}>
            <AppText variant="h3" tone="primary" weight="semibold" style={styles.emptyTitle}>
              {selectedType === 'lecture' ? 'No saved lectures yet' : 'No saved courses yet'}
            </AppText>
            <AppText variant="small" tone="secondary" style={styles.emptyBody}>
              {selectedType === 'lecture'
                ? 'Bookmark a lecture to find it quickly whenever you’re ready to learn.'
                : 'Save a course to keep it close at hand.'}
            </AppText>
            <View style={styles.emptyActions}>
              <Button
                label={selectedType === 'lecture' ? 'Browse Lectures' : 'Explore Courses'}
                variant="primary"
                fullWidth
                onPress={() => router.push(selectedType === 'lecture' ? ('/learn' as never) : ('/learn/courses' as never))}
              />
            </View>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleItems.map((item) => {
              const savedAt = item.created_at ? new Date(item.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '';
              const isPending = pendingUnsaveId === item.id;
              if (item.resource_type === 'lecture') {
                const found = lectureMap.get(item.resource_id);
                return (
                  <SavedLectureCard
                    key={item.id}
                    item={item}
                    course={found?.course}
                    lecture={found?.lecture}
                    savedAt={savedAt}
                    isPending={isPending}
                    onOpen={() => openItem(item)}
                    onRemove={() => handleUnsave(item)}
                    onMore={() => setMoreMenu({ id: item.id, type: 'lecture', resourceId: item.resource_id })}
                  />
                );
              }
              const course = courseMap.get(item.resource_id);
              return (
                <SavedCourseCard
                  key={item.id}
                  item={item}
                  course={course}
                  savedAt={savedAt}
                  isPending={isPending}
                  onOpen={() => openItem(item)}
                  onRemove={() => handleUnsave(item)}
                  onMore={() => setMoreMenu({ id: item.id, type: 'course', resourceId: item.resource_id })}
                />
              );
            })}
          </View>
        )}
      </ScrollView>

      <Modal visible={sortMenuVisible} transparent animationType="fade" onRequestClose={() => setSortMenuVisible(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setSortMenuVisible(false)}>
          <View style={styles.sortSheet}>
            {(Object.keys(SORT_LABELS) as SortOption[]).map((opt) => (
              <Pressable
                key={opt}
                onPress={() => { setSelectedSort(opt); setSortMenuVisible(false); }}
                style={styles.sortOption}>
                <AppText variant="body" tone="primary" weight={selectedSort === opt ? 'semibold' : 'regular'}>
                  {SORT_LABELS[opt] === 'Recent' ? 'Recently saved' : SORT_LABELS[opt] === 'Oldest' ? 'Oldest saved' : SORT_LABELS[opt] === 'A–Z' ? 'Title A–Z' : 'Title Z–A'}
                </AppText>
                {selectedSort === opt ? (
                  <AppIcon name={{ ios: 'checkmark', android: 'check' }} size={18} color={colors.colorPrimary} />
                ) : null}
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      <Modal visible={!!moreMenu} transparent animationType="fade" onRequestClose={() => setMoreMenu(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMoreMenu(null)}>
          <View style={styles.moreSheet}>
            <Pressable
              style={styles.moreOption}
              onPress={() => {
                if (moreMenu) {
                  const item = savedItems.find((i) => i.id === moreMenu.id);
                  if (item) openItem(item);
                }
                setMoreMenu(null);
              }}>
              <AppText variant="body" tone="primary">
                {moreMenu?.type === 'lecture' ? 'Open Lecture' : 'Open Course'}
              </AppText>
            </Pressable>
            <View style={styles.divider} />
            <Pressable
              style={styles.moreOption}
              onPress={() => {
                if (moreMenu) {
                  const item = savedItems.find((i) => i.id === moreMenu.id);
                  if (item) handleUnsave(item);
                }
                setMoreMenu(null);
              }}>
              <AppText variant="body" tone="danger">Remove from Saved</AppText>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function titleFor(item: SavedItem, courseMap: Map<string, Course>, lectureMap: Map<string, { course: Course; lecture: CourseLecture }>): string {
  if (item.resource_type === 'course') return courseMap.get(item.resource_id)?.title ?? item.resource_id;
  return lectureMap.get(item.resource_id)?.lecture.title ?? item.resource_id;
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.colorBgPage,
  },
  scrollContent: {
    paddingHorizontal: spacing.pagePadding,
    paddingTop: spacing.pagePadding,
  },
  header: {
    gap: 2,
    marginBottom: spacing.md,
  },
  searchWrap: {
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
  searchInput: {
    flex: 1,
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeBody,
    paddingVertical: 0,
  },
  clearBtn: {
    padding: spacing.xs,
  },
  summary: {
    gap: 2,
    marginBottom: spacing.sm,
  },
  chipList: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
  chip: {
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
  },
  chipSelected: {
    backgroundColor: colors.colorPrimary,
    borderColor: colors.colorPrimary,
  },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  sortBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.sm,
  },
  bannerWrap: {
    marginBottom: spacing.sm,
  },
  list: {
    gap: spacing.sm,
  },
  card: {
    overflow: 'hidden',
  },
  cardPressable: {
    flexDirection: 'row',
    gap: spacing.md,
    padding: spacing.cardPadding,
  },
  thumbWrap: {
    width: 112,
    aspectRatio: 16 / 9,
    borderRadius: radius.card,
    overflow: 'hidden',
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  playOverlay: {
    position: 'absolute',
    top: spacing.xs,
    left: spacing.xs,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.colorOverlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  courseThumb: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.colorBgMuted,
  },
  cardBody: {
    flex: 1,
    gap: 2,
  },
  title: {
    marginBottom: 2,
  },
  metaRow: {
    gap: 2,
    marginTop: spacing.xs,
  },
  meta: {
    marginBottom: 0,
  },
  badgeRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  badge: {
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
  },
  actions: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    flexDirection: 'row',
    gap: spacing.xs,
  },
  iconBtn: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spinner: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.colorBorder,
    borderTopColor: colors.colorPrimary,
  },
  emptyState: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xl,
  },
  emptyIconWrap: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.colorPrimarySubtle,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    textAlign: 'center',
  },
  emptyBody: {
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyActions: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  stateWrap: {
    marginTop: spacing.md,
  },
  skeletonList: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  searchSkeleton: {
    height: layout.inputHeight,
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.control,
    marginBottom: spacing.sm,
  },
  chipSkeletonRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  chipSkeleton: {
    height: 44,
    width: 96,
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.full,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: colors.colorOverlay,
    justifyContent: 'flex-end',
  },
  sortSheet: {
    backgroundColor: colors.colorBgSurface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: spacing.md,
    gap: spacing.xs,
  },
  sortOption: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.control,
  },
  moreSheet: {
    backgroundColor: colors.colorBgSurface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    padding: spacing.md,
  },
  moreOption: {
    minHeight: 48,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.colorBorder,
    marginVertical: spacing.xs,
  },
});

