/**
 * Feed post card — the media-first card shape.
 *
 * Native reproduction of `FeedPostCard.tsx` + `feed.module.css`.
 *
 * Order is fixed by the original: author header, type badge, title, record meta,
 * body text with a read-more toggle, then a footer with tags, real project
 * links, and the disabled engagement bar. (The media band sits between the top
 * and bottom blocks on the web; the profile aggregate exposes no images or
 * videos, so it is never rendered — see `dashboardModel.ts`.)
 *
 * Nothing is fabricated: the card shows only fields the record really carries,
 * and there are no engagement counts because no engagement API exists.
 */

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { colors } from '@/theme/tokens';
import { FeedActionBar } from '@/features/home/FeedActionBar';
import { formatFeedTime, feedPostLabel, type FeedPost } from '@/features/home/dashboardModel';
import { styles } from '@/features/home/homeStyles';

/** Posts longer than this get a Read more toggle. */
const LONG_POST_LENGTH = 260;
/** How many lines the collapsed body shows (`.clamped` uses `-webkit-line-clamp: 4`). */
const CLAMPED_LINES = 4;

export interface FeedPostCardProps {
  post: FeedPost;
  onOpenProfile?: () => void;
  onOpenLink?: (url: string) => void;
}

export function FeedPostCard({ post, onOpenProfile, onOpenLink }: FeedPostCardProps) {
  const [expanded, setExpanded] = useState(false);
  const description = post.description?.trim() ?? '';
  const isLong = description.length > LONG_POST_LENGTH;
  const meta = [post.author.headline, formatFeedTime(post.createdAt)]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card style={styles.card} testID={`feed-post-${post.id}`}>
      <View style={styles.cardTop}>
        <View style={styles.cardHeader}>
          <View style={styles.author}>
            <Avatar name={post.author.name} src={post.author.avatarUrl} size={40} />
            <View style={styles.authorText}>
              <AppText
                variant="body"
                weight="semibold"
                accessibilityRole={post.author.profileHref && onOpenProfile ? 'link' : undefined}
                onPress={onOpenProfile}
                style={post.author.profileHref && onOpenProfile ? styles.expand : undefined}>
                {post.author.name}
              </AppText>
              {meta ? (
                <AppText variant="small" tone="secondary">
                  {meta}
                </AppText>
              ) : null}
            </View>
          </View>

          {post.author.profileHref ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Manage ${post.title} in your profile`}
              hitSlop={8}
              onPress={onOpenProfile}
              style={styles.manage}>
              <AppIcon
                name={{ ios: 'ellipsis', android: 'more_horiz' }}
                size={18}
                color={colors.colorTextTertiary}
              />
            </Pressable>
          ) : null}
        </View>

        <View style={styles.cardBody}>
          <Badge tone="primary">{feedPostLabel(post.kind)}</Badge>
          <AppText variant="h3" weight="semibold" style={styles.cardTitle}>
            {post.title}
          </AppText>
          {post.context ? (
            <AppText variant="small" tone="tertiary" style={styles.recordMeta}>
              {post.context}
            </AppText>
          ) : null}
          {description ? (
            <AppText
              variant="body"
              tone="secondary"
              style={styles.cardText}
              numberOfLines={isLong && !expanded ? CLAMPED_LINES : undefined}>
              {description}
            </AppText>
          ) : null}
          {isLong ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              hitSlop={8}
              onPress={() => setExpanded((value) => !value)}>
              <AppText variant="small" weight="medium" tone="accent" style={styles.expand}>
                {expanded ? 'Show less' : 'Read more'}
              </AppText>
            </Pressable>
          ) : null}
        </View>
      </View>

      <View style={styles.cardBottom}>
        {post.tags.length > 0 ? (
          <View style={styles.tags} accessibilityLabel="Skills">
            {post.tags.map((tag) => (
              <Badge key={tag} tone="neutral">
                {tag}
              </Badge>
            ))}
          </View>
        ) : null}

        {post.links.length > 0 && onOpenLink ? (
          <View style={styles.links}>
            {post.links.map((link) => (
              <Pressable
                key={link.url}
                accessibilityRole="link"
                accessibilityLabel={link.label}
                onPress={() => onOpenLink(link.url)}
                style={styles.link}>
                <AppText variant="small" weight="medium" tone="accent">
                  {link.label}
                </AppText>
                <AppIcon
                  name={{ ios: 'arrow.up.right.square', android: 'open_in_new' }}
                  size={16}
                  color={colors.colorPrimary}
                />
              </Pressable>
            ))}
          </View>
        ) : null}

        <FeedActionBar />
      </View>
    </Card>
  );
}
