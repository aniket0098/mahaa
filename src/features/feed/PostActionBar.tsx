/**
 * PostActionBar — Like, Comment, Save, Share.
 *
 * Each control does something real:
 *
 *  - **Like** is the server-backed one. It is optimistic with a rollback
 *    (`usePostEngagement`), so the heart fills instantly and reverts if the
 *    request fails. It shows the server's count beside the icon, and is disabled
 *    while a request is in flight so a double tap cannot queue two writes.
 *  - **Save** remains session-scoped device state, and the card says so in words
 *    rather than implying a server-side bookmark that does not exist.
 *  - **Comment** opens the sheet, which reads and writes real rows.
 *  - **Share** opens the platform share sheet with content that really exists.
 *
 * **Counts are shown, because the API now supplies them.** Before engagement
 * existed the bar printed no number at all; printing one now is only honest
 * because `likeCount` and `commentCount` come from the server, and the card has no
 * way to compute a different figure.
 */

import { Pressable, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';
import { formatCount } from '@/features/feed/feedModel';

export interface PostActionBarProps {
  /** True when *this* viewer has liked the post. */
  liked: boolean;
  /** Server-counted likes. Only printed when above zero. */
  likeCount: number;
  /** Server-counted comments. Only printed when above zero. */
  commentCount: number;
  /** True while a like request is on the wire; disables the Like button. */
  isUpdating: boolean;
  saved: boolean;
  onLike: () => void;
  onComment: () => void;
  onSave: () => void;
  onShare: () => void;
}

export function PostActionBar({
  liked,
  likeCount,
  commentCount,
  isUpdating,
  saved,
  onLike,
  onComment,
  onSave,
  onShare,
}: PostActionBarProps) {
  return (
    <View style={styles.actionRow} testID="feed-action-bar">
      <View style={styles.actionList}>
        <Action
          label="Like"
          count={likeCount}
          accessibilityLabel={
            isUpdating
              ? 'Updating like'
              : liked
                ? 'Unlike this post'
                : 'Like this post'
          }
          selected={liked}
          disabled={isUpdating}
          icon={
            liked
              ? { ios: 'heart.fill', android: 'favorite' }
              : { ios: 'heart', android: 'favorite_border' }
          }
          onPress={onLike}
          testID="feed-action-like"
        />
        <Action
          label="Comment"
          count={commentCount}
          accessibilityLabel={
            commentCount > 0
              ? `Comment on this post. ${formatCount(commentCount)} ${
                  commentCount === 1 ? 'comment' : 'comments'
                }`
              : 'Comment on this post'
          }
          selected={false}
          icon={{ ios: 'bubble.left', android: 'chat_bubble_outline' }}
          onPress={onComment}
          testID="feed-action-comment"
        />
        <Action
          label="Save"
          accessibilityLabel={saved ? 'Remove this post from saved' : 'Save this post'}
          selected={saved}
          icon={
            saved
              ? { ios: 'bookmark.fill', android: 'bookmark' }
              : { ios: 'bookmark', android: 'bookmark_border' }
          }
          onPress={onSave}
          testID="feed-action-save"
        />
        <Action
          label="Share"
          accessibilityLabel="Share this post"
          selected={false}
          icon={{ ios: 'square.and.arrow.up', android: 'share' }}
          onPress={onShare}
          testID="feed-action-share"
        />
      </View>
    </View>
  );
}

function Action({
  label,
  count,
  accessibilityLabel,
  selected,
  disabled = false,
  icon,
  onPress,
  testID,
}: {
  label: string;
  /** Server count, printed beside the label. Hidden entirely when zero. */
  count?: number;
  accessibilityLabel: string;
  selected: boolean;
  disabled?: boolean;
  icon: { ios: string; android: string };
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      // `selected` carries the on/off meaning; `disabled` carries the request-in-
      // flight meaning. Collapsing them into one field would make a busy button
      // announce itself as "unlike", which is the opposite of what it will do.
      accessibilityState={{ selected, disabled, busy: disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={4}
      style={({ pressed }) => [
        styles.action,
        selected ? styles.actionActive : null,
        disabled ? styles.actionDisabled : null,
        pressed && !disabled ? styles.actionPressed : null,
      ]}
      testID={testID}>
      <AppIcon
        name={icon}
        size={18}
        color={selected ? colors.colorPrimary : colors.colorTextSecondary}
      />
      <AppText
        variant="small"
        weight="medium"
        style={selected ? styles.linkLabel : styles.actionLabel}>
        {label}
      </AppText>
      {count && count > 0 ? (
        <AppText variant="caption" tone="tertiary" style={styles.actionCount}>
          {formatCount(count)}
        </AppText>
      ) : null}
    </Pressable>
  );
}
