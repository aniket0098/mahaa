/**
 * OpportunityDetailContent — the body of one opportunity's detail route.
 *
 * Renders only what `GET /opportunities/{id}` returned: every nullable field is
 * shown when present and skipped when not, so a sparse posting reads as sparse
 * rather than padded with invented content. `requirements[]` is grouped by its
 * real `kind` (required / preferred); `requirements_text` is the fallback the
 * API also carries.
 *
 * There is no Apply or Save button. Applying and saved postings are [F] in V1
 * (`/applications` and `/saved` are still StageScreens), so the screen says so
 * honestly with an info banner instead of shipping a control that goes nowhere.
 */

import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { AppIcon } from '@/components/ui/AppIcon';
import { Avatar } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { StatusBanner } from '@/components/ui/StatusBanner';
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

export interface OpportunityDetailContentProps {
  opportunity: Opportunity;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatLocalDate(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day] = match;
  return `${day} ${MONTHS[Number(month) - 1]} ${year}`;
}

export function OpportunityDetailContent({ opportunity }: OpportunityDetailContentProps) {
  const company = opportunity.company;
  const companyName = company?.name ?? 'Company';
  const verified = companyIsVerified(company?.verification_status);

  const compensation = formatCompensation(
    opportunity.comp_min,
    opportunity.comp_max,
    opportunity.comp_currency,
    opportunity.comp_period,
  );
  const deadline = formatDeadline(opportunity.deadline);
  const posted = formatRelativePublishedAt(opportunity.published_at);
  const startDate = formatLocalDate(opportunity.start_date);

  const required = opportunity.requirements.filter((requirement) => requirement.kind === 'required');
  const preferred = opportunity.requirements.filter((requirement) => requirement.kind === 'preferred');

  return (
    <View style={styles.detail}>
      <View style={styles.detailHeader}>
        <Avatar name={companyName} src={company?.logo_url ?? null} size={56} shape="rounded" />
        <View style={styles.detailHeaderText}>
          <AppText variant="h1" weight="bold" numberOfLines={3}>
            {opportunity.title}
          </AppText>
          <View style={styles.companyRow}>
            <AppText variant="body" tone="secondary" numberOfLines={1}>
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

      <Card>
        <View>
          {opportunity.location ? (
            <FactRow icon={{ ios: 'location.fill', android: 'place' }} label="Location" value={opportunity.location} />
          ) : null}
          {opportunity.work_mode ? (
            <FactRow icon={{ ios: 'building.2', android: 'work' }} label="Work mode" value={WORK_MODE_LABELS[opportunity.work_mode]} />
          ) : null}
          {opportunity.employment_type ? (
            <FactRow icon={{ ios: 'clock', android: 'schedule' }} label="Type" value={EMPLOYMENT_TYPE_LABELS[opportunity.employment_type]} />
          ) : null}
          {compensation ? (
            <FactRow
              icon={{ ios: 'banknote', android: 'payments' }}
              label="Compensation"
              value={compensation}
              emphasized
            />
          ) : null}
          {opportunity.openings != null ? (
            <FactRow icon={{ ios: 'person.2', android: 'group' }} label="Openings" value={String(opportunity.openings)} />
          ) : null}
          {startDate ? (
            <FactRow icon={{ ios: 'calendar', android: 'event_available' }} label="Start date" value={startDate} />
          ) : null}
          {deadline ? (
            <FactRow
              icon={{ ios: 'hourglass', android: 'timer' }}
              label="Deadline"
              value={deadline.label.replace('Apply by ', '')}
              danger={deadline.isPast}
              warning={!deadline.isPast && deadline.urgency === 'soon'}
            />
          ) : null}
          {posted ? (
            <FactRow icon={{ ios: 'sparkles', android: 'new_releases' }} label="Posted" value={posted} />
          ) : null}
        </View>
      </Card>
      {/* DETAIL_SECTIONS */}

      {opportunity.description ? (
        <Card>
          <View style={styles.sectionCard}>
            <SectionHeader title="About this role" />
            <AppText variant="body" style={styles.bodyText}>
              {opportunity.description}
            </AppText>
          </View>
        </Card>
      ) : null}

      {opportunity.responsibilities ? (
        <Card>
          <View style={styles.sectionCard}>
            <SectionHeader title="What you'll do" />
            <AppText variant="body" style={styles.bodyText}>
              {opportunity.responsibilities}
            </AppText>
          </View>
        </Card>
      ) : null}

      {required.length > 0 ? (
        <Card>
          <View style={styles.sectionCard}>
            <SectionHeader title="Required skills" />
            {required.map((requirement) => (
              <View key={requirement.id} style={styles.reqRow}>
                <AppText variant="body" weight="medium">
                  {requirement.skill_name}
                </AppText>
                {requirement.min_level ? (
                  <AppText variant="caption" tone="tertiary">
                    {requirement.min_level}
                  </AppText>
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {preferred.length > 0 ? (
        <Card>
          <View style={styles.sectionCard}>
            <SectionHeader title="Preferred skills" />
            {preferred.map((requirement) => (
              <View key={requirement.id} style={styles.reqRow}>
                <AppText variant="body" weight="medium">
                  {requirement.skill_name}
                </AppText>
                {requirement.min_level ? (
                  <AppText variant="caption" tone="tertiary">
                    {requirement.min_level}
                  </AppText>
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ) : null}

      {opportunity.requirements_text ? (
        <Card>
          <View style={styles.sectionCard}>
            <SectionHeader title="Other requirements" />
            <AppText variant="body" style={styles.bodyText}>
              {opportunity.requirements_text}
            </AppText>
          </View>
        </Card>
      ) : null}

      <StatusBanner
        tone="info"
        title="Applying and saving are not available yet"
        description="This opportunity is read-only for now. The backend does not support applications or saved postings in this version."
      />
    </View>
  );
}

function FactRow({
  icon,
  label,
  value,
  danger,
  warning,
  emphasized,
}: {
  icon: { ios: string; android: string };
  label: string;
  value: string;
  danger?: boolean;
  warning?: boolean;
  /** The one fact the detail leads with (compensation) — semibold. */
  emphasized?: boolean;
}) {
  const iconColor = danger ? colors.colorDanger : warning ? colors.colorWarning : colors.colorTextTertiary;
  const valueTone = danger ? 'danger' : warning ? 'warning' : 'primary';
  return (
    <View style={styles.factRow}>
      <AppIcon name={icon} size={16} color={iconColor} />
      <AppText variant="small" tone="secondary" style={styles.factText}>
        {label}
      </AppText>
      <AppText variant="small" weight={emphasized ? 'semibold' : 'medium'} tone={valueTone}>
        {value}
      </AppText>
    </View>
  );
}
