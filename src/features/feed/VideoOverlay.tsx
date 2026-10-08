/**
 * VideoOverlay — the Reels-style chrome layered over an immersive video post.
 *
 * The overlay is **pure presentation**: every state it draws (like, save,
 * connection, counts) arrives as a prop, so there is no fetch, no mutation, and
 * no invented number anywhere in this file. It renders inside the stage's 9:16
 * frame, absolutely, with `pointerEvents="box-none"` on its root — the layers
 * that must be tappable (author row, rail, caption) capture touches, and the
 * gaps fall through to the player's tap-to-toggle layer underneath. That is
 * what lets a tap on empty video pause it while a tap on the heart still likes.
 *
 * Layer order inside the stage:
 *
 *  1. the player (`PostVideo`, absolute-fill) — center tap toggles playback;
 *  2. this overlay: top/bottom `LinearGradient` scrims, author + Connect pill
 *     (top-left), the action rail (right), and the expandable caption
 *     (bottom-left);
 *  3. the stage's own top-right control cluster (more + mute), which lives in
 *     `PostVideo` because the mute button needs the player instance — this
 *     overlay reserves that corner (`overlayTopRow.right`) for it.
 *
 * Honest limits, stated where they render:
 *
 *  - The Connect pill appears only for a **real other person** — never for the
 *    reader's own posts or a demo author (the card passes `connection: null`).
 *  - Save stays device-local; the card prints the disclosure below the stage
 *    rather than this overlay implying a server bookmark.
 *  - Counts are the server's (`formatCount` of props), shown only above zero.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText, type TextTone } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';
import { DEMO_POST_BADGE } from '@/features/feed/demoFeedPosts';
import { formatCount, formatFeedTime, type FeedPost } from '@/features/feed/feedModel';
import type { AuthorConnection } from '@/features/connection/useAuthorConnection';

/** Lines the caption shows collapsed; the toggle reveals the rest. */
const CAPTION_COLLAPSED_LINES = 2;
/** Beyond this many characters the two collapsed lines are certainly hiding text. */
const CAPTION_PREVIEW_CHARS = 140;
/** A title longer than this is also treated as expandable content. */
const TITLE_PREVIEW_CHARS = 60;

export interface VideoOverlayProps {
  post: FeedPost;
  /** True when *this* viewer has liked the post (server state, via the card). */
  liked: boolean;
  /** Server-counted likes; printed only above zero. */
  likeCount: number;
  /** Server-counted comments; printed only above zero. */
  commentCount: number;
  /** True while a like request is in flight — the rail button drops out of service. */
  likeBusy: boolean;
  saved: boolean;
  /** True when the author has a route this app can really open. */
  canOpenProfile: boolean;
  /**
   * The card's connection state for this author, or null when connecting is not
   * offered at all (own post, demo author) — in which case no pill renders.
   */
  connection: AuthorConnection | null;
  /** How many *images* (video excluded) this post also carries; 0 hides the pill. */
  photoCount: number;
  onLike: () => void;
  onComment: () => void;
  onShare: () => void;
  onSave: () => void;
  onOpenProfile: () => void;
  /** Opens the image viewer at the first photo. */
  onOpenPhotos: () => void;
}

