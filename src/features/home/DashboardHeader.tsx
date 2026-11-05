/**
 * Dashboard header — the compact student top bar: **one row, four elements.**
 *
 *   menu toggle  |  search  |  bell  |  avatar
 *
 * What this file deliberately does not have, and why:
 *
 *  - **No written platform name, and no header logo.** The brand lives in the
 *    sidebar header (`Sidebar`), and the header slot holds the menu toggle so
 *    the row keeps its four-element rhythm. The name still appears on the
 *    landing and auth screens, and inside the sidebar mark itself.
 *  - **No greeting.** It was removed from the product design so the story row
 *    could sit directly under the chrome (`docs/PRODUCT_DECISIONS.md`); a
 *    second line of text is what pushes that row off the fold.
 *
 * Search expands **in place**: tapping the pill swaps it for a real input that
 * takes the same slot, and the results drop below the row. There is no
 * `/search` route in this app, so search has to live where the user opened it.
 * The query is the real skill catalogue (`GET /skills/catalog`) — no local
 * list, no invented results — and the honest note under the field is kept, so
 * the placeholder never promises a job or company search the API cannot serve.
 *
 * The bell opens the real `/notifications` inbox, which is backed by the main
 * backend's `/notifications` router — so it carries the **server's unread
 * count** (`GET /notifications/unread-count`), hidden at zero and capped at
 * `9+` above nine. A badge is only honest when the number behind it is the
 * server's own; see `NotificationBell` and `useUnreadNotificationCount`.
 *
 * The avatar and the name both come from the real authenticated principal.
 *
 * **The avatar's image comes from `GET /profile`, not from the principal.**
 * `GET /auth/me` is the *session*: it answers "which role tree do I render", and
 * it carries no avatar at all. The identity half of the profile aggregate is the
 * one read model that does, so the header reads that. It used to pass no `src` at
 * all, which guaranteed this avatar could only ever be initials.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Animated, Pressable, TextInput, View } from 'react-native';

import { fetchProfile, searchSkillCatalog } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { AppIcon } from '@/components/ui/AppIcon';
import { Avatar } from '@/components/ui/Avatar';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/home/homeStyles';
import { useSidebar } from '@/features/navigation/SidebarContext';
import { NotificationBell } from '@/features/notifications/NotificationBell';
import { useUnreadNotificationCount } from '@/features/notifications/useNotifications';
import { PeopleSearchResults } from '@/features/people/PeopleSearchResults';
import { usePeopleSearch } from '@/features/people/usePeopleSearch';
import type { Principal } from '@/types/auth';

/** Minimum term before the real catalogue request is made. */
const MIN_QUERY_LENGTH = 2;

const SEARCH_ICON = { ios: 'magnifyingglass', android: 'search' } as const;

export interface DashboardHeaderProps {
  principal: Principal;
}

