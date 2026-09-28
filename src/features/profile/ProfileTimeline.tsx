/**
 * Timeline sections — Education, Experience, and the Project portfolio.
 *
 * All three read the arrays already on the `GET /profile` aggregate and push to
 * their existing editor screen. Long descriptions collapse behind a "See more"
 * control instead of being silently cut mid-sentence, and an entry with no dates
 * simply omits the date line rather than printing `— – —`.
 */

import { useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { AppIcon } from '@/components/ui/AppIcon';
import { dateRange } from '@/features/profile/profileModel';
import { ChipList, SectionCard, SectionEmpty } from '@/features/profile/ProfileSections';
import { styles } from '@/features/profile/profileStyles';
import type { EducationRead, ExperienceRead, ProjectRead } from '@/types/profile';

/* -------------------------------------------------------------------------- */
/* Shared                                                                      */
/* -------------------------------------------------------------------------- */

/** Body copy that collapses past a line budget and offers a real control back. */
function ExpandableText({ text, lines = 3 }: { text: string | null; lines?: number }) {
  const [expanded, setExpanded] = useState(false);
  const value = (text ?? '').trim();
  if (!value) return null;

  return (
    <View style={styles.empty}>
      <AppText variant="caption" tone="secondary" numberOfLines={expanded ? undefined : lines}>
        {value}
      </AppText>
      {value.length > 120 ? (
        <View>
          <Button
            label={expanded ? 'Show less' : 'See more'}
            variant="ghost"
            onPress={() => setExpanded((value2) => !value2)}
          />
        </View>
      ) : null}
    </View>
  );
}

function EditAction({ onPress, label = 'Edit' }: { onPress: () => void; label?: string }) {
  return <Button label={label} variant="ghost" onPress={onPress} />;
}

/* -------------------------------------------------------------------------- */
/* Education                                                                   */
/* -------------------------------------------------------------------------- */

export function EducationSection({
  education,
  onEdit,
}: {
  education: readonly EducationRead[];
  onEdit: () => void;
}) {
  return (
    <SectionCard
      title="Education"
      description={education.length > 0 ? `${education.length} on file` : null}
      action={<EditAction label="Add" onPress={onEdit} />}
      testID="profile-education">
      {education.length === 0 ? (
        <SectionEmpty
          message="No education added yet. Institution and course are enough to start."
          actionLabel="Add education"
          onAction={onEdit}
        />
      ) : (
        education.map((item, index) => {
          const course = [item.degree, item.field_of_study].filter(Boolean).join(' · ');
          const range = dateRange(item.start_date, item.end_date, item.current);
          return (
            <View
              key={item.id}
              style={[styles.entry, index === 0 ? styles.entryFirst : null]}>
              <AppText style={styles.entryTitle}>{item.institution}</AppText>
              {course ? <AppText style={styles.entryMeta}>{course}</AppText> : null}
              {range ? <AppText style={styles.entryMuted}>{range}</AppText> : null}
              {item.grade ? (
                <AppText style={styles.entryMuted}>Grade {item.grade}</AppText>
              ) : null}
              <ExpandableText text={item.description} />
            </View>
          );
        })
      )}
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Experience                                                                  */
/* -------------------------------------------------------------------------- */

export function ExperienceSection({
  experience,
  onEdit,
}: {
  experience: readonly ExperienceRead[];
  onEdit: () => void;
}) {
  return (
    <SectionCard
      title="Experience"
      description={experience.length > 0 ? `${experience.length} on file` : null}
      action={<EditAction label="Add" onPress={onEdit} />}
      testID="profile-experience">
      {experience.length === 0 ? (
        <SectionEmpty
          message="No experience recorded yet. Internships, volunteering, and campus roles all count."
          actionLabel="Add experience"
          onAction={onEdit}
        />
      ) : (
        experience.map((item, index) => {
          const range = dateRange(item.start_date, item.end_date, item.current);
          const meta = [item.company_name, item.work_mode, item.location]
            .filter(Boolean)
            .join(' · ');
          return (
            <View
              key={item.id}
              style={[styles.entry, index === 0 ? styles.entryFirst : null]}>
              <AppText style={styles.entryTitle}>{item.title}</AppText>
              {meta ? <AppText style={styles.entryMeta}>{meta}</AppText> : null}
              {range ? <AppText style={styles.entryMuted}>{range}</AppText> : null}
              <ExpandableText text={item.description} />
            </View>
          );
        })
      )}
    </SectionCard>
  );
}

/* -------------------------------------------------------------------------- */
/* Projects                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Two-column portfolio grid. `ProjectRead` carries no cover image — the API has
 * no media field on a project — so the tile is an icon, never a stock photo.
 * Links open in the system browser, exactly as the feed does.
 */
export function ProjectsSection({
  projects,
  onEdit,
  onOpenLink,
}: {
  projects: readonly ProjectRead[];
  onEdit: () => void;
  onOpenLink: (url: string) => void;
}) {
  return (
    <SectionCard
      title="Projects"
      description={projects.length > 0 ? `${projects.length} on file` : null}
      action={<EditAction label="Add" onPress={onEdit} />}
      testID="profile-projects">
      {projects.length === 0 ? (
        <SectionEmpty
          message="No projects yet. Anything you have built counts, coursework included."
          actionLabel="Add a project"
          onAction={onEdit}
        />
      ) : (
        <View style={styles.projectGrid}>
          {projects.map((project) => {
            const tags = project.skills.map((skill) => skill.name);
            const links = [
              { label: 'Live', url: project.live_url },
              { label: 'Code', url: project.source_url },
            ].filter((link): link is { label: string; url: string } => Boolean(link.url));

            return (
              <View key={project.id} style={styles.projectCell}>
                <Card style={styles.projectCard}>
                  <View
                    style={styles.thumb}
                    accessibilityRole="image"
                    accessibilityLabel="No cover image for this project">
                    <AppIcon name={{ ios: 'folder.fill', android: 'folder' }} size={28} />
                  </View>
                  <AppText style={styles.projectTitle} numberOfLines={2}>
                    {project.title}
                  </AppText>
                  <AppText style={styles.projectDescription} numberOfLines={3}>
                    {project.description ?? 'No description added yet.'}
                  </AppText>
                  {tags.length > 0 ? <ChipList items={tags} label="Technologies used" /> : null}
                  {links.length > 0 ? (
                    <View style={styles.linkRow}>
                      {links.map((link) => (
                        <Button
                          key={link.label}
                          label={link.label}
                          variant="ghost"
                          onPress={() => onOpenLink(link.url)}
                        />
                      ))}
                    </View>
                  ) : null}
                </Card>
              </View>
            );
          })}
        </View>
      )}
    </SectionCard>
  );
}

