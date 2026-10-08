/**
 * FeedPostCard — one post in the Community Feed.
 *
 * Card order: author header → type badge and title → body → tags → media →
 * structured project/achievement panel → action row. Media sits between the text
 * and the detail panel so a reader sees what the post is about before the
 * metadata, and the padded blocks stay symmetrical above and below it.
 *
 * **A video post is a stage, not a band.** When the media carries a video, the
 * header block and the action row step aside: a 9:16 `videoStage` renders
 * `PostVideo` in its `immersive` variant with `VideoOverlay` layered on top,
 * and the overlay's author row, caption, and rail carry what those blocks carry
 * everywhere else. The stage's overflow button still opens this card's menu,
 * and everything *below* the media — panels, banners, the device-local save
 * disclosure, and the sheets — is shared by both shapes.
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

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { useAuthorConnection } from '@/features/connection/useAuthorConnection';
import { AchievementBlock } from '@/features/feed/AchievementBlock';
import { CommentsSheet } from '@/features/feed/CommentsSheet';
import { EngagementSummary } from '@/features/feed/EngagementSummary';
import { MediaViewer } from '@/features/feed/MediaViewer';
import { PostActionBar } from '@/features/feed/PostActionBar';
import { PostHeader } from '@/features/feed/PostHeader';
import { PostMedia } from '@/features/feed/PostMedia';
import { PostOverflowMenu } from '@/features/feed/PostOverflowMenu';
import { PostVideo } from '@/features/feed/PostVideo';
import { ProjectBlock } from '@/features/feed/ProjectBlock';
import { VideoOverlay } from '@/features/feed/VideoOverlay';
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
import { colors } from '@/theme/tokens';

export interface FeedPostCardProps {
  post: FeedPost;
  /**
   * The feed's origin within the scroll content, added to this card's own
   * list-relative offset so the playback coordinator's `contentOffset`-based
   * viewport compares like with like.
   */
  baseOffset?: number;
  /** Opens the author's profile. Only meaningful when the post carries a route. */
  onOpenProfile: () => void;
  /** Opens an outbound link in the system browser. */
  onOpenLink: (url: string) => void;
}

