/**
 * EngagementSummary — "12 likes · 4 comments", above the action buttons.
 *
 * **Only real numbers reach this component.** Both counts come from the server
 * (`GET /posts` carries them per viewer), and a card that wanted a different
 * figure would have to ask again. There is no default, no placeholder and no
 * client-side arithmetic anywhere in the render path — that is what keeps the feed
 * from ever showing an engagement figure nobody produced.
 *
 * **A post with no engagement says so, rather than showing a bare "0 likes".**
 * "0 likes · 0 comments" on every new post is noise; "Be the first to like this"
 * is an instruction. The empty state is only offered for a *real* post, so a demo
 * post can never invite the reader to interact with something that has no server
 * behind it.
 *
 * **The counts are buttons.** Tapping "4 comments" opens the sheet that already
 * holds them; making the number decorative would waste the one affordance a reader
 * has for reaching the conversation.
 */

import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { styles } from '@/features/feed/feedStyles';
import { formatCount } from '@/features/feed/feedModel';

export interface EngagementSummaryProps {
  /** Server-counted likes, never guessed. */
  likeCount: number;
  /** Server-counted live comments. */
  commentCount: number;
  /** Whether this viewer has liked the post. */
  likedByMe: boolean;
  /** Opens the comment sheet. */
  onOpenComments: () => void;
}

export function EngagementSummary({
  likeCount,
  commentCount,
  likedByMe,
  onOpenComments,
}: EngagementSummaryProps) {
  const hasAny = likeCount > 0 || commentCount > 0;

  if (!hasAny) {
    return (
      <AppText variant="small" tone="tertiary" style={styles.summaryEmpty}>
        {likedByMe ? 'You liked this' : 'Be the first to like this'}
      </AppText>
    );
  }

  return (
    <View style={styles.summaryRow} testID="feed-engagement-summary">
      {likeCount > 0 ? (
        <AppText variant="small" tone="secondary" style={styles.summaryText}>
          {`${formatCount(likeCount)} ${likeCount === 1 ? 'like' : 'likes'}`}
        </AppText>
      ) : null}

      {commentCount > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${formatCount(commentCount)} ${
            commentCount === 1 ? 'comment' : 'comments'
          }. Open comments`}
          onPress={onOpenComments}
          hitSlop={8}
          style={styles.summaryLink}
          testID="feed-summary-comments">
          <AppText variant="small" tone="secondary" style={styles.summaryLinkText}>
            {`${formatCount(commentCount)} ${commentCount === 1 ? 'comment' : 'comments'}`}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
