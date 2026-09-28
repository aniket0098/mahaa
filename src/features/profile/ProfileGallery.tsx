/**
 * Achievements & Certificates gallery, plus the Career Preferences summary.
 *
 * Neither a certificate nor an achievement carries an image on the server, so
 * every card leads with an icon tile and the section says so rather than
 * borrowing a stock picture. A "Verify" control appears only when the record
 * stored an http(s) `verification_url` — an unverified credential is never
 * described as verified.
 */

import { ScrollView, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { buildGallery, type GalleryEntry } from '@/features/profile/profileModel';
import { ChipList, SectionCard, SectionEmpty } from '@/features/profile/ProfileSections';
import { styles } from '@/features/profile/profileStyles';
import type { AchievementRead, CertificationRead, PreferencesRead } from '@/types/profile';

export interface AchievementsSectionProps {
  certifications: readonly CertificationRead[];
  achievements: readonly AchievementRead[];
  onEditCertifications: () => void;
  onEditAchievements: () => void;
  onOpenLink: (url: string) => void;
}

export function AchievementsSection({
  certifications,
  achievements,
  onEditCertifications,
  onEditAchievements,
  onOpenLink,
}: AchievementsSectionProps) {
  const entries = buildGallery(certifications, achievements);
  const total = certifications.length + achievements.length;

  return (
    <SectionCard
      title="Achievements & Certificates"
      description={
        total > 0 ? `${certifications.length} certificates · ${achievements.length} achievements` : null
      }
      action={<Button label="Add" variant="ghost" onPress={onEditCertifications} />}
      testID="profile-achievements">
      {entries.length === 0 ? (
        <SectionEmpty
          message="Nothing recorded yet. Certificates and achievements you add are shown here with their issuer and date."
          actionLabel="Add a certificate"
          onAction={onEditCertifications}
        />
      ) : (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.gallery}
            accessibilityLabel="Certificates and achievements">
            {entries.map((entry) => (
              <GalleryCard key={entry.id} entry={entry} onOpenLink={onOpenLink} />
            ))}
          </ScrollView>
          <View>
            <Button
              label={achievements.length > 0 ? 'Manage achievements' : 'Add an achievement'}
              variant="ghost"
              onPress={onEditAchievements}
            />
          </View>
        </>
      )}
    </SectionCard>
  );
}

function GalleryCard({
  entry,
  onOpenLink,
}: {
  entry: GalleryEntry;
  onOpenLink: (url: string) => void;
}) {
  return (
    <Card style={styles.galleryCard}>
      <View
        style={styles.galleryThumb}
        accessibilityRole="image"
        accessibilityLabel={
          entry.kind === 'certificate'
            ? 'No certificate image on file'
            : 'No achievement image on file'
        }>
        <AppIcon
          name={
            entry.kind === 'certificate'
              ? { ios: 'checkmark.seal.fill', android: 'workspace_premium' }
              : { ios: 'trophy.fill', android: 'emoji_events' }
          }
          size={34}
        />
      </View>
      <View style={styles.galleryBody}>
        <AppText style={styles.galleryTitle} numberOfLines={2}>
          {entry.title}
        </AppText>
        {entry.issuer ? (
          <AppText style={styles.galleryIssuer} numberOfLines={1}>
            {entry.issuer}
          </AppText>
        ) : null}
        {entry.date ? (
          <AppText style={styles.galleryDate} numberOfLines={1}>
            {entry.date}
          </AppText>
        ) : null}
        {entry.detail ? (
          <AppText style={styles.galleryDate} numberOfLines={2}>
            {entry.detail}
          </AppText>
        ) : null}
      </View>
      {entry.verificationUrl ? (
        <Button label="Verify" variant="ghost" onPress={() => onOpenLink(entry.verificationUrl!)} />
      ) : null}
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Career preferences                                                          */
/* -------------------------------------------------------------------------- */

/** `full_time` -> `Full time`. Presentation only; the stored enum is untouched. */
function optionLabel(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * `PUT /profile/preferences` is a full-state write, so the summary shows exactly
 * what the server returned — including an honest "nothing saved" card when the
 * candidate has never set preferences. No default option is presented as if it
 * had been chosen.
 */
export function CareerPreferencesSection({
  preferences,
  onEdit,
}: {
  preferences: PreferencesRead | null;
  onEdit: () => void;
}) {
  const groups = [
    { key: 'work', label: 'Work modes', values: preferences?.work_modes ?? [] },
    { key: 'type', label: 'Employment types', values: preferences?.employment_types ?? [] },
    { key: 'location', label: 'Preferred locations', values: preferences?.preferred_locations ?? [] },
  ].filter((group) => group.values.length > 0);

  return (
    <SectionCard
      title="Career Preferences"
      description="What you are looking for next"
      action={<Button label={preferences ? 'Edit' : 'Add'} variant="ghost" onPress={onEdit} />}
      testID="profile-preferences">
      {groups.length === 0 && !preferences ? (
        <SectionEmpty
          message="No career preferences saved yet. Setting them tells the app what to prioritise for you."
          actionLabel="Set preferences"
          onAction={onEdit}
        />
      ) : groups.length === 0 ? (
        <SectionEmpty
          message="Preferences are saved but every list is empty. Add the modes and locations you want."
          actionLabel="Edit preferences"
          onAction={onEdit}
        />
      ) : (
        <View style={styles.stack}>
          {groups.map((group) => (
            <View key={group.key} style={styles.empty}>
              <AppText variant="caption" tone="tertiary">
                {group.label}
              </AppText>
              <ChipList items={group.values.map(optionLabel)} label={group.label} />
            </View>
          ))}
          {preferences ? (
            <AppText variant="caption" tone="tertiary">
              {preferences.willing_to_relocate
                ? 'Open to relocating'
                : 'Not looking to relocate'}
            </AppText>
          ) : null}
        </View>
      )}
    </SectionCard>
  );
}

