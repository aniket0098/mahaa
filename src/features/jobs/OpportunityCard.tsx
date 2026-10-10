/**
 * OpportunityCard — one posting in the Discover list.
 *
 * Every field shown comes straight from the API's `OpportunityOut`; nothing is
 * invented, and every optional field is rendered only when the server sent it.
 * There is deliberately **no Save, Apply, match-score, applicant-count or
 * rating** control: those belong to domains the backend does not serve in V1
 * (`is_saved`/`my_application_id` are omitted from responses), so a card that
 * showed them would be asserting something the server cannot back.
 *
 * Hierarchy, top to bottom — the order the eye scans a job card (Wellfound's
 * salary-forward, LinkedIn's title-first):
 *   1. company logo → title → company name (+ Verified when real);
 *   2. type / work-mode / employment badges (at most three);
 *   3. metadata at 13px — location, then compensation as the one emphasised
 *      fact, then the deadline in an urgency tone (neutral / closing-soon amber
 *      / past red);
 *   4. a caption timestamp — the only 12px text on the card.
 *
 * The whole card is one tappable target that opens `/jobs/{id}`; there are no
 * nested controls that could fire the wrong action. Press feedback is a brief
 * spring scale plus a dim, both skipped when the OS "reduce motion" preference
 * is on — polish that never costs accessibility.
 */

import { useCallback, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { useReduceMotion } from '@/features/feed/useReduceMotion';
import type { Opportunity } from '@/types/opportunity';
import { colors } from '@/theme/tokens';

import {
  EMPLOYMENT_TYPE_LABELS,
  OPPORTUNITY_TYPE_LABELS,
  WORK_MODE_LABELS,
  companyIsVerified,
  formatCompensation,
  formatDeadline,
  formatRelativePublishedAt,
} from './discoverFilters';
import { styles } from './discoverStyles';

export interface OpportunityCardProps {
  opportunity: Opportunity;
}

/** The tone a metadata item paints its icon and label in. */
type MetaTone = 'primary' | 'warning' | 'danger' | undefined;

const META_TONE_COLOR: Record<'primary' | 'warning' | 'danger', string> = {
  primary: colors.colorPrimary,
  warning: colors.colorWarning,
  danger: colors.colorDanger,
};

export function OpportunityCard({ opportunity }: OpportunityCardProps) {
  const router = useRouter();
  const company = opportunity.company;

  const compensation = formatCompensation(
    opportunity.comp_min,
    opportunity.comp_max,
    opportunity.comp_currency,
    opportunity.comp_period,
  );
  const deadline = formatDeadline(opportunity.deadline);
  const posted = formatRelativePublishedAt(opportunity.published_at);
  const verified = companyIsVerified(company?.verification_status);
  const companyName = company?.name ?? 'Company';

  const [scale] = useState(() => new Animated.Value(1));
  const reduceMotion = useReduceMotion();
  const animate = useCallback(
    (toValue: number) => {
      if (reduceMotion) return;
      Animated.spring(scale, { toValue, useNativeDriver: true }).start();
    },
    [reduceMotion, scale],
  );

  const deadlineTone: MetaTone = deadline
    ? deadline.urgency === 'past'
      ? 'danger'
      : deadline.urgency === 'soon'
        ? 'warning'
        : undefined
    : undefined;

  return (
    <Pressable
      onPress={() => router.push(`/jobs/${opportunity.id}` as never)}
      onPressIn={() => animate(0.98)}
      onPressOut={() => animate(1)}
      accessibilityRole="button"
      accessibilityLabel={`${opportunity.title} at ${companyName}`}
      accessibilityHint="Opens the opportunity details"
      testID={`opportunity-card-${opportunity.id}`}
      style={({ pressed }) => (pressed ? { opacity: 0.92 } : null)}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <Avatar name={companyName} src={company?.logo_url ?? null} size={40} shape="rounded" />
            <View style={styles.cardHeaderText}>
              <AppText variant="h3" weight="semibold" numberOfLines={2}>
                {opportunity.title}
              </AppText>
              <View style={styles.companyRow}>
                <AppText variant="small" tone="secondary" numberOfLines={1}>
                  {companyName}
                </AppText>
                {verified ? <Badge tone="success">Verified</Badge> : null}
              </View>
            </View>
          </View>

          <View style={styles.badgeRow}>
            <Badge tone="primary">{OPPORTUNITY_TYPE_LABELS[opportunity.opportunity_type]}</Badge>
            {opportunity.work_mode ? <Badge>{WORK_MODE_LABELS[opportunity.work_mode]}</Badge> : null}
            {opportunity.employment_type ? (
              <Badge>{EMPLOYMENT_TYPE_LABELS[opportunity.employment_type]}</Badge>
            ) : null}
          </View>

          <View style={styles.metaRow}>
            {opportunity.location ? (
              <MetaItem
                icon={{ ios: 'location.fill', android: 'place' }}
                text={opportunity.location}
              />
            ) : null}
            {compensation ? (
              <MetaItem
                icon={{ ios: 'banknote', android: 'payments' }}
                text={compensation}
                tone="primary"
                emphasized
              />
            ) : null}
            {deadline ? (
              <MetaItem
                icon={{ ios: 'calendar', android: 'event' }}
                text={deadline.label}
                tone={deadlineTone}
              />
            ) : null}
          </View>

          {posted ? (
            <AppText variant="caption" tone="tertiary">
              {posted}
            </AppText>
          ) : null}
        </Card>
      </Animated.View>
    </Pressable>
  );
}

function MetaItem({
  icon,
  text,
  tone,
  emphasized = false,
}: {
  icon: { ios: string; android: string };
  text: string;
  tone?: MetaTone;
  /** The one fact the card leads with (compensation) — semibold, primary. */
  emphasized?: boolean;
}) {
  const iconColor = tone ? META_TONE_COLOR[tone] : colors.colorTextTertiary;
  const textTone =
    tone === 'warning' ? 'warning' : tone === 'danger' ? 'danger' : emphasized ? 'primary' : 'tertiary';
  return (
    <View style={styles.metaItem}>
      <AppIcon name={icon} size={14} color={iconColor} />
      <AppText variant="small" weight={emphasized ? 'semibold' : 'regular'} tone={textTone} numberOfLines={1}>
        {text}
      </AppText>
    </View>
  );
}
