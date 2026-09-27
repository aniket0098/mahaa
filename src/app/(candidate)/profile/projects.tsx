/**
 * Projects section — real CRUD against `/profile/projects`.
 *
 * Projects are the strongest evidence a candidate can offer, so the create form
 * asks for a title and a description and nothing that the server would reject.
 * `source_url`/`live_url` are validated server-side as http(s) only, which is
 * why they are not offered here: a URL field that silently fails on a typo is
 * worse than omitting it until it can be validated properly on the device.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { projectsApi } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SectionEditor } from '@/features/profile/SectionEditor';
import { spacing } from '@/theme/tokens';
import type { ProjectCreate, ProjectRead } from '@/types/profile';

export default function ProjectsScreen() {
  return (
    <SectionEditor<ProjectRead, ProjectCreate>
      testID="projects-screen"
      title="Projects"
      description="Work you have built, with the role you played and what it demonstrates."
      emptyMessage="No projects yet. Anything you have built counts, coursework included."
      api={projectsApi}
      queryKey={queryKeys.projects}
      render={(item) => (
        <View style={styles.entry}>
          <AppText variant="body" weight="semibold">
            {item.title}
          </AppText>
          {item.role ? (
            <AppText variant="small" tone="secondary">
              {item.role}
            </AppText>
          ) : null}
          {item.description ? (
            <AppText variant="caption" tone="tertiary">
              {item.description}
            </AppText>
          ) : null}
        </View>
      )}
      form={({ submit, saving }) => <ProjectForm submit={submit} saving={saving} />}
    />
  );
}

function ProjectForm({
  submit,
  saving,
}: {
  submit: (body: ProjectCreate) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [role, setRole] = useState('');
  const [description, setDescription] = useState('');

  const canSubmit = title.trim().length > 0 && !saving;

  return (
    <View style={styles.form}>
      <TextField
        label="Project title"
        value={title}
        onChangeText={setTitle}
        placeholder="Campus navigation app"
        required
      />
      <TextField
        label="Your role"
        value={role}
        onChangeText={setRole}
        placeholder="Full-stack developer"
      />
      <TextField
        label="What it does"
        value={description}
        onChangeText={setDescription}
        placeholder="Two sentences on the problem it solves."
        multiline
      />
      <Button
        label="Add project"
        fullWidth
        loading={saving}
        disabled={!canSubmit}
        onPress={() => {
          submit({
            title: title.trim(),
            role: role.trim() || null,
            description: description.trim() || null,
          });
          setTitle('');
          setRole('');
          setDescription('');
        }}
      />
    </View>
  );
}

const styles = {
  entry: { gap: 2 },
  form: { gap: spacing.md },
};
