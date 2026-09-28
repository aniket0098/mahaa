/**
 * PostHeader — author block, timestamp, demo chip, and the overflow trigger.
 *
 * The author's name is tappable **only** when the post carries a real profile
 * route. A profile record's author is the authenticated candidate, so the name
 * opens `/profile`. A demo author has no profile screen to open — the app has no
 * other-user profile route — so their name is plain text rather than a link that
 * would land on an unmatched route.
 *
 * The verification badge is rendered from `author.verified` and nothing in the
 * product can set that to true: no verification service exists. It is kept as a
 * single read site so that when a real signal arrives it appears everywhere at
 * once, instead of being sprinkled as decoration today.
 */

import { Pressable, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';
import { DEMO_POST_BADGE } from '@/features/feed/demoFeedPosts';
import { formatFeedTime, type FeedPost } from '@/features/feed/feedModel';

export interface PostHeaderProps {
  post: FeedPost;
  /** True when the author has a route this app can really open. */
  canOpenProfile: boolean;
  onOpenProfile: () => void;
  onOpenMenu: () => void;
  menuOpen: boolean;
}

export function PostHeader({
  post,
  canOpenProfile,
  onOpenProfile,
  onOpenMenu,
  menuOpen,
}: PostHeaderProps) {
  const isDemo = post.origin === 'demo';
  // Headline and time share one line, and either may be absent, so the separator
  // is only added when both parts exist.
  const meta = [post.author.headline, formatFeedTime(post.createdAt)]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(' · ');

  return (
    <View style={styles.header}>
      <View style={styles.authorBlock}>
        <Avatar name={post.author.name} src={post.author.avatarUrl} size={40} />

        <View style={styles.authorText}>
          <View style={styles.authorName}>
            <AppText
              variant="body"
              weight="semibold"
              accessibilityRole={canOpenProfile ? 'link' : undefined}
              accessibilityLabel={
                canOpenProfile ? `${post.author.name}, open profile` : post.author.name
              }
              onPress={canOpenProfile ? onOpenProfile : undefined}
              style={canOpenProfile ? styles.linkLabel : undefined}
              numberOfLines={1}>
              {post.author.name}
            </AppText>

            {post.author.verified ? (
              <AppIcon
                name={{ ios: 'checkmark.seal.fill', android: 'verified' }}
                size={14}
                color={colors.colorPrimary}
              />
            ) : null}

            {isDemo ? <Badge tone="warning">{DEMO_POST_BADGE}</Badge> : null}
          </View>

          {meta ? (
            <AppText variant="small" tone="secondary" numberOfLines={2}>
              {meta}
            </AppText>
          ) : null}
        </View>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Post options"
        accessibilityState={{ expanded: menuOpen }}
        onPress={onOpenMenu}
        hitSlop={8}
        style={styles.menuButton}
        testID={`feed-post-menu-button-${post.id}`}>
        <AppIcon
          name={{ ios: 'ellipsis', android: 'more_horiz' }}
          size={20}
          color={colors.colorTextSecondary}
        />
      </Pressable>
    </View>
  );
}
