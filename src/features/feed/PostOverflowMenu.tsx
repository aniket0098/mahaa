/**
 * PostOverflowMenu - the post's three-dot menu.
 *
 * Four actions, and only four, because only four can work today:
 *
 *  - **Delete** - a real `DELETE /posts/{id}`, shown **only when the server's
 *    `is_self` says the reader owns the post** (`isOwnPost`, which the card
 *    derives from `post.author.isSelf` - never from where the post came from).
 *    Tapping it opens a confirmation dialog; the request itself runs in the
 *    card, which owns the cache.
 *  - **Save / Remove from saved** - session-scoped device state.
 *  - **Hide post** - session-scoped device state.
 *  - **Manage in profile** - a real navigation to `/profile`, on your own posts.
 *
 * The confirmation is the spec's, verbatim: "Delete this post permanently?
 * This action cannot be undone." with **Cancel** and **Delete** buttons. The
 * dialog stays open while the request runs (a spinner on Delete) and after it
 * fails, because the server's own message has to be read somewhere persistent -
 * a toast that vanished would leave the reader not knowing whether the post was
 * gone. The post itself is removed by the card only on success.
 *
 * What is deliberately **absent**:
 *
 *  - **Copy link** - no clipboard module is installed, and a post has no URL
 *    (there is no post-detail route), so there is no link to copy.
 *  - **Report post** - no report endpoint and no moderation queue exists, so a
 *    Report item would file a complaint into nothing.
 *
 * `role: 'menuitem'` is intentionally avoided: React Native has no menuitem role,
 * so each row is a plain button with a descriptive label.
 */

import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { colors, spacing } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';

export interface PostOverflowMenuProps {
  visible: boolean;
  /** True only when the server computed `is_self: true` for this reader. */
  isOwnPost: boolean;
  saved: boolean;
  onToggleSave: () => void;
  onHide: () => void;
  onManageInProfile: () => void;
  /** Runs the delete request. Called only after the dialog's Delete is tapped. */
  onDelete: () => void;
  /** True while the request is in flight: Delete spins, Cancel is disabled. */
  deleting: boolean;
  /** The server's message after a failed delete, shown until the menu closes. */
  deleteError: string | null;
  onClose: () => void;
}

export function PostOverflowMenu({
  visible,
  isOwnPost,
  saved,
  onToggleSave,
  onHide,
  onManageInProfile,
  onDelete,
  deleting,
  deleteError,
  onClose,
}: PostOverflowMenuProps) {
  const insets = useSafeAreaInsets();
  // The confirmation is dialog-local state: opening the menu always lands on
  // the action list, so a previous Cancel cannot leave the next open mid-flow.
  const [confirming, setConfirming] = useState(false);
  // Reopening the menu always lands on the action list: when `visible` flips,
  // the confirmation resets during the same render (the documented
  // adjust-during-render pattern — no effect, no cascading render).
  const [wasVisible, setWasVisible] = useState(visible);
  if (wasVisible !== visible) {
    setWasVisible(visible);
    if (!visible) setConfirming(false);
  }

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
          {confirming ? (
            <View style={styles.sheetBody} testID="feed-post-delete-confirm">
              <AppText variant="h3" weight="semibold" accessibilityRole="header">
                Delete this post permanently?
              </AppText>
              <AppText variant="small" tone="secondary">
                This action cannot be undone.
              </AppText>

              {/* Persistent, next to the buttons that caused it - never a toast. */}
              {deleteError ? (
                <AppText variant="small" style={styles.deleteError} testID="feed-post-delete-error">
                  {deleteError}
                </AppText>
              ) : null}

              <View style={styles.confirmRow}>
                <Button
                  label="Cancel"
                  variant="secondary"
                  onPress={() => setConfirming(false)}
                  disabled={deleting}
                  style={styles.confirmButton}
                />
                <Button
                  label="Delete"
                  variant="danger"
                  loading={deleting}
                  onPress={onDelete}
                  style={styles.confirmButton}
                />
              </View>
            </View>
          ) : (
            <>
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
                {/* Owner-only, and the owner is the SERVER's answer: a stranger's
                    post never shows the row, even though it arrived through the
                    same feed. Demo posts carry `isSelf: false`, so they never
                    offer a delete that could not succeed. */}
                {isOwnPost ? (
                  <MenuRow
                    label="Delete"
                    hint="Removes the post from the server permanently"
                    icon={{ ios: 'trash', android: 'delete' }}
                    tone="danger"
                    onPress={() => setConfirming(true)}
                  />
                ) : null}
              </View>

              <AppText variant="caption" style={styles.sheetComposerNote}>
                Saving and hiding are kept on this device for this session. Delete asks the server to
                remove your post for everyone.
              </AppText>
            </>
          )}

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
  tone = 'default',
}: {
  label: string;
  hint?: string;
  icon: { ios: string; android: string };
  onPress: () => void;
  align?: 'start' | 'center';
  tone?: 'default' | 'danger';
}) {
  const danger = tone === 'danger';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={hint ? `${label}. ${hint}` : label}
      onPress={onPress}
      style={[
        styles.menuRow,
        align === 'center' ? styles.menuRowCentered : null,
        danger ? styles.menuRowDanger : null,
      ]}>
      <AppIcon
        name={icon}
        size={18}
        color={danger ? colors.colorDanger : colors.colorTextSecondary}
      />
      <View style={styles.menuRowText}>
        <AppText variant="body" weight="medium" style={danger ? styles.menuRowDangerText : null}>
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