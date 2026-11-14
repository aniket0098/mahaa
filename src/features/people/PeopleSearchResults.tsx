/**
 * `PeopleSearchResults` — the compact people list that drops below Home's search
 * field once the term is long enough.
 *
 * Each row is a real account from `GET /users/lookup`: avatar (with an initials
 * fallback when the photo is missing or fails), display name, `@username`, and
 * the Connect affordance when the relationship permits one. Only the fields the
 * lookup returns are rendered — no private data (email, phone) is available here
 * or shown.
 *
 * Two distinct tap targets, deliberately:
 *
 *  - the row body / avatar opens that person's **public profile**
 *    (`/user/[id]`, keyed by the immutable public id) and sends nothing;
 *  - the **Connect** button alone sends a connection request.
 *
 * A self row can never appear — `usePeopleSearch` drops the caller — so there is
 * no self-Connect button to disable after the fact. The Connect state comes from
 * `usePersonConnection`, the same hook the profile screen uses, so the two
 * surfaces can never disagree about the same relationship.
 */

import { memo } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { usePersonConnection } from '@/features/people/usePersonConnection';
import { colors, radius, spacing } from '@/theme/tokens';
import type { UserSummary } from '@/types/onboarding';

export interface PeopleSearchResultsProps {
  people: readonly UserSummary[];
  selfPublicId: string | null;
}

interface SuggestionRowProps {
  person: UserSummary;
  selfPublicId: string | null;
}

function SuggestionRow({ person, selfPublicId }: SuggestionRowProps) {
  const router = useRouter();
  const connection = usePersonConnection(person.public_id, selfPublicId);

  const openProfile = () => {
    router.push(`/user/${encodeURIComponent(person.public_id)}` as never);
  };

  return (
    <Pressable
      onPress={openProfile}
      accessibilityRole="button"
      accessibilityLabel={`Open ${person.name}'s profile`}
      accessibilityHint="Opens their public profile without sending a request"
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}>
      <Avatar name={person.name} src={person.avatar_url} size={40} />

      <View style={styles.identity}>
        <View style={styles.nameLine}>
          <AppText variant="small" weight="semibold" numberOfLines={1}>
            {person.name}
          </AppText>
        </View>

        {person.role ? (
          <View style={styles.headline}>
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              {person.role}
            </AppText>
          </View>
        ) : null}

        <AppText variant="caption" tone="tertiary" numberOfLines={1}>
          {`@${person.username}`}
        </AppText>
      </View>

      {/* The Connect affordance. Only `none` (Connect) fires a request; the
          other states are informational or resolve an incoming request. */}
      {connection.kind === 'send' ? (
        <Button
          label={connection.label}
          variant="secondary"
          size="md"
          loading={connection.isBusy}
          disabled={connection.isBusy}
          accessibilityHint="Sends a connection request"
          onPress={connection.send}
          style={styles.action}
        />
      ) : (
        <View
          style={[styles.statePill, connection.state === 'connected' ? styles.connectedPill : null]}>
          <AppText
            variant="caption"
            weight="semibold"
            tone={connection.state === 'connected' ? 'success' : 'secondary'}>
            {connection.label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

/** One render per person for the lifetime of the list, so typing does not repaint every row. */
const MemoizedRow = memo(SuggestionRow);

export function PeopleSearchResults({ people, selfPublicId }: PeopleSearchResultsProps) {
  if (people.length === 0) return null;

  return (
    <View style={styles.list} accessibilityRole="list">
      {people.map((person) => (
        <MemoizedRow key={person.public_id} person={person} selfPublicId={selfPublicId} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.xs,
  },
  row: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed: {
    backgroundColor: colors.colorBgMuted,
  },
  identity: {
    flex: 1,
    gap: 2,
  },
  nameLine: {
    flexDirection: 'column',
    gap: 1,
  },
  headline: {
    flexDirection: 'row',
    gap: 2,
  },
  action: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  statePill: {
    borderRadius: radius.control,
    minWidth: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  connectedPill: {
    backgroundColor: colors.colorSuccessSubtle,
  },
});