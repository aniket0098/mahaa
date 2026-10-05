/**
 * FeedPostCard — one post in the Community Feed.
 *
 * Card order: author header → type badge and title → body → tags → media →
 * structured project/achievement panel → action row. Media sits between the text
 * and the detail panel so a reader sees what the post is about before the
 * metadata, and the padded blocks stay symmetrical above and below it.
 *
 * Everything rendered here is real:
 *
 *  - the badge comes from the post's own kind — `feedKindLabel` returns null for
 *    a plain text or image post, so those cards carry no chip at all;
 *  - the body clamps at {@link BODY_PREVIEW_CHARS} lines with a See-more toggle,
 *    so a long question does not push the next post off the screen;
 *  - **no counts appear anywhere**, because no engagement API exists;
 *  - Like and Save are device-local, and the card says so whenever either is on.
 *
 * On rollback: `localEngagement.ts` already exposes and tests `revertLike` and
 * `revertSave`, which is the failure path an API-backed mutation will need. They
 * are deliberately **not** called here — with no request in flight there is
 * nothing that can fail, and firing a rollback that can never run would be
 * theatre rather than error handling.
 */

import { useState, useSyncExternalStore } from 'react';
import { Pressable, View, type LayoutChangeEvent } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { AchievementBlock } from '@/features/feed/AchievementBlock';
import { CommentsSheet } from '@/features/feed/CommentsSheet';
import { EngagementSummary } from '@/features/feed/EngagementSummary';
import { MediaViewer } from '@/features/feed/MediaViewer';
import { PostActionBar } from '@/features/feed/PostActionBar';
import { PostHeader } from '@/features/feed/PostHeader';
import { PostMedia } from '@/features/feed/PostMedia';
import { PostOverflowMenu } from '@/features/feed/PostOverflowMenu';
import { ProjectBlock } from '@/features/feed/ProjectBlock';
import { styles } from '@/features/feed/feedStyles';
import {
  BODY_PREVIEW_CHARS,
  BODY_PREVIEW_LINES,
  feedKindLabel,
  type FeedPost,
} from '@/features/feed/feedModel';
import {
  LOCAL_ENGAGEMENT_NOTE,
  getLocalEngagementVersion,
  hidePost,
  isSaved,
  subscribeLocalEngagement,
  toggleSave,
} from '@/features/feed/localEngagement';
import { sharePost } from '@/features/feed/sharePost';
import { usePostEngagement } from '@/features/feed/usePostEngagement';

export interface FeedPostCardProps {
  post: FeedPost;
  /** Opens the author's profile. Only meaningful when the post carries a route. */
  onOpenProfile: () => void;
  /** Opens an outbound link in the system browser. */
  onOpenLink: (url: string) => void;
}

