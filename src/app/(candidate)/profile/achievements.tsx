/**
 * Achievements — real CRUD against `/profile/achievements`.
 *
 * `app.schemas.profile.AchievementCreate` is `extra="forbid"` and requires
 * `category` from a closed set of six, so the form offers exactly those six as
 * selectable chips rather than a free-text field that would 422. No `issuer`
 * field is sent: the server's read model has none either, and the chips in the
 * profile gallery show the category in its place.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { achievementsApi } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SectionEditor } from '@/features/profile/SectionEditor';
import { styles } from '@/features/profile/profileStyles';
import { colors } from '@/theme/tokens';
import type {
  AchievementCategory,
  AchievementCreate,
  AchievementRead,
} from '@/types/profile';

const CATEGORIES: readonly { value: AchievementCategory; label: string }[] = [
  { value: 'competition', label: 'Competition' },
  { value: 'award', label: 'Award' },
  { value: 'academic', label: 'Academic' },
  { value: 'hackathon', label: 'Hackathon' },
  { value: 'publication', label: 'Publication' },
  { value: 'leadership', label: 'Leadership' },
];

/** `YYYY-MM-DD`, the only shape `date` accepts. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function AchievementsScreen() {
  return (
    <SectionEditor<AchievementRead, AchievementCreate>
      testID="achievements-screen"
      title="Achievements"
      description="Competitions, awards, publications, and leadership roles you have taken part in."
      emptyMessage="No achievements yet. Adding one raises your profile completeness."
      api={achievementsApi}
      queryKey={queryKeys.achievements}
      render={(item) => (
        <View style={styles.entry}>
          <AppText variant="body" weight="semibold">
            {item.title}
          </AppText>
          {item.category ? (
            <AppText variant="small" tone="secondary">
              {CATEGORIES.find((entry) => entry.value === item.category)?.label ?? item.category}
            </AppText>
          ) : null}
          {item.achieved_on ? (
            <AppText variant="caption" tone="tertiary">
              {item.achieved_on}
            </AppText>
          ) : null}
          {item.description ? (
            <AppText variant="caption" tone="tertiary">
              {item.description}
            </AppText>
          ) : null}
        </View>
      )}
      form={({ submit, saving }) => <AchievementForm submit={submit} saving={saving} />}
    />
  );
}

function AchievementForm({
  submit,
  saving,
}: {
  submit: (body: AchievementCreate) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<AchievementCategory>('competition');
  const [description, setDescription] = useState('');
  const [achievedOn, setAchievedOn] = useState('');

  const dateOk = achievedOn.trim() === '' || ISO_DATE.test(achievedOn.trim());
  const canSubmit = title.trim().length > 0 && dateOk && !saving;

  return (
    <View style={styles.form}>
      <TextField
        label="Achievement"
        value={title}
        onChangeText={setTitle}
        placeholder="First place, national hackathon"
        required
      />

      <AppText variant="label" tone="secondary">
        Category *
      </AppText>
      <View style={styles.chipRow}>
        {CATEGORIES.map((option) => {
          const active = option.value === category;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              accessibilityLabel={option.label}
              onPress={() => setCategory(option.value)}
              style={[
                styles.chip,
                active ? { backgroundColor: colors.colorPrimary, borderColor: colors.colorPrimary } : null,
              ]}>
              <AppText style={[styles.chipLabel, active ? { color: colors.colorTextOnPrimary } : null]}>
                {option.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <TextField
        label="What happened"
        value={description}
        onChangeText={setDescription}
        placeholder="One or two lines on the result."
        multiline
      />
      <TextField
        label="Achieved on"
        value={achievedOn}
        onChangeText={setAchievedOn}
        placeholder="2026-03-04"
        helper="YYYY-MM-DD"
        error={dateOk ? null : 'Use the YYYY-MM-DD format.'}
      />

      <Button
        label="Add achievement"
        fullWidth
        loading={saving}
        disabled={!canSubmit}
        onPress={() => {
          submit({
            title: title.trim(),
            category,
            description: description.trim() || null,
            achieved_on: achievedOn.trim() || null,
          });
          setTitle('');
          setDescription('');
          setAchievedOn('');
        }}
      />
    </View>
  );
}
