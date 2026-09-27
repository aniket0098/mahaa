/**
 * Experience section — real CRUD against `/profile/experience`.
 *
 * The server requires both `title` and `company_name`; the form asks for exactly
 * those two and sends everything else as `null`, so no field is invented and no
 * empty string is submitted where the schema expects "not set".
 */
import { useState } from 'react';
import { View } from 'react-native';

import { experienceApi } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SectionEditor } from '@/features/profile/SectionEditor';
import { spacing } from '@/theme/tokens';
import type { ExperienceCreate, ExperienceRead } from '@/types/profile';

export default function ExperienceScreen() {
  return (
    <SectionEditor<ExperienceRead, ExperienceCreate>
      testID="experience-screen"
      title="Experience"
      description="Internships, part-time work, and full-time roles you have held."
      emptyMessage="No experience records yet. Internships count."
      api={experienceApi}
      queryKey={queryKeys.experience}
      render={(item) => (
        <View style={styles.entry}>
          <AppText variant="body" weight="semibold">
            {item.title}
          </AppText>
          <AppText variant="small" tone="secondary">
            {item.company_name}
          </AppText>
          <AppText variant="caption" tone="tertiary">
            {[item.location, item.work_mode].filter(Boolean).join(' · ') || 'Location not added'}
          </AppText>
        </View>
      )}
      form={({ submit, saving }) => <ExperienceForm submit={submit} saving={saving} />}
    />
  );
}

function ExperienceForm({
  submit,
  saving,
}: {
  submit: (body: ExperienceCreate) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');

  const canSubmit = title.trim().length > 0 && company.trim().length > 0 && !saving;

  return (
    <View style={styles.form}>
      <TextField
        label="Role"
        value={title}
        onChangeText={setTitle}
        placeholder="Software Engineering Intern"
        required
      />
      <TextField
        label="Company"
        value={company}
        onChangeText={setCompany}
        placeholder="Acme Labs"
        required
      />
      <TextField
        label="Location"
        value={location}
        onChangeText={setLocation}
        placeholder="Pune, India"
      />
      <Button
        label="Add experience"
        fullWidth
        loading={saving}
        disabled={!canSubmit}
        onPress={() => {
          submit({
            title: title.trim(),
            company_name: company.trim(),
            location: location.trim() || null,
          });
          setTitle('');
          setCompany('');
          setLocation('');
        }}
      />
    </View>
  );
}

const styles = {
  entry: { gap: 2 },
  form: { gap: spacing.md },
};
