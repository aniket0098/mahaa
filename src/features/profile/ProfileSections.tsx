/**
 * Profile sections — the shared presentational pieces the profile page is
 * assembled from.
 *
 * Each section follows the same contract: a heading with an Edit/Add control
 * **only** when a real destination exists, real content when the candidate has
 * any, and an honest empty card when they do not. No section renders a sample
 * entry, and none renders a control that cannot complete.
 */

import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ABOUT_COLLAPSED_LINES, journeyChips, needsSeeMore } from '@/features/profile/profileModel';
import { styles } from '@/features/profile/profileStyles';
import type { CandidateSkillRead } from '@/types/profile';

/* -------------------------------------------------------------------------- */
/* Shell                                                                       */
/* -------------------------------------------------------------------------- */

export interface SectionCardProps {
  title: string;
  description?: string | null;
  /** Edit/Add control. Omit it entirely when the action cannot be supported. */
  action?: ReactNode;
  testID?: string;
  children: ReactNode;
}

export function SectionCard({ title, description, action, testID, children }: SectionCardProps) {
  return (
    <Card testID={testID} style={styles.card}>
      <SectionHeader title={title} description={description} action={action} />
      {children}
    </Card>
  );
}

/** The empty state every section shares: say what is missing, then offer the fix. */
export function SectionEmpty({
  message,
  actionLabel,
  onAction,
}: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <View style={styles.empty}>
      <AppText variant="small" tone="secondary">
        {message}
      </AppText>
      {actionLabel && onAction ? (
        <View>
          <Button label={actionLabel} variant="secondary" onPress={onAction} />
        </View>
      ) : null}
    </View>
  );
}

/** Wrapped rounded chips. `items` is already de-duplicated by `journeyChips`. */
export function ChipList({ items, label }: { items: readonly string[]; label: string }) {
  return (
    <View style={styles.chipRow} accessibilityLabel={label}>
      {items.map((item) => (
        <View key={item} style={styles.chip}>
          <AppText style={styles.chipLabel}>{item}</AppText>
        </View>
      ))}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* About                                                                       */
/* -------------------------------------------------------------------------- */

export function AboutSection({ summary, onEdit }: { summary: string | null; onEdit: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const text = (summary ?? '').trim();
  const collapsible = needsSeeMore(text);

  return (
    <SectionCard
      title="About"
      action={<Button label="Edit" variant="ghost" onPress={onEdit} />}
      testID="profile-about">
      {text ? (
        <View style={styles.empty}>
          <AppText
            variant="body"
            tone="secondary"
            numberOfLines={collapsible && !expanded ? ABOUT_COLLAPSED_LINES : undefined}>
            {text}
          </AppText>
          {collapsible ? (
            <View>
              <Button
                label={expanded ? 'Show less' : 'See more'}
                variant="ghost"
                onPress={() => setExpanded((value) => !value)}
              />
            </View>
          ) : null}
        </View>
      ) : (
        <SectionEmpty
          message="No introduction yet. Two sentences on what you are working towards helps a recruiter place you."
          actionLabel="Add an introduction"
          onAction={onEdit}
        />
      )}
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* My Journey                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One combined journey section. The backend stores a single `interests` list and
 * has no hobbies field, so career interests and personal interests are the same
 * chips here rather than two sections pretending to read from two sources.
 */
export function JourneySection({
  interests,
  onEdit,
}: {
  interests: readonly string[];
  onEdit: () => void;
}) {
  const chips = journeyChips(interests);

  return (
    <SectionCard
      title="My Journey"
      description="Interests and the direction you are building towards"
      action={<Button label="Edit" variant="ghost" onPress={onEdit} />}
      testID="profile-journey">
      {chips.length > 0 ? (
        <ChipList items={chips} label="Your interests" />
      ) : (
        <SectionEmpty
          message="No interests saved yet. Add the fields you want a recruiter to associate you with."
          actionLabel="Add interests"
          onAction={onEdit}
        />
      )}
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Skills                                                                      */
/* -------------------------------------------------------------------------- */

export function SkillsSection({
  skills,
  onEdit,
}: {
  skills: readonly CandidateSkillRead[];
  onEdit: () => void;
}) {
  // Level and years are shown as plain text — there is no proficiency model on
  // the server, so no bar, star, or percentage is drawn for one.
  const names = skills.map((skill) =>
    skill.years != null ? `${skill.name} · ${skill.years} yr` : skill.name,
  );

  return (
    <SectionCard
      title="Skills"
      description={skills.length > 0 ? `${skills.length} on file` : null}
      action={<Button label="Add" variant="ghost" onPress={onEdit} />}
      testID="profile-skills">
      {names.length > 0 ? (
        <ChipList items={names} label="Your skills" />
      ) : (
        <SectionEmpty
          message="No skills yet. Pick them from the catalogue so they match what employers search for."
          actionLabel="Add skills"
          onAction={onEdit}
        />
      )}
    </SectionCard>
  );
}

