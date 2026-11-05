/**
 * Learning Hub ? Courses section: the course catalogue.
 *
 * Premium redesign (Phase 5): adds search, skill-level filter, pricing filter,
 * sort, and reset ? all backed by the existing GET /courses params.
 */

import { useCallback, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { CourseCard } from '@/components/ui/CourseCard';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { StageScreen } from '@/features/stages/StageScreen';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';

import { queryKeys } from '@/api/queryKeys';
import { fetchCourses, type CourseListParams } from '@/api/courses';
import { categoriesFromCourses } from '@/features/learningHub/learningHubModel';
import { EXTERNAL_COURSES, type ExternalCourse } from '@/features/learn/externalCourses';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';
import type { CourseSkillLevel } from '@/types/course';

const SKILL_LEVELS = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'expert', label: 'Expert' },
];

type PricingFilter = 'all' | 'free' | 'paid';
type SortOption = 'recent' | 'title' | 'duration';

export default function HubCoursesScreen() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [skillLevel, setSkillLevel] = useState<CourseSkillLevel | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [pricing, setPricing] = useState<PricingFilter>('all');
  const [sort, setSort] = useState<SortOption>('recent');

  const handleSearchChange = useCallback((text: string) => {
    setSearch(text);
    const timer = setTimeout(() => setDebouncedSearch(text), 300);
    (globalThis as any).__cs = timer;
  }, []);

  const clearSearch = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
  }, []);

  const params: CourseListParams = useMemo(() => {
    const p: CourseListParams = { page_size: 20 };
    if (debouncedSearch.trim()) p.q = debouncedSearch.trim();
    if (skillLevel) p.skill_level = skillLevel;
    if (category) p.category = category;
    if (pricing !== 'all') p.pricing = pricing;
    return p;
  }, [debouncedSearch, skillLevel, category, pricing]);

  const coursesQuery = useQuery({
    queryKey: [...queryKeys.courses(), params],
    queryFn: () => fetchCourses(params),
    staleTime: 30_000,
    placeholderData: (prev: any) => prev,
  });

  const courses = useMemo(() => {
    const items = coursesQuery.data?.items ?? [];
    const sorted = [...items];
    if (sort === 'title') sorted.sort((a: any, b: any) => a.title.localeCompare(b.title));
    if (sort === 'duration') sorted.sort((a: any, b: any) => (a.estimated_duration_minutes ?? 0) - (b.estimated_duration_minutes ?? 0));
    return sorted;
  }, [coursesQuery.data, sort]);

  const categories = useMemo(() => categoriesFromCourses(coursesQuery.data?.items ?? []), [coursesQuery.data]);
  const hasActiveFilters = debouncedSearch.trim().length > 0 || skillLevel !== null || category !== null || pricing !== 'all' || sort !== 'recent';

  const resetFilters = useCallback(() => {
    setSearch('');
    setDebouncedSearch('');
    setSkillLevel(null);
    setCategory(null);
    setPricing('all');
    setSort('recent');
  }, []);

  const screenTitle = (
    <View style={styles.pageHeader}>
      <AppText variant="h2" tone="primary" weight="semibold">
        Explore Courses
      </AppText>
      <AppText variant="caption" tone="secondary" style={styles.pageSubtitle}>
        Build skills for career growth
      </AppText>
    </View>
  );

  if (coursesQuery.isLoading && !coursesQuery.data) {
    return (
      <View style={styles.container} testID="courses-loading">
        {screenTitle}
        <View style={styles.skeletonList} testID="courses-skeleton">
          {[0, 1, 2, 3].map((index) => (
            <SkeletonCard key={index} lines={2} />
          ))}
        </View>
      </View>
    );
  }

  if (coursesQuery.isError && !coursesQuery.data) {
    const message =
      coursesQuery.error instanceof Error ? coursesQuery.error.message : String(coursesQuery.error);
    const backendDown = message.includes('404') || message.includes('Not Found');
    if (backendDown) {
      return (
        <StageScreen
          title="Learning & Skills"
          description="Curated learning paths, industry skill certifications, and workshop webinars will live here."
          stage="Stage 7 ? learning & readiness"
          nextStep="The learning catalog API is in active design."
        />
      );
    }
    return (
      <View style={styles.container} testID="courses-error">
        {screenTitle}
        <View style={styles.errorWrap}>
          <StatusBanner title="Couldn't load courses" description={message} onRetry={() => coursesQuery.refetch()} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="courses-ready">
      {screenTitle}
      {courses.length > 0 && (
        <View style={styles.hero}>
          <AppIcon name={{ ios: 'book.fill', android: 'school' }} size={32} color={colors.colorPrimary} style={styles.heroIcon} />
          <View style={styles.heroContent}>
            <AppText variant="h3" tone="primary" weight="semibold" numberOfLines={2} style={styles.heroTitle}>
              {courses[0].title}
            </AppText>
            {courses[0].category && (
              <AppText variant="caption" tone="tertiary" style={styles.heroSubject}>
                {courses[0].category}
              </AppText>
            )}
            {courses[0].is_free ? (
              <AppText variant="caption" tone="success">Free</AppText>
            ) : courses[0].price !== null && (
              <AppText variant="caption" tone="neutral">${courses[0].price}</AppText>
            )}
            <Pressable onPress={() => router.push('/course/' + courses[0].id as never)} style={styles.heroButton}>
              <AppText variant="body" tone="primary">Start Learning</AppText>
            </Pressable>
          </View>
        </View>
      )}
      <View style={styles.externalPaths}>
        <AppText variant="label" tone="secondary" uppercase style={styles.sectionTitle}>Featured learning paths</AppText>
        <FlatList
          data={EXTERNAL_COURSES}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.externalPathList}
          keyExtractor={(item: any) => item.id}
          renderItem={({ item }: any) => (
            <View style={styles.externalPathCard}>
              <AppText variant="body" tone="primary" weight="semibold" numberOfLines={1}>
                {item.title}
              </AppText>
              <AppText variant="caption" tone="tertiary">
                {item.provider}
              </AppText>
              <Pressable onPress={() => WebBrowser.openBrowserAsync(item.url)} style={styles.externalPathLink} hitSlop={8}>
                <AppText variant="caption" tone="primary">View official course</AppText>
              </Pressable>
            </View>
          )}
        </FlatList>
      </View>
      <View style={styles.searchWrap}>
        <View style={styles.searchContainer}>
          <AppIcon name={{ ios: 'magnifyingglass', android: 'search' }} size={20} color={colors.colorTextTertiary} />
          <TextInput
            value={search}
            onChangeText={handleSearchChange}
            placeholder="Search courses, topics, or skills"
            placeholderTextColor={colors.colorTextTertiary}
            style={styles.searchInput}
            returnKeyType="search"
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search courses"
          />
          {search.length > 0 ? (
            <Pressable onPress={clearSearch} hitSlop={8} accessibilityLabel="Clear search" style={styles.clearButton}>
              <AppIcon name={{ ios: 'xmark.circle.fill', android: 'cancel' }} size={18} color={colors.colorTextTertiary} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.filterSection}>
        <AppText variant="caption" tone="secondary" uppercase style={styles.filterLabel}>Skill level</AppText>
        <View style={styles.chipRow}>
          <Pressable onPress={() => setSkillLevel(null)} style={[styles.filterChip, skillLevel === null && styles.filterChipSelected]} accessibilityRole="button" accessibilityLabel="All skill levels" accessibilityState={{ selected: skillLevel === null }}>
            <AppText variant="caption" weight={skillLevel === null ? 'semibold' : 'regular'} tone={skillLevel === null ? 'accent' : 'secondary'}>All</AppText>
          </Pressable>
          {SKILL_LEVELS.map((sl: any) => (
            <Pressable key={sl.value} onPress={() => setSkillLevel(sl.value)} style={[styles.filterChip, skillLevel === sl.value && styles.filterChipSelected]} accessibilityRole="button" accessibilityLabel={sl.label} accessibilityState={{ selected: skillLevel === sl.value }}>
              <AppText variant="caption" weight={skillLevel === sl.value ? 'semibold' : 'regular'} tone={skillLevel === sl.value ? 'accent' : 'secondary'}>{sl.label}</AppText>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.filterSection}>
        <AppText variant="caption" tone="secondary" uppercase style={styles.filterLabel}>Pricing</AppText>
        <View style={styles.chipRow}>
          {(['all', 'free', 'paid'] as PricingFilter[]).map((p) => (
            <Pressable key={p} onPress={() => setPricing(p)} style={[styles.filterChip, pricing === p && styles.filterChipSelected]} accessibilityRole="button" accessibilityLabel={p === 'all' ? 'All pricing' : p === 'free' ? 'Free only' : 'Paid only'} accessibilityState={{ selected: pricing === p }}>
              <AppText variant="caption" weight={pricing === p ? 'semibold' : 'regular'} tone={pricing === p ? 'accent' : 'secondary'}>{p === 'all' ? 'All' : p === 'free' ? 'Free' : 'Paid'}</AppText>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.filterSection}>
        <AppText variant="caption" tone="secondary" uppercase style={styles.filterLabel}>Sort by</AppText>
        <View style={styles.chipRow}>
          {[
            { value: 'recent', label: 'Recent' },
            { value: 'title', label: 'Title A-Z' },
            { value: 'duration', label: 'Duration' },
          ].map((s: any) => (
            <Pressable key={s.value} onPress={() => setSort(s.value)} style={[styles.filterChip, sort === s.value && styles.filterChipSelected]} accessibilityRole="button" accessibilityLabel={'Sort by ' + s.label} accessibilityState={{ selected: sort === s.value }}>
              <AppText variant="caption" weight={sort === s.value ? 'semibold' : 'regular'} tone={sort === s.value ? 'accent' : 'secondary'}>{s.label}</AppText>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.filterSection}>
        <AppText variant="caption" tone="secondary" uppercase style={styles.filterLabel}>Categories</AppText>
        <View style={styles.chipRow}>
          {['Web Development', 'Programming', 'Data Science', 'Artificial Intelligence', 'Business', 'Design'].map((cat) => (
            <Pressable
              key={cat}
              onPress={() => setCategory(current => current === cat ? null : cat)}
              style={[styles.filterChip, category === cat && styles.filterChipSelected]}
              accessibilityRole="button"
              accessibilityLabel={cat}
              accessibilityState={{ selected: category === cat }}
            >
              <AppText variant="caption" weight={category === cat ? 'semibold' : 'regular'} tone={category === cat ? 'accent' : 'secondary'>{cat}</AppText>
            </Pressable>
          ))}
        </View>
      </View>

      {hasActiveFilters ? (
        <View style={styles.resetWrap}>
          <Button label="Reset filters" variant="ghost" size="md" onPress={resetFilters} />
        </View>
      ) : null}

      {categories.length > 0 && (
        <View style={styles.section}>
          <AppText variant="label" tone="secondary" uppercase style={styles.sectionTitle}>Categories</AppText>
          <FlatList data={categories} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryList} keyExtractor={(item: any) => item.id} renderItem={({ item }: any) => (
            <View style={styles.categoryCard}>
              <AppText variant="body" tone="primary" weight="semibold" numberOfLines={1}>{item.name}</AppText>
              <AppText variant="caption" tone="tertiary" uppercase>{item.course_count} course{item.course_count === 1 ? '' : 's'}</AppText>
            </View>
          )} />
        </View>
      )}

      <View style={styles.allCoursesHeading}>
        <AppText variant="label" tone="secondary" uppercase>All courses</AppText>
      </View>
      {courses.length === 0 ? (
        <View style={styles.empty} testID="courses-empty">
          <AppText variant="body" tone="secondary" style={styles.emptyBody}>No courses match your filters.</AppText>
          {hasActiveFilters ? (
            <Button label="Reset filters" variant="secondary" fullWidth onPress={resetFilters} />
          ) : null}
        </View>
      ) : (
        <FlatList data={courses} contentContainerStyle={styles.courseList} keyExtractor={(item: any) => item.id} renderItem={({ item }: any) => (
          <CourseCard course={item} onPress={(course: any) => router.push('/course/' + course.id as never)} />
        )} />
      )}

      <View style={styles.myLearningWrap}>
        <Button label="My Learning" variant="secondary" fullWidth onPress={() => router.push('/my-learning' as never)} accessibilityHint="Shows the courses you are enrolled in" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.colorBgPage },
  header: { paddingHorizontal: spacing.pagePadding, paddingTop: spacing.pagePadding, paddingBottom: spacing.sm },\n  pageHeader: { paddingHorizontal: spacing.pagePadding, paddingBottom: spacing.sm },\n  pageSubtitle: { fontSize: typography.fontSizeSmall, color: colors.colorTextSecondary, marginTop: spacing.xs },\n  searchWrap: { paddingHorizontal: spacing.pagePadding, marginBottom: spacing.sm },\n
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.colorBgSurface, borderColor: colors.colorBorder, borderWidth: 1, borderRadius: radius.control, paddingHorizontal: spacing.sm, gap: spacing.sm, minHeight: layout.inputHeight },
  searchInput: { flex: 1, color: colors.colorTextPrimary, fontSize: typography.fontSizeBody },
  clearButton: { padding: spacing.xs },
  filterSection: { paddingHorizontal: spacing.pagePadding, marginBottom: spacing.sm },
  filterLabel: { marginBottom: spacing.xs },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  filterChip: { backgroundColor: colors.colorBgSurface, borderColor: colors.colorBorder, borderRadius: radius.full, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.xs, minHeight: 36, alignItems: 'center', justifyContent: 'center' },
  filterChipSelected: { backgroundColor: colors.colorPrimarySubtle, borderColor: colors.colorPrimary },
  resetWrap: { paddingHorizontal: spacing.pagePadding, marginBottom: spacing.sm },
  section: { paddingBottom: spacing.sm },
  sectionTitle: { marginBottom: spacing.sm, marginHorizontal: spacing.pagePadding },
  categoryList: { paddingHorizontal: spacing.pagePadding, paddingBottom: spacing.sm, gap: spacing.sm },
  categoryCard: { backgroundColor: colors.colorBgSurface, borderColor: colors.colorBorder, borderRadius: 6, borderWidth: 1, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, minWidth: 110, alignItems: 'center' },
  allCoursesHeading: { paddingHorizontal: spacing.pagePadding, paddingTop: spacing.md, paddingBottom: spacing.sm },
  courseList: { paddingHorizontal: spacing.pagePadding, paddingBottom: spacing.lg, gap: spacing.sm },
  skeletonList: { paddingHorizontal: spacing.pagePadding, gap: spacing.sm, paddingTop: spacing.sm },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.pagePadding, gap: spacing.sm, paddingVertical: spacing.xl },
  emptyBody: { textAlign: 'center' },
  errorWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.pagePadding },
  myLearningWrap: { paddingHorizontal: spacing.pagePadding, paddingVertical: spacing.md },\n  externalPaths: { paddingHorizontal: spacing.pagePadding, marginBottom: spacing.md },\n  sectionTitle: { marginBottom: spacing.sm, marginHorizontal: spacing.pagePadding },\n  externalPathList: { flexWrap: 'wrap', gap: spacing.sm },\n  externalPathCard: { padding: spacing.md, backgroundColor: colors.colorBgSurface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.colorBorder, minWidth: 150, flex: 1 },\n  externalPathLink: { marginTop: spacing.sm, color: colors.colorPrimary },\n  hero: { paddingHorizontal: spacing.pagePadding, marginBottom: spacing.md, flexDirection: 'row', alignItems: 'center' },\n  heroIcon: { marginRight: spacing.md },\n  heroContent: { gap: spacing.xs },\n  heroTitle: { flex: 1 },\n  heroSubject: { fontSize: typography.fontSizeSmall, color: colors.colorTextSecondary },\n  heroButton: { marginTop: spacing.sm },\n,
});
