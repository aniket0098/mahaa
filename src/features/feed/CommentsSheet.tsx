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

import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { colors, spacing } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';
import { formatFeedTime, type FeedComment, type FeedPost } from '@/features/feed/feedModel';
import { MAX_COMMENT_CHARS, usePostComments } from '@/features/feed/usePostComments';

export interface CommentsSheetProps {
  post: FeedPost | null;
  visible: boolean;
  onClose: () => void;
}

export function CommentsSheet({ post, visible, onClose }: CommentsSheetProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');

  const comments = usePostComments(post?.id ?? '');

  // Clearing on close makes the sheet a fresh session each time: a draft the reader
  // abandoned should not reappear next time they open it.
  const handleClose = useCallback(() => {
    setDraft('');
    onClose();
  }, [onClose]);

  const canSend =
    draft.trim().length > 0 && draft.length <= MAX_COMMENT_CHARS && comments.canSend;

  const handleSend = useCallback(() => {
    if (!canSend) return;
    comments.send(draft);
    setDraft('');
  }, [canSend, comments, draft]);

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
        onPress={handleClose}
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
              onPress={handleClose}
              hitSlop={8}
              style={styles.viewerNavButton}>
              <AppIcon
                name={{ ios: 'xmark', android: 'close' }}
                size={18}
                color={colors.colorTextPrimary}
              />
            </Pressable>
          </View>

          {/* The keyboard must not cover the composer, so the sheet moves out of its
              way. `undefined` on Android is deliberate: the platform already resizes
              the window, and asking for both double-pads the list. */}
          <KeyboardAvoidingView
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            style={styles.sheetKeyboard}>
            <ScrollView
              contentContainerStyle={styles.sheetBody}
              keyboardShouldPersistTaps="handled"
              testID="feed-comments-list">
              {comments.isDemo ? (
                <View style={styles.sheetEmpty}>
                  <AppText variant="small" tone="secondary">
                    This is demo content, so there is nothing on the server to reply to.
                  </AppText>
                </View>
              ) : comments.status === 'loading' ? (
                <View style={styles.commentComposerRow}>
                  <ActivityIndicator
                    accessibilityLabel="Loading comments"
                    color={colors.colorPrimary}
                  />
                </View>
              ) : comments.status === 'error' ? (
                <StatusBanner
                  title="Comments could not load"
                  description={comments.errorMessage}
                />
              ) : comments.comments.length === 0 ? (
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
                    Be the first to reply.
                  </AppText>
                </View>
              ) : (
                comments.comments.map((comment) => (
                  <CommentRow key={comment.id} comment={comment} />
                ))
              )}
            </ScrollView>

            {comments.problem ? (
              <StatusBanner
                tone="error"
                title="Your comment was not sent"
                description={comments.problem}
                onRetry={comments.dismissProblem}
              />
            ) : null}

            {!comments.isDemo ? (
              <View style={styles.commentComposer}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Write a comment…"
                  placeholderTextColor={colors.colorTextDisabled}
                  multiline
                  accessibilityLabel="Write a comment"
                  style={styles.commentInput}
                  maxLength={MAX_COMMENT_CHARS}
                  testID="feed-comment-input"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Send comment"
                  // Disabled rather than removed when there is nothing to send: a
                  // control that vanishes is one a screen-reader user cannot find.
                  accessibilityState={{ disabled: !canSend, busy: comments.isSending }}
                  disabled={!canSend}
                  onPress={handleSend}
                  hitSlop={8}
                  style={[styles.commentSend, canSend ? null : styles.commentSendDisabled]}
                  testID="feed-comment-send">
                  {comments.isSending ? (
                    <ActivityIndicator size="small" color={colors.colorTextOnPrimary} />
                  ) : (
                    <AppIcon
                      name={{ ios: 'arrow.up', android: 'send' }}
                      size={18}
                      color={colors.colorTextOnPrimary}
                    />
                  )}
                </Pressable>
              </View>
            ) : null}
          </KeyboardAvoidingView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * One comment: avatar, name, relative time, then the text.
 *
 * **A pending row is dimmed and says "Sending…".** It has not reached the server
 * yet, so rendering it exactly like a saved comment would claim a persistence that
 * has not happened. The label is words rather than a spinner alone, because a
 * spinner says "loading something" and not "this is yours and it is on its way".
 */
function CommentRow({ comment }: { comment: FeedComment }) {
  const pending = 'pending' in comment && comment.pending === true;

  return (
    <View
      style={styles.commentRow}
      testID={`feed-comment-${comment.id}`}
      accessibilityLabel={`Comment by ${comment.author.name}`}>
      <Avatar name={comment.author.name} src={comment.author.avatarUrl} size={32} />

      <View style={styles.commentBody}>
        <View style={styles.commentMeta}>
          <AppText variant="small" weight="semibold" numberOfLines={1}>
            {comment.author.name}
          </AppText>
          {comment.author.username ? (
            <AppText variant="caption" tone="tertiary" numberOfLines={1}>
              {`@${comment.author.username}`}
            </AppText>
          ) : null}
          <AppText variant="caption" tone="tertiary">
            {pending ? 'Sending…' : formatFeedTime(comment.createdAt)}
          </AppText>
        </View>

        <AppText variant="small" style={pending ? styles.commentPendingText : undefined}>
          {comment.body}
        </AppText>
      </View>
    </View>
  );
}
