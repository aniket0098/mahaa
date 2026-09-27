/**
 * Candidate settings.
 *
 * Backed by real endpoints: `GET`/`PUT /profile/privacy`. Privacy is a
 * full-state `PUT`, so the form is seeded from the server response and always
 * submits the complete state — never a diff — which is the only shape the API
 * accepts.
 *
 * Account deletion and data export are deliberately absent: no endpoint exists,
 * and a destructive action that cannot complete is worse than an honest absence.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { fetchPrivacy, replacePrivacy } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { useAuth } from '@/auth/AuthContext';
import { spacing } from '@/theme/tokens';
import type { PrivacyUpdate, ProfileVisibility } from '@/types/profile';

const VISIBILITIES: readonly { value: ProfileVisibility; label: string; hint: string }[] = [
  { value: 'private', label: 'Private', hint: 'Only you can see your profile.' },
  { value: 'employers', label: 'Employers', hint: 'Verified employers can see your profile.' },
  { value: 'public', label: 'Public', hint: 'Anyone with your link can see your profile.' },
];

export default function CandidateSettingsScreen() {
  const queryClient = useQueryClient();
  const { logout } = useAuth();

  const privacy = useQuery({ queryKey: queryKeys.privacy, queryFn: fetchPrivacy });
  const [draft, setDraft] = useState<PrivacyUpdate | null>(null);

  // Seed from the server response. Until it arrives the form is inert, so a PUT
  // can never be sent with a guessed default.
  useEffect(() => {
    if (privacy.data) {
      setDraft({
        profile_visibility: privacy.data.profile_visibility,
        discoverable: privacy.data.discoverable,
        allow_messages: privacy.data.allow_messages,
        show_email: privacy.data.show_email,
        show_phone: privacy.data.show_phone,
      });
    }
  }, [privacy.data]);

  const save = useMutation({
    mutationFn: (body: PrivacyUpdate) => replacePrivacy(body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.privacy });
      void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
    },
  });

  const set = (patch: Partial<PrivacyUpdate>) =>
    setDraft((current) => (current ? { ...current, ...patch } : current));

  return (
    <Screen testID="settings-screen">
      <View style={styles.stack}>
        <BackButton />
        <AppText variant="h1" accessibilityRole="header">
          Settings
        </AppText>
        <AppText variant="body" tone="secondary">
          Privacy controls apply to every employer who views your profile.
        </AppText>
        {privacy.isPending ? <SkeletonCard lines={4} /> : null}
        {privacy.isError ? (
          <StatusBanner
            title="Could not load your privacy settings"
            description={
              privacy.error instanceof Error ? privacy.error.message : 'The API did not answer.'
            }
            onRetry={() => void privacy.refetch()}
          />
        ) : null}
        {draft ? (
          <PrivacyForm
            draft={draft}
            set={set}
            onSave={() => save.mutate(draft)}
            saving={save.isPending}
          />
        ) : null}
        {save.isError ? (
          <StatusBanner
            title="Could not save your settings"
            description={
              save.error instanceof ApiError ? save.error.message : 'Please try again.'
            }
          />
        ) : null}
        <Button label="Sign out" variant="ghost" fullWidth onPress={() => void logout()} />
      </View>
    </Screen>
  );
}

function PrivacyForm({
  draft,
  set,
  onSave,
  saving,
}: {
  draft: PrivacyUpdate;
  set: (patch: Partial<PrivacyUpdate>) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <>
      <Card style={styles.card}>
        <SectionHeader title="Profile visibility" description="Who can discover you at all." />
        {VISIBILITIES.map((option) => (
          <Button
            key={option.value}
            label={`${option.label} — ${option.hint}`}
            variant={draft.profile_visibility === option.value ? 'primary' : 'secondary'}
            onPress={() => set({ profile_visibility: option.value })}
          />
        ))}
      </Card>
      <Card style={styles.card}>
        <SectionHeader title="Permissions" />
        <SwitchRow
          label="Discoverable by employers"
          hint="When off, employers cannot search for you."
          value={draft.discoverable}
          onChange={(value) => set({ discoverable: value })}
        />
        <SwitchRow
          label="Allow messages"
          hint="Whether employers may start a conversation with you."
          value={draft.allow_messages}
          onChange={(value) => set({ allow_messages: value })}
        />
        <SwitchRow
          label="Show my email address"
          value={draft.show_email}
          onChange={(value) => set({ show_email: value })}
        />
        <SwitchRow
          label="Show my phone number"
          value={draft.show_phone}
          onChange={(value) => set({ show_phone: value })}
        />
      </Card>
      <Button label="Save privacy settings" fullWidth loading={saving} onPress={onSave} />
    </>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  card: { gap: spacing.md },
});