export function FeedPostCard({ post, onOpenProfile, onOpenLink }: FeedPostCardProps) {
  // One subscription per card. A save or a hide changes the module store, and
  // this is what re-renders the card against the new value. (Likes are server
  // state now and arrive through React Query instead.)
  useSyncExternalStore(
    subscribeLocalEngagement,
    getLocalEngagementVersion,
    getLocalEngagementVersion,
  );

  const [expanded, setExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  // This card's own offset within the scroll content. The feed reports its
  // scroll offset; the difference of the two is what tells the playback
  // coordinator whether a video here is on screen.
  const [top, setTop] = useState(0);

  const engagement = usePostEngagement(post);

  const saved = isSaved(post.id);
  const badge = feedKindLabel(post.kind);
  const body = post.body?.trim() ?? '';
  const isLong = body.length > BODY_PREVIEW_CHARS;
  const canOpenProfile = Boolean(post.author.profileHref);

  const handleShare = () => {
    setShareError(null);
    void sharePost(post).then((outcome) => {
      if (!outcome.ok) setShareError(outcome.errorMessage);
    });
  };

  return (
    <Card
      padded={false}
      style={styles.card}
      testID={`feed-post-${post.id}`}
      onLayout={({ nativeEvent }: LayoutChangeEvent) => {
        // Only a card holding a video needs to publish a position; the rest would
        // re-render on every layout pass for no reader-visible reason.
        if (!post.media.some((item) => item.kind === 'video')) return;
        setTop(nativeEvent.layout.y);
      }}>
      <View style={styles.cardBody}>
        <PostHeader
          post={post}
          canOpenProfile={canOpenProfile}
          onOpenProfile={onOpenProfile}
          onOpenMenu={() => setMenuOpen(true)}
          menuOpen={menuOpen}
        />

        {badge ? <Badge tone="primary">{badge}</Badge> : null}

        {post.title ? (
          <AppText variant="h3" weight="semibold" style={styles.title}>
            {post.title}
          </AppText>
        ) : null}

        {body ? (
          <AppText
            variant="body"
            style={styles.bodyText}
            numberOfLines={isLong && !expanded ? BODY_PREVIEW_LINES : undefined}>
            {body}
          </AppText>
        ) : null}

        {isLong ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? 'Show less of this post' : 'Show the whole post'}
            hitSlop={8}
            onPress={() => setExpanded((value) => !value)}>
            <AppText variant="small" style={styles.seeMore}>
              {expanded ? 'Show less' : 'See more'}
            </AppText>
          </Pressable>
        ) : null}

        {post.tags.length > 0 ? (
          <View style={styles.tagsRow} accessibilityLabel="Tags">
            {post.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
          </View>
        ) : null}
      </View>

      {post.media.length > 0 ? (
        <View style={styles.mediaPad}>
          <PostMedia
            media={post.media}
            onOpen={setViewerIndex}
            postId={post.id}
            top={top}
          />
        </View>
      ) : null}

      <View style={styles.cardBody}>
        {post.project ? (
          <ProjectBlock
            project={post.project}
            isDemo={post.origin === 'demo'}
            onOpenLink={onOpenLink}
          />
        ) : null}

        {post.achievement ? (
          <AchievementBlock
            achievement={post.achievement}
            isDemo={post.origin === 'demo'}
            onOpenLink={onOpenLink}
          />
        ) : null}

        {shareError ? (
          <StatusBanner
            tone="warning"
            title="Sharing did not start"
            description={shareError}
            onRetry={handleShare}
          />
        ) : null}

        {engagement.problem ? (
          <StatusBanner
            tone="error"
            title="Couldn't update like"
            description={engagement.problem}
            onRetry={engagement.dismissProblem}
          />
        ) : null}

        {/* The count row sits above the buttons, which is where both Instagram and
            LinkedIn put it, and it only renders when the server has actually
            counted something. */}
        <EngagementSummary
          likeCount={engagement.likeCount}
          commentCount={engagement.commentCount}
          likedByMe={engagement.likedByMe}
          onOpenComments={() => setCommentsOpen(true)}
        />

        <PostActionBar
          liked={engagement.likedByMe}
          likeCount={engagement.likeCount}
          commentCount={engagement.commentCount}
          isUpdating={engagement.isUpdating}
          saved={saved}
          onLike={engagement.toggleLike}
          onComment={() => setCommentsOpen(true)}
          onSave={() => toggleSave(post.id)}
          onShare={handleShare}
        />

        {saved ? (
          <AppText variant="caption" style={styles.localNote}>
            {`Saved — ${LOCAL_ENGAGEMENT_NOTE}.`}
          </AppText>
        ) : null}
      </View>

      {post.media.length > 0 ? (
        <MediaViewer
          media={post.media}
          index={viewerIndex ?? 0}
          visible={viewerIndex !== null}
          onClose={() => setViewerIndex(null)}
          onIndexChange={setViewerIndex}
        />
      ) : null}

      <CommentsSheet post={post} visible={commentsOpen} onClose={() => setCommentsOpen(false)} />

      <PostOverflowMenu
        visible={menuOpen}
        isOwnPost={post.origin === 'profile'}
        saved={saved}
        onToggleSave={() => {
          toggleSave(post.id);
          setMenuOpen(false);
        }}
        onHide={() => {
          hidePost(post.id);
          setMenuOpen(false);
        }}
        onManageInProfile={() => {
          setMenuOpen(false);
          if (canOpenProfile) onOpenProfile();
        }}
        onClose={() => setMenuOpen(false)}
      />
    </Card>
  );
}
