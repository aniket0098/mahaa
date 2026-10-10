/**
 * DiscoverHeader — the pinned top bar of Discover: title row + search field.
 *
 * It sits *outside* the scrolling FlatList so the screen name and the search
 * box stay reachable while the feed scrolls — the anchor LinkedIn and Indeed
 * both use, and the primary habit-forming entry point on a job board. The old
 * fixed "Discover" + subtitle is gone: the subtitle's job ("newest first") is
 * carried by the results summary below, which reclaims the vertical space.
 *
 * The avatar chip is the one optional affordance. It comes from the real
 * authenticated principal (session name → initials; `GET /auth/me` carries no
 * photo, so it is initials-only, never a blank photo) and opens `/profile`,
 * mirroring the Home header's chrome. When there is no principal yet it is
 * simply not rendered — the title row never shifts layout to make room for it.
 *
 * Search state is *not* owned here: `OpportunityList` threads `value` /
 * `onChangeText` in, so the one debounce and the one query key stay in the
 * screen. This component is presentational chrome.
 */

import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAuth } from '@/auth/AuthContext';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { spacing } from '@/theme/tokens';

import { DiscoverSearchField } from './DiscoverSearchField';
import { styles } from './discoverStyles';

export interface DiscoverHeaderProps {
  searchValue: string;
  onSearchChange: (text: string) => void;
  onSearchSubmit: () => void;
}

export function DiscoverHeader({
  searchValue,
  onSearchChange,
  onSearchSubmit,
}: DiscoverHeaderProps) {
  const router = useRouter();
  const { principal } = useAuth();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.headerTopRow}>
        <AppText variant="h1" weight="bold" accessibilityRole="header" style={styles.headerTitle}>
          Discover
        </AppText>
        {principal ? (
          <Pressable
            onPress={() => router.push('/profile' as never)}
            accessibilityRole="button"
            accessibilityLabel={`Open your profile (${principal.name})`}
            accessibilityHint="Opens your profile"
            style={styles.avatarButton}>
            <Avatar name={principal.name} size={32} />
          </Pressable>
        ) : null}
      </View>
      <DiscoverSearchField
        value={searchValue}
        onChangeText={onSearchChange}
        onSubmit={onSearchSubmit}
      />
    </View>
  );
}
