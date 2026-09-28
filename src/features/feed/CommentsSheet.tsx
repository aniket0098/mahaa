/**
 * CommentsSheet — where the Comment action leads.
 *
 * There is no comments API, so this sheet does not offer a composer that would
 * save nowhere: the field is rendered **disabled**, and the reason is stated in
 * plain words next to it. What the sheet does provide is the real empty state,
 * the post the comments would belong to, and the shape the feature will take —
 * which is more useful for review than a control that silently does nothing.
 *
 * This is the same decision the Home page's Create (+) entry already makes — it
 * opens `/add-post`, which is an honest notice until a posts API exists — and it
 * keeps one rule intact: a control that cannot work is never made to look like
 * it can.
 */

import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors, spacing } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';
import type { FeedPost } from '@/features/feed/feedModel';

export interface CommentsSheetProps {
  post: FeedPost | null;
  visible: boolean;
  onClose: () => void;
}

export function CommentsSheet({ post, visible, onClose }: CommentsSheetProps) {
  const insets = useSafeAreaInsets();
  if (!post) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
      testID="feed-comments-sheet">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close comments"
        onPress={onClose}
        style={styles.sheetBackdrop}>
        {/* Tapping the sheet itself must not dismiss it, so the card absorbs the press. */}
        <Pressable
          onPress={() => undefined}
          style={[styles.sheetCard, { paddingBottom: insets.bottom + spacing.cardPadding }]}>
          <View style={styles.sheetHeaderRow}>
            <AppText variant="h3" weight="semibold" accessibilityRole="header">
              Comments
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close comments"
              onPress={onClose}
              hitSlop={8}
              style={styles.viewerNavButton}>
              <AppIcon
                name={{ ios: 'xmark', android: 'close' }}
                size={18}
                color={colors.colorTextPrimary}
              />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.sheetBody}>
            <AppText variant="small" tone="secondary">
              {post.title ?? post.body?.slice(0, 80) ?? 'This post'}
            </AppText>

            <View style={styles.sheetEmpty}>
              <AppIcon
                name={{ ios: 'bubble.left', android: 'chat_bubble_outline' }}
                size={20}
                color={colors.colorTextTertiary}
              />
              <AppText variant="body" weight="semibold" style={styles.emptyTitle}>
                No comments yet
              </AppText>
              <AppText variant="small" tone="secondary">
                Comments arrive with the community stage. Nothing is shown here until the comments
                API exists, because an invented comment would be indistinguishable from a real one.
              </AppText>
            </View>

            <View>
              <View style={styles.sheetComposer}>
                <AppText variant="body" tone="disabled">
                  Write a comment…
                </AppText>
              </View>
              <AppText variant="caption" style={styles.sheetComposerNote}>
                Commenting is disabled until the comments API exists.
              </AppText>
            </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
