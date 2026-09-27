/**
 * Dashboard header — the native reproduction of `StudentMobileHeader`.
 *
 * Two rows, exactly as the web mobile header defines them:
 *   1. brand mark + wordmark on the left, the user's avatar on the right;
 *   2. the search field, which belongs to the chrome rather than the page body
 *      so it stays reachable and the first content section under it is always
 *      the opportunity story row.
 *
 * What is deliberately **not** here, because the original does not have it:
 *  - **No welcome/greeting message.** The greeting block was removed from the
 *    design so the story row could sit directly under the chrome
 *    (`dashboardHome.module.css` header comment; `docs/PRODUCT_DECISIONS.md`).
 *  - **No notifications control.** The blueprint lists one, but there is no
 *    notifications route, so the original header "ships only what exists"
 *    (see `StudentMobileHeader`'s own comment and PRODUCT_DECISIONS S8). Adding
 *    one here would be inventing a destination.
 *
 * The avatar and the name both come from the real authenticated principal; the
 * search is backed by the real skill catalogue (`GET /skills/catalog`).
 */

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Pressable, TextInput, View } from 'react-native';

import { searchSkillCatalog } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { AppIcon } from '@/components/ui/AppIcon';
import { Avatar } from '@/components/ui/Avatar';
import { BrandMark } from '@/components/ui/BrandMark';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/home/homeStyles';
import type { Principal } from '@/types/auth';

/** Minimum term before the real catalogue request is made. */
const MIN_QUERY_LENGTH = 2;

export interface DashboardHeaderProps {
  principal: Principal;
}

export function DashboardHeader({ principal }: DashboardHeaderProps) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const trimmed = query.trim();
  const expanded = trimmed.length >= MIN_QUERY_LENGTH;

  // Deferred: the catalogue is only requested once the term is long enough,
  // so opening the screen never pulls the whole list.
  const suggestions = useQuery({
    queryKey: queryKeys.skillCatalog(trimmed),
    queryFn: () => searchSkillCatalog(trimmed, 6, 0),
    enabled: expanded,
  });

  const items = suggestions.data?.items ?? [];

  return (
    <View style={styles.header} testID="dashboard-header">
      <View style={styles.headerRow}>
        <View style={styles.headerBrand}>
          <BrandMark size="sm" />
          <AppText variant="h3" weight="bold" style={styles.brandName}>
            MahaJob
          </AppText>
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open your profile (${principal.name})`}
          hitSlop={8}
          onPress={() => router.push('/profile' as never)}>
          <Avatar name={principal.name} size={32} />
        </Pressable>
      </View>

      <View style={styles.searchField}>
        <AppIcon
          name={{ ios: 'magnifyingglass', android: 'search' }}
          size={17}
          color={colors.colorTextTertiary}
        />
        <TextInput
          accessibilityLabel="Search skills"
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search skills"
          placeholderTextColor={colors.colorTextTertiary}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>

      {expanded ? (
        <View style={styles.searchResults}>
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

          {items.length > 0 ? (
            items.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Open skills to review ${item.name}`}
                onPress={() => router.push('/profile/skills' as never)}
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
          ) : null}

          <AppText variant="caption" tone="tertiary" style={styles.searchHint}>
            Skills open on your profile, where you set levels and evidence.
          </AppText>
        </View>
      ) : (
        <AppText variant="caption" tone="tertiary">
          Skill search works today. Job, internship, course, project, and people search arrive with
          the discovery stage.
        </AppText>
      )}
    </View>
  );
}
