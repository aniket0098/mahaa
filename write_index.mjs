import fs from 'fs';

const p = 'C:\\mahaa\\src\\app\\(candidate)\\learn\\index.tsx';

let content = `/**
 * Learning Hub — Home: the Lectures screen.
 *
 * Premium learning home: a featured hero banner, Recommended lectures,
 * Popular Topics, a working demo playlist, and the full All Lectures
 * catalogue — all backed by real server rows.
 *
 * Data spine, all real server rows:
 *  - GET /courses — the catalogue page (q = search, category = topic filter)
 *  - GET /courses/{id} for a bounded slice — the only way the server
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
import { PlaylistCard } from '@/features/learningHub/PlaylistCard';
import { DEMO_PLAYLIST } from '@/features/learningHub/demoPlaylist';
import {
  FEED_COURSE_LIMIT,
  buildLectureFeed,
  hubFeedView,
  pickRecommendedLectures,
  topicsFromCourses,
  type LectureFeedItem,
  type TopicChip,
} from '@/features/learningHub/learningHubModel';
import { formatLectureDuration } from '@/features/learn/courseDetailModel';
import { useSavedItems } from '@/features/learn/savedModel';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';

const SEARCH_DEBOUNCE_MS = 300;
const RECOMMENDED_LIMIT = 6;

/** Inline search field for the lecture feed. */
function SearchBar({
  value,
  onChangeText,
  onClear,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<TextInput>(null);
  return (
    <Pressable
      accessibilityRole="search"
      accessibilityLabel="Search lectures"
      accessibilityHint="Type to search lectures by title, topic or instructor"
      onPress={() => void inputRef.current?.focus()}
      hitSlop={8}
      style={styles.searchContainer}>
      <AppIcon
        name={{ ios: 'magnifyingglass', android: 'search' }}
        size={20}
        color={colors.colorTextTertiary}
      />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        placeholder="Search lectures, topics, or skills"
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
          accessibilityHint="Clears the search query and refetches lectures"
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
  const duration = formatLectureDuration(item.durationSeconds);
  return (
    <View style={styles.recommendedCard}>
      <Pressable
        onPress={() => onPress(item)}
        accessibilityLabel={'Lecture: ' + item.title + '. From ' + item.courseTitle + '.'}
        style={styles.recommendedPressable}>
        <View style={styles.recommendedThumb}>
          <View style={styles.recommendedPoster} />
          {duration ? (
            <View style={styles.recommendedDurationChip}>
              <AppText variant="caption" weight="medium" tone="onPrimary">
                {duration}
              </AppText>
            </View>
          ) : null}
        </View>
        <View style={styles.recommendedBody}>
          {item.category ? (
            <AppText variant="small" tone="secondary" numberOfLines={1} style={styles.recommendedCategory}>
              {item.category}
            </AppText>
          ) : null}
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
`;
