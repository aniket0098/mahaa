/**
 * The college's institution, editable after onboarding.
 *
 * Reuses the same endpoints the wizard used (`PATCH /institutions/{id}`), so
 * there is one code path for writing an institution rather than a wizard version
 * and an edit version that can disagree.
 *
 * The verification status is displayed, never set. This screen can only *request*
 * verification, and the server's response moves the record to `pending` and says
 * what has and has not happened.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import {
  fetchMyInstitutions,
  requestInstitutionVerification,
  updateInstitution,
} from '@/api/institutions';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { RequireRole } from '@/auth/RoleGuard';
import { spacing } from '@/theme/tokens';

const NAME_MAX = 200;
const LOCATION_MAX = 160;
const DESCRIPTION_MAX = 4000;
const WEBSITE_MAX = 300;

export default function CollegeInstitutionScreen() {
  return (
    <RequireRole allow="college">
      <InstitutionEditor />
    </RequireRole>
  );
}

function InstitutionEditor() {
  const queryClient = useQueryClient();
  const institutions = useQuery({
    queryKey: queryKeys.myInstitutions,
    queryFn: fetchMyInstitutions,
  });
  const institution = institutions.data?.[0]?.institution;

  // `null` means "not edited yet", so the editor shows what the server holds until
  // the person actually types. Deriving rather than syncing means the fields never
  // flash empty-then-filled, and a refetch cannot overwrite half-typed input.
  const [editedName, setName] = useState<string | null>(null);
  const [editedLocation, setLocation] = useState<string | null>(null);
  const [editedWebsite, setWebsite] = useState<string | null>(null);
  const [editedDescription, setDescription] = useState<string | null>(null);

  const name = editedName ?? institution?.name ?? '';
  const location = editedLocation ?? institution?.location ?? '';
  const website = editedWebsite ?? institution?.website ?? '';
  const description = editedDescription ?? institution?.description ?? '';

  const save = useMutation({
    mutationFn: () =>
      updateInstitution(institution?.id as string, {
        name: name.trim(),
        location: location.trim() || null,
        website: website.trim() || null,
        description: description.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myInstitutions });
    },
  });
  const errors = fieldErrors(save.error);

  const request = useMutation({
    mutationFn: () => requestInstitutionVerification(institution?.id as string),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myInstitutions });
    },
  });
  const canRequest =
    institution?.verification_status === 'unverified' ||
    institution?.verification_status === 'rejected';

  return (
    <Screen testID="college-institution-screen">
      <View style={styles.stack}>
        <AppText variant="h1" accessibilityRole="header">
          Institution
        </AppText>

        {institutions.isError ? (
          <StatusBanner
            title="Your institution did not load"
            description={
              institutions.error instanceof ApiError
                ? institutions.error.message
                : 'Please try again.'
            }
            onRetry={() => void institutions.refetch()}
          />
        ) : null}

        <Card style={styles.card}>
          <TextField
            label="Institution name"
            value={name}
            onChangeText={setName}
            maxLength={NAME_MAX}
            error={errors.name}
            required
          />
          <TextField
            label="Location"
            value={location}
            onChangeText={setLocation}
            maxLength={LOCATION_MAX}
            error={errors.location}
          />
          <TextField
            label="Website"
            value={website}
            onChangeText={setWebsite}
            autoCapitalize="none"
            keyboardType="url"
            maxLength={WEBSITE_MAX}
            error={errors.website}
          />
          <TextField
            label="About"
            value={description}
            onChangeText={setDescription}
            multiline
            maxLength={DESCRIPTION_MAX}
            error={errors.description}
          />
          <Button
            label="Save changes"
            loading={save.isPending}
            disabled={name.trim().length === 0}
            onPress={() => save.mutate()}
          />
          {save.isError ? (
            <StatusBanner
              title="Those changes did not save"
              description={save.error instanceof ApiError ? save.error.message : 'Please retry.'}
            />
          ) : null}
        </Card>

        <Card style={styles.card}>
          <AppText variant="h3" accessibilityRole="header">
            Verification
          </AppText>
          <AppText variant="body">
            {`Current status: ${institution?.verification_status ?? 'unknown'}`}
          </AppText>
          <AppText variant="small" tone="tertiary">
            Requesting records your interest. Document review is a later stage, so a request does
            not make your institution verified.
          </AppText>
          {canRequest ? (
            <Button
              label="Request verification"
              variant="secondary"
              loading={request.isPending}
              onPress={() => request.mutate()}
            />
          ) : null}
          {request.isSuccess ? (
            <AppText variant="small" tone="success">
              {request.data.note}
            </AppText>
          ) : null}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  card: { gap: spacing.md },
});