export function FeedPostCard({ post, baseOffset = 0, onOpenProfile, onOpenLink }: FeedPostCardProps) {
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
  // This card's own offset within the scroll content: the feed's origin (the
  // `baseOffset` prop) plus this card's list-relative position. The feed reports
  // its scroll offset; the difference of the two is what tells the playback
  // coordinator whether a video here is on screen.
  const [measuredY, setMeasuredY] = useState(0);
  // Where the media band sits inside this card. The coordinator's slot has to be
  // the *video's* rectangle: keying it on the card's top alone would start
  // playback when the header crosses half the screen and — worse — pause the
  // moment the video itself fills the screen, because by then the card's top is
  // long gone from the viewport.
  const [mediaY, setMediaY] = useState(0);
  // Height of the video stage, unknown until it lays out. The coordinator's
  // slot is keyed on the stage's own rectangle, so `PostVideo` re-registers
  // the moment this arrives.
  const [mediaH, setMediaH] = useState(0);
  const top = baseOffset + measuredY;
  const mediaTop = top + mediaY;

  const engagement = usePostEngagement(post);

  const saved = isSaved(post.id);
  const badge = feedKindLabel(post.kind);
  const body = post.body?.trim() ?? '';
  const isLong = body.length > BODY_PREVIEW_CHARS;
  const canOpenProfile = Boolean(post.author.profileHref);

  /**
   * The video this card stages, when the media carries one. Everything about
   * the immersive shape keys off it: the stage replaces the header block and
   * the action row, and only such a card can offer a Connect pill.
   */
  const videoItem = post.media.find((item) => item.kind === 'video') ?? null;
  /**
   * Whose public id a Connect pill may request — a real *other* person's.
   * Own posts carry a profile route, demo authors carry no public id, and a
   * card without a video has no pill; each passes null, which is also exactly
   * what keeps the hook's shared connections query disabled.
   */
  const connectTargetId =
    videoItem && !canOpenProfile && post.author.publicId ? post.author.publicId : null;
  const connection = useAuthorConnection(connectTargetId);
  /** Images this post also carries; the video itself lives on the stage. */
  const photos = post.media.filter((item) => item.kind === 'image');
  /**
   * What the full-screen viewer pages. For a video post that is the photos
   * alone: the video is already on the stage, and `expo-image` cannot decode
   * an `.mp4` — it would paint a broken frame where the video should be.
   */
  const viewerMedia = videoItem ? photos : post.media;
  /**
   * Whether the block below the media has anything to say. A video post whose
   * stage carries everything skips it rather than rendering an empty padded
   * strip that reads as a bug.
   */
  const showBelowStage =
    videoItem === null ||
    Boolean(
      post.project ||
        post.achievement ||
        shareError ||
        engagement.problem ||
        connection.error ||
        saved,
    );

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
        setMeasuredY(nativeEvent.layout.y);
      }}>
      {/* A video post's header lives in its overlay: the stage's author row,
          caption, and overflow button carry what this block carries elsewhere,
          and rendering both would say everything twice. */}
      {videoItem ? null : (
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
      )}

      {videoItem ? (
        // The stage measures *itself*, because the coordinator's slot must be
        // the video's rectangle: the 9:16 frame's own y and height are what
        // decide when autoplay starts and stops, not the card's text block.
        <View
          style={styles.videoStage}
          onLayout={({ nativeEvent }: LayoutChangeEvent) => {
            setMediaY(nativeEvent.layout.y);
            setMediaH(nativeEvent.layout.height);
          }}>
          <PostVideo
            uri={videoItem.uri}
            alt={videoItem.alt}
            height={mediaH}
            postId={post.id}
            top={mediaTop}
            variant="immersive"
            trailingControl={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Post options"
                onPress={() => setMenuOpen(true)}
                hitSlop={8}
                style={styles.stageControl}
                testID={`feed-post-menu-button-${post.id}`}>
                <AppIcon
                  name={{ ios: 'ellipsis', android: 'more_horiz' }}
                  size={20}
                  color={colors.colorTextOnPrimary}
                />
              </Pressable>
            }
          />
          <VideoOverlay
            post={post}
            liked={engagement.likedByMe}
            likeCount={engagement.likeCount}
            commentCount={engagement.commentCount}
            likeBusy={engagement.isUpdating}
            saved={saved}
            canOpenProfile={canOpenProfile}
            connection={connectTargetId === null ? null : connection}
            photoCount={photos.length}
            onLike={engagement.toggleLike}
            onComment={() => setCommentsOpen(true)}
            onShare={handleShare}
            onSave={() => toggleSave(post.id)}
            onOpenProfile={onOpenProfile}
            onOpenPhotos={() => setViewerIndex(0)}
          />
        </View>
      ) : post.media.length > 0 ? (
        <View
          style={styles.mediaPad}
          onLayout={({ nativeEvent }: LayoutChangeEvent) => {
            // Same guard as the card's own measurement: only a card holding a
            // video has a position the playback coordinator needs.
            if (!post.media.some((item) => item.kind === 'video')) return;
            setMediaY(nativeEvent.layout.y);
          }}>
          <PostMedia
            media={post.media}
            onOpen={setViewerIndex}
            postId={post.id}
            top={mediaTop}
          />
        </View>
      ) : null}

      {showBelowStage ? (
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

          {/* The Connect pill's failure lands here too: a toast would vanish
              while the reader is still watching the video it belongs to. */}
          {connection.error ? (
            <StatusBanner
              tone="error"
              title="Couldn't send connection request"
              description={connection.error}
              onRetry={connection.dismissError}
            />
          ) : null}

          {/* A stage card acts from the overlay's rail, so the count row and
              action bar below it would be a second copy of the same controls. */}
          {videoItem ? null : (
            <>
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
            </>
          )}

          {saved ? (
            <AppText variant="caption" style={styles.localNote}>
              {`Saved — ${LOCAL_ENGAGEMENT_NOTE}.`}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {viewerMedia.length > 0 ? (
        <MediaViewer
          media={viewerMedia}
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
