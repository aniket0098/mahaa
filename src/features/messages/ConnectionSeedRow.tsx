import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { colors, radius, spacing } from '@/theme/tokens';
import type { UserSummary } from '@/types/onboarding';

/**
 * One connected person who does not have a thread yet.
 *
 * The Messages list shows this row with a "Start a conversation" action. The
 * screen never fabricates a conversation: the tap asks the server to open or
 * create the authorized thread, and the row stays until the server hands back
 * an id. A seeded row is not a conversation — it carries no unread count and
 * never appears in the Unread pane.
 */
export interface ConnectionSeedRowProps {
  /** The other person's summary (name, username, face). */
  person: UserSummary;
  /** The live connection row behind this seed; used for the navigation key
   *  and the accessible name. */
  connectionId: string;
  /** Creates (or reuses) the thread with this person's internal id and asks
   *  the caller to navigate. */
  onStart: (userId: string) => void;
  /** True while the server is building the thread. */
  loading: boolean;
  /** Persistent error for the last attempt, or null. */
  error: string | null;
}

export function ConnectionSeedRow({
  person,
  connectionId,
  onStart,
  loading,
  error,
}: ConnectionSeedRowProps) {
  const router = useRouter();

  const open = () => {
    onStart(person.user_id);
  };

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`Start a conversation with ${person.name}`}
      accessibilityHint="Opens or creates a conversation with this person"
      testID={`seed-conversation-${connectionId}`}
      style={({ pressed }) => [styles.root, pressed && styles.rootPressed]}>
      <View style={styles.wrap}>
        <Avatar name={person.name} src={person.avatar_url} size={40} />
        <View style={styles.identity}>
          <AppText variant="body" weight="semibold" numberOfLines={1}>
            {person.name}
          </AppText>
          <AppText variant="caption" tone="tertiary" numberOfLines={1}>
            @{person.username}
          </AppText>
          <AppText variant="caption" tone="secondary">
            Start a conversation
          </AppText>
        </View>
      </View>

      {error ? (
        <AppText variant="caption" tone="danger" style={styles.error}>
          {error}
        </AppText>
      ) : null}

      <Button
        label="Message"
        variant="primary"
        onPress={open}
        disabled={loading}
        style={styles.button}
        accessibilityHint="Opens or creates a conversation with this person"
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  rootPressed: {
    opacity: 0.85,
  },
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  identity: {
    flex: 1,
    gap: spacing.xs,
  },
  error: {
    flexShrink: 1,
  },
  button: {
    minWidth: 96,
  },
});
