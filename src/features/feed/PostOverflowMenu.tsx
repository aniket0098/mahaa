/**
 * PostOverflowMenu — the post's three-dot menu.
 *
 * It lists three actions, and only three, because only three can work today:
 *
 *  - **Save / Remove from saved** — session-scoped device state.
 *  - **Hide post** — session-scoped device state.
 *  - **Manage in profile** — a real navigation to `/profile`, shown only on the
 *    candidate's own posts, because it only makes sense for a record they own.
 *
 * What is deliberately **absent**, and why:
 *
 *  - **Delete post** — there is no delete endpoint. A candidate's own project,
 *    certificate, or achievement is edited through the profile screens, which is
 *    what "Manage in profile" leads to. Even on your own post, a Delete action
 *    that removed only a local copy would be a lie about the server.
 *  - **Copy link** — no clipboard module is installed, and a post has no URL
 *    (there is no post-detail route), so there is no link to copy. Sharing is
 *    offered in the action row instead, where it can use the real project URL.
 *  - **Report post** — no report endpoint and no moderation queue exists, so a
 *    Report item would file a complaint into nothing.
 *
 * `role: 'menuitem'` is intentionally avoided: React Native has no menuitem role,
 * so each row is a plain button with a descriptive label.
 */

import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors, spacing } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';

export interface PostOverflowMenuProps {
  visible: boolean;
  /** True only for the candidate's own profile records. */
  isOwnPost: boolean;
  saved: boolean;
  onToggleSave: () => void;
  onHide: () => void;
  onManageInProfile: () => void;
  onClose: () => void;
}

export function PostOverflowMenu({
  visible,
  isOwnPost,
  saved,
  onToggleSave,
  onHide,
  onManageInProfile,
  onClose,
}: PostOverflowMenuProps) {
  const insets = useSafeAreaInsets();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      testID="feed-post-menu">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close post menu"
        onPress={onClose}
        style={styles.dialogBackdrop}>
        <Pressable
          onPress={() => undefined}
          style={[styles.dialogCard, { paddingBottom: insets.bottom + spacing.cardPadding }]}>
          <AppText variant="h3" weight="semibold" accessibilityRole="header">
            Post options
          </AppText>

          <View style={styles.sheetBody}>
            <MenuRow
              label={saved ? 'Remove from saved' : 'Save post'}
              hint="Stored on this device only"
              icon={
                saved
                  ? { ios: 'bookmark.fill', android: 'bookmark' }
                  : { ios: 'bookmark', android: 'bookmark_border' }
              }
              onPress={onToggleSave}
            />
            <MenuRow
              label="Hide post"
              hint="Hides it for this session"
              icon={{ ios: 'eye.slash', android: 'visibility_off' }}
              onPress={onHide}
            />
            {isOwnPost ? (
              <MenuRow
                label="Manage in profile"
                hint="Opens the profile record behind this post"
                icon={{ ios: 'person.crop.circle', android: 'person_outline' }}
                onPress={onManageInProfile}
              />
            ) : null}
          </View>

          <AppText variant="caption" style={styles.sheetComposerNote}>
            Saving and hiding are kept on this device for this session. There is no posts API yet, so
            nothing here is stored on the server.
          </AppText>

          <MenuRow
            label="Close"
            icon={{ ios: 'xmark', android: 'close' }}
            onPress={onClose}
            align="center"
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MenuRow({
  label,
  hint,
  icon,
  onPress,
  align = 'start',
}: {
  label: string;
  hint?: string;
  icon: { ios: string; android: string };
  onPress: () => void;
  align?: 'start' | 'center';
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={onPress}
      style={[styles.menuRow, align === 'center' ? styles.menuRowCentered : null]}>
      <AppIcon name={icon} size={18} color={colors.colorTextSecondary} />
      <View style={styles.menuRowText}>
        <AppText variant="body" weight="medium">
          {label}
        </AppText>
        {hint ? (
          <AppText variant="caption" style={styles.sheetComposerNote}>
            {hint}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}
