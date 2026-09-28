/**
 * PostActionBar — Like, Comment, Save, Share.
 *
 * Each control does something real today:
 *
 *  - **Like / Save** toggle session-scoped state held on the device
 *    (`localEngagement.ts`). They are not server state, and the card says so in
 *    words rather than implying a backend round trip.
 *  - **Comment** opens the comments sheet, which states honestly that commenting
 *    is not open yet.
 *  - **Share** opens the native share sheet with content that really exists —
 *    see `sharePost` below.
 *
 * **No counts are shown.** There is no engagement API, so there is no like or
 * comment total to display, and printing a number would be the single most
 * misleading thing this component could do.
 */

import { Pressable, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';

export interface PostActionBarProps {
  liked: boolean;
  saved: boolean;
  onLike: () => void;
  onComment: () => void;
  onSave: () => void;
  onShare: () => void;
}

export function PostActionBar({
  liked,
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
          accessibilityLabel={liked ? 'Unlike this post' : 'Like this post'}
          selected={liked}
          icon={
            liked
              ? { ios: 'heart.fill', android: 'favorite' }
              : { ios: 'heart', android: 'favorite_border' }
          }
          onPress={onLike}
        />
        <Action
          label="Comment"
          accessibilityLabel="Open comments"
          selected={false}
          icon={{ ios: 'bubble.left', android: 'chat_bubble_outline' }}
          onPress={onComment}
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
        />
        <Action
          label="Share"
          accessibilityLabel="Share this post"
          selected={false}
          icon={{ ios: 'square.and.arrow.up', android: 'share' }}
          onPress={onShare}
        />
      </View>
    </View>
  );
}

function Action({
  label,
  accessibilityLabel,
  selected,
  icon,
  onPress,
}: {
  label: string;
  accessibilityLabel: string;
  selected: boolean;
  icon: { ios: string; android: string };
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected }}
      onPress={onPress}
      hitSlop={4}
      style={[styles.action, selected ? styles.actionActive : null]}>
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
    </Pressable>
  );
}
