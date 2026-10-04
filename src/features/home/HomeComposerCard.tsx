/**
 * HomeComposerCard — the publishing entry point on the candidate Home page.
 *
 * **It is an entry, not a second composer.** The real composer is the
 * `/add-post` screen, and this opens it. That is a deliberate choice rather than
 * a shortcut: the composer is 600-odd lines holding the draft model, the upload
 * state machine, per-slot progress, the media limits probe and a discard
 * confirmation. Mounting a copy of it inline on Home would mean two places where
 * "what counts as a publishable draft" is decided, and the two would drift the
 * first time a rule changed. One screen owns publishing; Home just makes it
 * reachable in one tap.
 *
 * **The type chips are read from `COMPOSER_TYPES`, not written out here.** That
 * array is the composer's own vocabulary, including which entries are currently
 * unavailable, so the entry cannot advertise a type the composer would refuse —
 * and cannot offer a button for one that is switched off. Video is the case
 * that matters: the backend accepts it, the frontend does not yet, so the chip
 * is rendered visibly unavailable with the composer's own stated reason rather
 * than being hidden or faked into working.
 *
 * The avatar is the caller's, resolved from the profile aggregate Home already
 * fetches — no extra request — and is absolutised here because the API serves
 * media as a relative path.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { absoluteMediaUri } from '@/api/media';
import { COMPOSER_TYPES } from '@/features/composer/composerModel';
import { colors, radius, spacing } from '@/theme/tokens';

export interface HomeComposerCardProps {
  /** The signed-in candidate's display name, for the avatar fallback. */
  name: string;
  /** Relative or absolute avatar path from the profile aggregate. */
  avatarUrl?: string | null;
  /** Opens the composer. */
  onCompose: () => void;
}

export function HomeComposerCard({ name, avatarUrl, onCompose }: HomeComposerCardProps) {
  const avatarSrc = avatarUrl ? absoluteMediaUri(avatarUrl) : null;

  return (
    <Card style={styles.card} testID="home-composer-card">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create a post"
        accessibilityHint="Opens the post composer"
        onPress={onCompose}
        style={({ pressed }) => [styles.prompt, pressed ? styles.pressed : null]}
        testID="home-composer-prompt">
        <Avatar name={name} src={avatarSrc} size={40} />

        <AppText variant="body" tone="secondary" style={styles.promptText} numberOfLines={1}>
          What do you want to share?
        </AppText>

        <AppIcon
          name={{ ios: 'square.and.pencil', android: 'edit' }}
          size={20}
          color={colors.colorTextTertiary}
        />
      </Pressable>

      <View style={styles.types}>
        {COMPOSER_TYPES.map((type) => (
          <Pressable
            key={type.value}
            accessibilityRole="button"
            // The unavailable reason is spoken rather than shown as a dead chip,
            // so a screen-reader user learns why it cannot be pressed.
            accessibilityLabel={
              type.enabled ? `Create a ${type.label} post` : `${type.label}: unavailable`
            }
            accessibilityHint={type.enabled ? type.hint : type.unavailableReason}
            accessibilityState={{ disabled: !type.enabled }}
            disabled={!type.enabled}
            onPress={onCompose}
            style={({ pressed }) => [
              styles.type,
              type.enabled ? null : styles.typeDisabled,
              pressed ? styles.pressed : null,
            ]}
            testID={`home-composer-type-${type.value}`}>
            <AppIcon
              name={type.icon}
              size={18}
              color={type.enabled ? colors.colorTextSecondary : colors.colorTextTertiary}
            />
            <AppText
              variant="small"
              tone={type.enabled ? 'secondary' : 'tertiary'}
              numberOfLines={1}>
              {type.label}
            </AppText>
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  prompt: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    // 48px is the project's minimum touch target, so the whole row is tappable
    // rather than only the words inside it.
    minHeight: 48,
  },
  promptText: { flex: 1 },
  types: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  type: {
    alignItems: 'center',
    borderColor: colors.colorBorder,
    borderRadius: radius.control,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  /** Muted rather than hidden: an absent chip would look like the type does not exist. */
  typeDisabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
});