export function DashboardHeader({ principal }: DashboardHeaderProps) {
  const router = useRouter();
  const { isOpen: isSidebarOpen, toggleSidebar } = useSidebar();
  const inputRef = useRef<TextInput>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [query, setQuery] = useState('');

  const trimmed = query.trim();
  const hasQuery = trimmed.length >= MIN_QUERY_LENGTH;

  /*
   * The header's own avatar. `GET /auth/me` is the session and carries no avatar,
   * so the one read model that does — the profile aggregate's identity — is what
   * this asks. It is the *same* cached query the Profile screen reads, so this
   * costs no extra request on a screen that is usually already showing it, and
   * invalidating `queryKeys.profile` after a photo save updates this with it.
   */
  const profile = useQuery({ queryKey: queryKeys.profile, queryFn: fetchProfile });
  const avatarUrl = profile.data?.identity.avatar_url ?? null;

  // Menu <-> close morph: a quick fade-scale-rotate keeps the swap from
  // popping, without a second icon ever on screen.
  const [menuIconFade] = useState(() => new Animated.Value(1));
  const [menuIconScale] = useState(() => new Animated.Value(1));
  const menuIconSpin = menuIconFade.interpolate({
    inputRange: [0, 1],
    outputRange: ['-45deg', '0deg'],
  });

  useEffect(() => {
    Animated.parallel([
      Animated.timing(menuIconFade, {
        toValue: 0,
        duration: 90,
        useNativeDriver: true,
      }),
      Animated.timing(menuIconScale, {
        toValue: 0.7,
        duration: 90,
        useNativeDriver: true,
      }),
    ]).start(() => {
      Animated.parallel([
        Animated.timing(menuIconFade, {
          toValue: 1,
          duration: 140,
          useNativeDriver: true,
        }),
        Animated.spring(menuIconScale, {
          toValue: 1,
          useNativeDriver: true,
          speed: 30,
          bounciness: 4,
        }),
      ]).start();
    });
  }, [isSidebarOpen, menuIconFade, menuIconScale]);

  // Deferred: the catalogue is only requested once the term is long enough,
  // so opening the screen never pulls the whole list.
  const suggestions = useQuery({
    queryKey: queryKeys.skillCatalog(trimmed),
    queryFn: () => searchSkillCatalog(trimmed, 6, 0),
    enabled: isSearchOpen && hasQuery,
  });

  // People lookup runs alongside skills, against the real `/users/lookup`.
  const people = usePeopleSearch(isSearchOpen ? query : '', principal.public_id);

  // The bell's number: the server's own unread count, the same number the
  // Notifications screen drains with every read or resolution. Mounted here
  // rather than in a subtree because React Query owns the lifecycle — the
  // realtime bridge invalidates this key on `notification.created`, and the
  // focus refetch corrects it when the reader returns to the app.
  const unread = useUnreadNotificationCount();

  const items = suggestions.data?.items ?? [];

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
    // Focus on the next frame: the input does not exist until search is open.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const closeSearch = useCallback(() => {
    inputRef.current?.blur();
    setIsSearchOpen(false);
    setQuery('');
  }, []);

  const clearQuery = useCallback(() => {
    setQuery('');
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  /**
   * A skill result is a real destination (`/profile/skills`), so picking one
   * navigates rather than merely closing the field. Search is closed first so
   * the header returns to its compact state behind the pushed screen.
   */
  const openSkills = useCallback(() => {
    closeSearch();
    router.push('/profile/skills' as never);
  }, [closeSearch, router]);

  return (
    <View style={styles.header} testID="dashboard-header">
      <View style={styles.headerRow}>
        <Pressable
          style={styles.menuToggle}
          onPress={toggleSidebar}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={isSidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
          accessibilityHint="Toggles the navigation sidebar"
          accessibilityState={{ expanded: isSidebarOpen }}>
          <Animated.View
            style={{
              opacity: menuIconFade,
              transform: [{ scale: menuIconScale }, { rotate: menuIconSpin }],
            }}>
            <AppIcon
              name={
                isSidebarOpen
                  ? { ios: 'xmark', android: 'close' }
                  : { ios: 'line.3.horizontal', android: 'menu' }
              }
              size={22}
              color={colors.colorTextPrimary}
            />
          </Animated.View>
        </Pressable>

        {isSearchOpen ? (
          <View style={styles.searchFieldExpanded}>
            <AppIcon name={SEARCH_ICON} size={17} color={colors.colorTextTertiary} />
            <TextInput
              ref={inputRef}
              accessibilityLabel="Search people by name or username, and skills"
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Search people or skills..."
              placeholderTextColor={colors.colorTextTertiary}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 ? (
              <Pressable
                style={styles.searchClear}
                onPress={clearQuery}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search">
                <AppIcon
                  name={{ ios: 'xmark.circle.fill', android: 'cancel' }}
                  size={16}
                  color={colors.colorTextTertiary}
                />
              </Pressable>
            ) : null}
          </View>
        ) : (
          <Pressable
            style={styles.searchTrigger}
            onPress={openSearch}
            accessibilityRole="search"
            accessibilityLabel="Search people by name or username, and skills"
            accessibilityHint="Opens search">
            <AppIcon name={SEARCH_ICON} size={17} color={colors.colorTextTertiary} />
            <AppText
              variant="small"
              tone="tertiary"
              numberOfLines={1}
              style={styles.searchPlaceholder}>
              Search people or skills...
            </AppText>
          </Pressable>
        )}

        {/* While searching, Cancel takes the slot the bell and avatar would
            occupy, so the input can grow without overlapping either of them. */}
        {isSearchOpen ? (
          <Pressable
            style={styles.searchCancel}
            onPress={closeSearch}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Close search">
            <AppText variant="small" weight="semibold" tone="accent">
              Cancel
            </AppText>
          </Pressable>
        ) : (
          <>
            {/*
              The bell opens the real `/notifications` inbox, and carries the
              server's unread count (hidden at zero) so a pending request is
              visible from Home the moment the server records it.
            */}
            <NotificationBell
              count={unread.isError ? 0 : unread.count}
              isLoading={unread.isLoading}
              onPress={() => router.push('/notifications' as never)}
            />

            <Pressable
              style={styles.headerAction}
              onPress={() => router.push('/profile' as never)}
              accessibilityRole="button"
              accessibilityLabel={`Open your profile (${principal.name})`}
              accessibilityHint="Opens your profile">
              <View style={styles.avatarRing}>
                <Avatar name={principal.name} src={avatarUrl} size={32} />
              </View>
            </Pressable>
          </>
        )}
      </View>

      {isSearchOpen ? (
        hasQuery ? (
          <View style={styles.searchResults}>
            {/* People first — the real `/users/lookup`, self excluded, each row
                opening a public profile or sending a connection request. */}
            {people.isDebouncing || people.isPending ? (
              <AppText variant="small" tone="secondary" style={styles.searchResult}>
                Searching people…
              </AppText>
            ) : null}

            {people.isError ? (
              <View style={styles.searchResult}>
                <AppText variant="small" tone="danger">
                  {people.error}
                </AppText>
                <AppText
                  variant="small"
                  weight="semibold"
                  tone="accent"
                  accessibilityRole="button"
                  onPress={people.refetch}>
                  Retry
                </AppText>
              </View>
            ) : null}

            {people.isEmpty ? (
              <AppText variant="small" tone="secondary" style={styles.searchResult}>
                {`No people match “${trimmed}”.`}
              </AppText>
            ) : null}

            <PeopleSearchResults people={people.people} selfPublicId={principal.public_id} />

            {/* A section break so people and skills never read as one list. */}
            {people.people.length > 0 && items.length > 0 ? (
              <AppText variant="caption" uppercase tone="tertiary" style={styles.searchHint}>
                Skills
              </AppText>
            ) : null}

            {suggestions.isPending ? (
              <AppText variant="small" tone="secondary" style={styles.searchResult}>
                Searching skills…
              </AppText>
            ) : null}

            {suggestions.isError ? (
              <AppText variant="small" tone="danger" style={styles.searchResult}>
                Skill search is temporarily unavailable.
              </AppText>
            ) : null}

            {!suggestions.isPending && !suggestions.isError && items.length === 0 ? (
              <AppText variant="small" tone="secondary" style={styles.searchResult}>
                {`No skills match “${trimmed}”.`}
              </AppText>
            ) : null}

            {items.length > 0
              ? items.map((item) => (
                  <Pressable
                    key={item.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Open skills to review ${item.name}`}
                    onPress={openSkills}
                    style={styles.searchResult}>
                    <AppText variant="small" weight="medium">
                      {item.name}
                    </AppText>
                    {item.category ? (
                      <AppText variant="caption" tone="tertiary">
                        {item.category}
                      </AppText>
                    ) : null}
                  </Pressable>
                ))
              : null}

            <AppText variant="caption" tone="tertiary" style={styles.searchHint}>
              Tap a person to open their profile. Skills open on your profile, where you set levels
              and evidence.
            </AppText>
          </View>
        ) : (
          <AppText variant="caption" tone="tertiary">
            Search by name or @username to find people, or a skill name to review your levels.
          </AppText>
        )
      ) : null}
    </View>
  );
}