export function VideoOverlay({
  post,
  liked,
  likeCount,
  commentCount,
  likeBusy,
  saved,
  canOpenProfile,
  connection,
  photoCount,
  onLike,
  onComment,
  onShare,
  onSave,
  onOpenProfile,
  onOpenPhotos,
}: VideoOverlayProps) {
  const [expanded, setExpanded] = useState(false);
  const isDemo = post.origin === 'demo';
  const body = post.body?.trim() ?? '';

  /**
   * The identity meta line — `@handle · headline · 2h`, built from whatever the
   * author actually carries (same rule as `PostHeader`): a fixed template would
   * render "@ · · 2h" for a person with no handle and no headline.
   */
  const meta = [
    post.author.username ? `@${post.author.username}` : null,
    post.author.headline,
    formatFeedTime(post.createdAt),
  ]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');

  const canExpand =
    body.length > CAPTION_PREVIEW_CHARS || (post.title?.length ?? 0) > TITLE_PREVIEW_CHARS;

  /* ----------------------------- connect pill ------------------------------ */

  let pillLabel: string;
  let pillStyle;
  let pillTone: TextTone;
  let pillDisabled: boolean;
  let pillAccessibility: string;

  if (!connection || (connection.state === 'none' && !connection.isSending)) {
    pillLabel = 'Connect';
    pillStyle = styles.overlayPillConnect;
    pillTone = 'onPrimary';
    pillDisabled = false;
    pillAccessibility = `Send a connection request to ${post.author.name}`;
  } else if (connection.isSending) {
    pillLabel = 'Sending…';
    pillStyle = styles.overlayPillPending;
    pillTone = 'inverse';
    pillDisabled = true;
    pillAccessibility = 'Sending connection request';
  } else if (connection.state === 'pending') {
    pillLabel = 'Pending';
    pillStyle = styles.overlayPillPending;
    pillTone = 'inverse';
    pillDisabled = true;
    pillAccessibility = `Connection request pending with ${post.author.name}`;
  } else {
    pillLabel = 'Connected';
    pillStyle = styles.overlayPillDone;
    pillTone = 'success';
    pillDisabled = true;
    pillAccessibility = `Connected with ${post.author.name}`;
  }

  const identity = (
    <View style={styles.overlayAuthorText}>
      <View style={styles.overlayNameRow}>
        <AppText variant="body" weight="semibold" tone="inverse" numberOfLines={1}>
          {post.author.name}
        </AppText>
        {post.author.verified ? (
          <AppIcon
            name={{ ios: 'checkmark.seal.fill', android: 'verified' }}
            size={14}
            color={colors.colorTextOnPrimary}
          />
        ) : null}
        {isDemo ? <Badge tone="warning">{DEMO_POST_BADGE}</Badge> : null}
      </View>
      {meta ? (
        <AppText variant="caption" tone="inverse" numberOfLines={1}>
          {meta}
        </AppText>
      ) : null}
    </View>
  );

  return (
    <View style={styles.overlayFill} pointerEvents="box-none">
      {/* Scrims are touch-transparent: a tap here reaches the player's toggle. */}
      <LinearGradient
        colors={[colors.colorOverlay, 'transparent']}
        style={styles.overlayScrimTop}
        pointerEvents="none"
      />
      <LinearGradient
        colors={['transparent', colors.colorOverlay]}
        style={styles.overlayScrimBottom}
        pointerEvents="none"
      />

      {/* ---------------------------- author + connect ------------------------- */}
      <View style={styles.overlayTopRow}>
        {canOpenProfile ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`${post.author.name}, open profile`}
            onPress={onOpenProfile}
            style={styles.overlayAuthor}
            testID="feed-post-author">
            <Avatar name={post.author.name} src={post.author.avatarUrl} size={40} />
            {identity}
          </Pressable>
        ) : (
          <View style={styles.overlayAuthor}>
            <Avatar name={post.author.name} src={post.author.avatarUrl} size={40} />
            {identity}
          </View>
        )}

        {connection ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={pillAccessibility}
            accessibilityState={{
              disabled: pillDisabled,
              busy: pillDisabled && pillLabel === 'Sending…',
            }}
            disabled={pillDisabled}
            onPress={connection.send}
            style={[styles.overlayPill, pillStyle]}
            testID="feed-post-connect">
            <AppText variant="small" weight="semibold" tone={pillTone}>
              {pillLabel}
            </AppText>
          </Pressable>
        ) : null}
      </View>

      {/* ------------------------------- action rail --------------------------- */}
      <View style={styles.overlayRail}>
        <RailAction
          accessibilityLabel={liked ? 'Unlike this post' : 'Like this post'}
          icon={
            liked
              ? { ios: 'heart.fill', android: 'favorite' }
              : { ios: 'heart', android: 'favorite_border' }
          }
          active={liked}
          activeColor={colors.colorDanger}
          count={likeCount}
          busy={likeBusy}
          onPress={onLike}
          testID="feed-rail-like"
        />
        <RailAction
          accessibilityLabel={
            commentCount > 0
              ? `Comment on this post. ${formatCount(commentCount)} ${
                  commentCount === 1 ? 'comment' : 'comments'
                }`
              : 'Comment on this post'
          }
          icon={{ ios: 'bubble.left', android: 'chat_bubble_outline' }}
          active={false}
          count={commentCount}
          onPress={onComment}
          testID="feed-rail-comment"
        />
        <RailAction
          accessibilityLabel="Share this post"
          icon={{ ios: 'square.and.arrow.up', android: 'share' }}
          active={false}
          onPress={onShare}
          testID="feed-rail-share"
        />
        <RailAction
          accessibilityLabel={saved ? 'Remove this post from saved' : 'Save this post'}
          icon={
            saved
              ? { ios: 'bookmark.fill', android: 'bookmark' }
              : { ios: 'bookmark', android: 'bookmark_border' }
          }
          active={saved}
          activeColor={colors.colorTextOnPrimary}
          onPress={onSave}
          testID="feed-rail-save"
        />
      </View>

      {/* -------------------------------- caption ------------------------------- */}
      <View style={styles.overlayCaption}>
        {photoCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`View ${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`}
            onPress={onOpenPhotos}
            hitSlop={8}
            style={styles.photosPill}
            testID="feed-post-photos">
            <AppIcon
              name={{ ios: 'photo.on.rectangle', android: 'photo_library' }}
              size={16}
              color={colors.colorTextOnPrimary}
            />
            <AppText variant="caption" weight="medium" tone="inverse">
              {`${photoCount} ${photoCount === 1 ? 'photo' : 'photos'}`}
            </AppText>
          </Pressable>
        ) : null}

        {post.title ? (
          <AppText
            variant="small"
            weight="semibold"
            tone="inverse"
            numberOfLines={expanded ? undefined : 2}>
            {post.title}
          </AppText>
        ) : null}

        {body ? (
          <AppText
            variant="small"
            tone="inverse"
            numberOfLines={expanded ? undefined : CAPTION_COLLAPSED_LINES}>
            {body}
          </AppText>
        ) : null}

        {canExpand ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            accessibilityLabel={expanded ? 'Show less of this caption' : 'Show the whole caption'}
            hitSlop={8}
            onPress={() => setExpanded((value) => !value)}
            style={styles.overlayToggle}
            testID="feed-post-caption-toggle">
            <AppText variant="small" weight="semibold" tone="inverse">
              {expanded ? 'Less' : 'More'}
            </AppText>
          </Pressable>
        ) : null}

        {post.tags.length > 0 ? (
          <View style={styles.overlayTags} accessibilityLabel="Tags">
            {post.tags.map((tag) => (
              <AppText key={tag} variant="caption" weight="medium" tone="inverse">
                {`#${tag}`}
              </AppText>
            ))}
          </View>
        ) : null}

        {meta ? (
          <AppText variant="caption" tone="inverse" numberOfLines={1}>
            {meta}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

/** One rail entry: a 48×48 target, its glyph, and the server's count beneath. */
function RailAction({
  accessibilityLabel,
  icon,
  active,
  activeColor = colors.colorTextOnPrimary,
  count,
  busy = false,
  onPress,
  testID,
}: {
  accessibilityLabel: string;
  icon: { ios: string; android: string };
  /** True when this control is on (liked, saved) — fills the glyph. */
  active: boolean;
  /** Icon colour while active: a liked heart is danger, a saved bookmark stays white. */
  activeColor?: string;
  /** Server count; hidden entirely at zero rather than showing a bare dash. */
  count?: number;
  busy?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ selected: active, disabled: busy, busy }}
      disabled={busy}
      onPress={onPress}
      hitSlop={4}
      style={[styles.overlayRailAction, busy ? RAIL_BUSY : null]}
      testID={testID}>
      <AppIcon name={icon} size={30} color={active ? activeColor : colors.colorTextOnPrimary} />
      {count !== undefined && count > 0 ? (
        <AppText variant="caption" weight="medium" style={styles.overlayRailCount}>
          {formatCount(count)}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** A busy rail button dims rather than disappearing, so the rail never reflows. */
const RAIL_BUSY = { opacity: 0.5 };


