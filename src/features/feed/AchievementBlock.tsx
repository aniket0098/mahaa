/**
 * AchievementBlock — the structured panel for a certificate or achievement.
 *
 * Two rules from the brief are enforced strictly here:
 *
 *  - **No empty fields.** Issuer, date, and description each render only when
 *    the record carries them.
 *  - **Nothing is called "verified" unless real data says so.** A "Verify
 *    credential" link appears only for a real `verification_url`, and there is
 *    deliberately **no** verification badge anywhere in this component: no
 *    verification service exists in the product, so a badge would be decoration
 *    that asserts a fact.
 */

import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { spacing } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';
import { DEMO_EXTERNAL_LINK_NOTE } from '@/features/feed/demoFeedPosts';
import { DetailRow, LinkButton } from '@/features/feed/PostDetailRow';
import { formatRecordDate, type FeedPost } from '@/features/feed/feedModel';

export interface AchievementBlockProps {
  achievement: NonNullable<FeedPost['achievement']>;
  /** True for a development demo post, whose link targets do not exist. */
  isDemo: boolean;
  onOpenLink: (url: string) => void;
}

export function AchievementBlock({ achievement, isDemo, onOpenLink }: AchievementBlockProps) {
  const achievedOn = formatRecordDate(achievement.achievedOn);

  return (
    <View style={styles.detailBlock}>
      <AppText variant="body" weight="semibold" style={styles.detailHeading}>
        Achievement details
      </AppText>

      {achievement.issuer ? <DetailRow label="ISSUED BY" value={achievement.issuer} /> : null}
      {achievedOn ? <DetailRow label="DATE" value={achievedOn} /> : null}

      {achievement.description ? (
        <AppText variant="small" style={styles.detailValue}>
          {achievement.description}
        </AppText>
      ) : null}

      {achievement.verificationUrl ? (
        <View style={{ gap: spacing.xs }}>
          <LinkButton
            label="Verify credential"
            url={achievement.verificationUrl}
            icon={{ ios: 'checkmark.seal', android: 'verified' }}
            onOpenLink={onOpenLink}
          />
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
