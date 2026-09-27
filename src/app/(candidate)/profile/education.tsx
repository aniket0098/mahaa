/**
 * Education section — real CRUD against `/profile/education`.
 *
 * `institution` is the only required field on the server (`min_length=1`), so it
 * is the only one the form demands; everything else is genuinely optional and is
 * sent as `null` rather than an empty string, because the schema distinguishes
 * "not provided" from "empty".
 */
import { useState } from 'react';
import { View } from 'react-native';

import { educationApi } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SectionEditor } from '@/features/profile/SectionEditor';
import { spacing } from '@/theme/tokens';
import type { EducationCreate, EducationRead } from '@/types/profile';

export default function EducationScreen() {
  return (
    <SectionEditor<EducationRead, EducationCreate>
      testID="education-screen"
      title="Education"
      description="Every course, degree, and certification track you want a recruiter to see."
      emptyMessage="No education records yet. Adding one raises your profile completeness."
      api={educationApi}
      queryKey={queryKeys.education}
      render={(item) => (
        <View style={styles.entry}>
          <AppText variant="body" weight="semibold">
            {item.institution}
          </AppText>
          <AppText variant="small" tone="secondary">
            {[item.degree, item.field_of_study].filter(Boolean).join(' · ') || 'No degree recorded'}
          </AppText>
          <AppText variant="caption" tone="tertiary">
            {formatRange(item.start_date, item.end_date, item.current)}
          </AppText>
        </View>
      )}
      form={({ submit, saving }) => <EducationForm submit={submit} saving={saving} />}
    />
  );
}

function formatRange(start: string | null, end: string | null, current: boolean) {
  const from = start ?? '—';
  if (current) return `${from} · Present`;
  return `${from} – ${end ?? '—'}`;
}

function EducationForm({
  submit,
  saving,
}: {
  submit: (body: EducationCreate) => void;
  saving: boolean;
}) {
  const [institution, setInstitution] = useState('');
  const [degree, setDegree] = useState('');
  const [field, setField] = useState('');

  const canSubmit = institution.trim().length > 0 && !saving;

  return (
    <View style={styles.form}>
      <TextField
        label="Institution"
        value={institution}
        onChangeText={setInstitution}
        placeholder="University or college"
        required
      />
      <TextField label="Degree" value={degree} onChangeText={setDegree} placeholder="B.Tech" />
      <TextField
        label="Field of study"
        value={field}
        onChangeText={setField}
        placeholder="Computer Science"
      />
      <Button
        label="Add education"
        fullWidth
        loading={saving}
        disabled={!canSubmit}
        onPress={() => {
          submit({
            institution: institution.trim(),
            degree: degree.trim() || null,
            field_of_study: field.trim() || null,
          });
          setInstitution('');
          setDegree('');
          setField('');
        }}
      />
    </View>
  );
}

const styles = {
  entry: { gap: 2 },
  form: { gap: spacing.md },
};
