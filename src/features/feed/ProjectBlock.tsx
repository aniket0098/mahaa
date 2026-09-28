/**
 * ProjectBlock — the structured project panel inside a project post.
 *
 * A requirement of the brief is that empty fields are never rendered: every row
 * below is conditional on the record actually carrying that value, so a project
 * with no role, no status, and no GitHub link shows none of those rows rather
 * than three blank labels.
 *
 * The links are the **only** way out of the card, and they are always a real URL
 * the record carries (`source_url`, `live_url`). There is no project-detail route
 * in the app, so nothing here pushes an internal navigation that does not exist.
 * On a demo post the link target is illustrative, and that is stated in words
 * beneath it.
 */

import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { spacing } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';
import { DEMO_EXTERNAL_LINK_NOTE } from '@/features/feed/demoFeedPosts';
import { DetailRow, LinkButton } from '@/features/feed/PostDetailRow';
import type { FeedPost } from '@/features/feed/feedModel';

export interface ProjectBlockProps {
  project: NonNullable<FeedPost['project']>;
  /** True for a development demo post, whose link targets do not exist. */
  isDemo: boolean;
  onOpenLink: (url: string) => void;
}

export function ProjectBlock({ project, isDemo, onOpenLink }: ProjectBlockProps) {
  const hasLinks = Boolean(project.sourceUrl ?? project.liveUrl);

  return (
    <View style={styles.detailBlock}>
      <AppText variant="body" weight="semibold" style={styles.detailHeading}>
        Project details
      </AppText>

      {project.category ? (
        <DetailRow label="CATEGORY" value={project.category} />
      ) : null}
      {project.status ? <DetailRow label="STATUS" value={project.status} /> : null}
      {project.team ? <DetailRow label="TEAM" value={project.team} /> : null}
      {project.role ? <DetailRow label="MY ROLE" value={project.role} /> : null}

      {project.technologies.length > 0 ? (
        <View style={{ gap: spacing.xs }}>
          <AppText variant="caption" tone="tertiary" style={styles.detailLabel}>
            TECHNOLOGIES
          </AppText>
          <View style={styles.techRow}>
            {project.technologies.map((technology) => (
              <Badge key={technology} tone="primary">
                {technology}
              </Badge>
            ))}
          </View>
        </View>
      ) : null}

      {hasLinks ? (
        <View style={{ gap: spacing.xs }}>
          <View style={styles.linksRow}>
            {project.sourceUrl ? (
              <LinkButton
                label="Source code"
                url={project.sourceUrl}
                icon={{ ios: 'chevron.left.forwardslash.chevron.right', android: 'code' }}
                onOpenLink={onOpenLink}
              />
            ) : null}
            {project.liveUrl ? (
              <LinkButton
                label="View live demo"
                url={project.liveUrl}
                icon={{ ios: 'arrow.up.right.square', android: 'open_in_new' }}
                onOpenLink={onOpenLink}
              />
            ) : null}
          </View>
          {isDemo ? (
            <AppText variant="caption" style={styles.linkNote}>
              {DEMO_EXTERNAL_LINK_NOTE}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}


