/**
 * College step 1 — the institution. Required, so no Skip.
 *
 * The server derives the college's onboarding completion from "an active institution
 * exists", so this is the step that must not be skippable. Only the name is
 * required; location, website, and description are filled in later.
 *
 * **Duplicate-safe on retry**, for the same reason as the employer company step:
 * `POST /institutions` is a create, so a retry after a timeout would leave a
 * college owning two institutions. The screen reads the existing list first and
 * updates instead of creating when one is already there.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError, fieldErrors } from '@/api/errors';
import { createInstitution, fetchMyInstitutions, updateInstitution } from '@/api/institutions';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import { stepStyles } from '@/features/onboarding/onboardingStyles';

const NAME_MAX = 200;
const LOCATION_MAX = 160;
const DESCRIPTION_MAX = 4000;
const WEBSITE_MAX = 300;

export interface InstitutionStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function InstitutionStep({ onNext, busy, canGoBack, onBack }: InstitutionStepProps) {
  const queryClient = useQueryClient();
  const mine = useQuery({ queryKey: queryKeys.myInstitutions, queryFn: fetchMyInstitutions });

  const existing = mine.data?.[0]?.institution;
  const [name, setName] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [website, setWebsite] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);

  const save = useMutation({
    // The two branches return different read models (a summary on create, a full
    // record on update). Nothing downstream reads the value — the step only needs
    // to know it succeeded and then invalidates — so the wider union is honest
    // rather than a cast pretending the two shapes match.
    mutationFn: async (): Promise<unknown> => {
      const body = {
        name: (name ?? '').trim(),
        location: (location ?? '').trim() || null,
        website: (website ?? '').trim() || null,
        description: (description ?? '').trim() || null,
      };
      return existing ? updateInstitution(existing.id, body) : createInstitution(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myInstitutions });
      void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding });
    },
  });
  const errors = fieldErrors(save.error);

  const ready = (name ?? '').trim().length > 0;

  return (
    <StepBody
      onNext={() => onNext(() => save.mutateAsync())}
      ready={ready}
      busy={busy || save.isPending || mine.isLoading}
      canGoBack={canGoBack}
      onBack={onBack}>
      {mine.isError ? (
        <StatusBanner
          title="Your institution did not load"
          description={mine.error instanceof ApiError ? mine.error.message : 'Please try again.'}
          onRetry={() => void mine.refetch()}
        />
      ) : null}
      {save.isError ? (
        <StatusBanner
          title="That institution did not save"
          description={save.error instanceof ApiError ? save.error.message : 'Please try again.'}
          onRetry={() => save.mutate()}
        />
      ) : null}

      {existing ? (
        <AppText variant="small" tone="tertiary">
          {`“${existing.name}” is already saved. Saving here updates it instead of creating a second institution.`}
        </AppText>
      ) : null}

      <Card style={stepStyles.card}>
        <TextField
          label="Institution name"
          value={name ?? existing?.name ?? ''}
          onChangeText={setName}
          placeholder="MIT Pune"
          maxLength={NAME_MAX}
          error={errors.name}
          required
        />
        <TextField
          label="Location"
          value={location ?? existing?.location ?? ''}
          onChangeText={setLocation}
          placeholder="Pune, Maharashtra"
          maxLength={LOCATION_MAX}
          error={errors.location}
          helper="Optional."
        />
        <TextField
          label="Website"
          value={website ?? existing?.website ?? ''}
          onChangeText={setWebsite}
          placeholder="https://mitpune.ac.in"
          autoCapitalize="none"
          keyboardType="url"
          maxLength={WEBSITE_MAX}
          error={errors.website}
          helper="Optional."
        />
        <TextField
          label="About the institution"
          value={description ?? existing?.description ?? ''}
          onChangeText={setDescription}
          placeholder="Departments, courses, and who you place with industry."
          multiline
          maxLength={DESCRIPTION_MAX}
          error={errors.description}
          helper="Optional."
        />
      </Card>
    </StepBody>
  );
}