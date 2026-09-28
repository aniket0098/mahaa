/**
 * Employer step 2 — the company. Required, so no Skip.
 *
 * This is the step the server's employer onboarding rule keys on ("the account has
 * a company"), so it is the one screen that must not be skippable. Only the name is
 * required; everything else is filled in later from the Company screen.
 *
 * Creating a company makes the caller its owner server-side, atomically, so there is
 * no second "join" step and no window where two people can both become owner.
 *
 * **Duplicate-safe on retry.** `POST /companies` is a create, so a double-tap or a
 * retry after a timeout would make a second company. The screen therefore reads the
 * existing company list first and, when one already exists, updates that company
 * instead of creating another. A second company is a real record the server will
 * happily keep, so this is prevented in the app rather than hoped away.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { createCompany, fetchMyCompanies, updateCompany } from '@/api/company';
import { ApiError, fieldErrors } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import { stepStyles } from '@/features/onboarding/onboardingStyles';
import type { CompanySize } from '@/types/company';

const NAME_MAX = 160;
const LOCATION_MAX = 160;
const DESCRIPTION_MAX = 4000;
const WEBSITE_MAX = 300;
const INDUSTRY_MAX = 120;

const SIZES: readonly { value: CompanySize; label: string }[] = [
  { value: '1-10', label: '1-10' },
  { value: '11-50', label: '11-50' },
  { value: '51-200', label: '51-200' },
  { value: '201-500', label: '201-500' },
  { value: '501-1000', label: '501-1000' },
  { value: '1000+', label: '1000+' },
];

export interface CompanyStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function CompanyStep({ onNext, busy, canGoBack, onBack }: CompanyStepProps) {
  const queryClient = useQueryClient();
  const mine = useQuery({ queryKey: queryKeys.myCompanies, queryFn: fetchMyCompanies });

  // An existing company means this person is editing, not creating. Read before
  // writing so a retry updates rather than duplicates.
  const existing = mine.data?.[0];
  const [name, setName] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [website, setWebsite] = useState<string | null>(null);
  const [industry, setIndustry] = useState<string | null>(null);
  const [size, setSize] = useState<CompanySize | null>(null);
  const [description, setDescription] = useState<string | null>(null);

  const save = useMutation({
    // Create and update return different read models; nothing downstream reads
    // the value, so the wider union is honest rather than a cast.
    mutationFn: async (): Promise<unknown> => {
      const body = {
        name: (name ?? '').trim(),
        location: (location ?? '').trim() || null,
        website: (website ?? '').trim() || null,
        industry: (industry ?? '').trim() || null,
        company_size: size,
        description: (description ?? '').trim() || null,
      };
      // Create only when there is genuinely nothing to update. `mine` is refetched
      // after the first save, so a second visit lands on the update path.
      return existing ? updateCompany(existing.company.id, body) : createCompany(body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myCompanies });
      void queryClient.invalidateQueries({ queryKey: queryKeys.onboarding });
    },
  });
  const errors = fieldErrors(save.error);

  // Only the name gates. Blocking the whole step on an optional field would make the
  // required part impossible to reach in a hurry.
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
          title="Your companies did not load"
          description={mine.error instanceof ApiError ? mine.error.message : 'Please try again.'}
          onRetry={() => void mine.refetch()}
        />
      ) : null}
      {save.isError ? (
        <StatusBanner
          title="That company did not save"
          description={save.error instanceof ApiError ? save.error.message : 'Please try again.'}
          onRetry={() => save.mutate()}
        />
      ) : null}

      {existing ? (
        <AppText variant="small" tone="tertiary">
          {`You already have “${existing.company.name}”. Saving here updates it instead of creating a second company.`}
        </AppText>
      ) : null}
      <Card style={stepStyles.card}>
        <TextField
          label="Company name"
          value={name ?? existing?.company.name ?? ''}
          onChangeText={setName}
          placeholder="Acme Labs"
          maxLength={NAME_MAX}
          error={errors.name}
          required
        />
        <TextField
          label="Location"
          value={location ?? existing?.company.location ?? ''}
          onChangeText={setLocation}
          placeholder="Bengaluru"
          maxLength={LOCATION_MAX}
          error={errors.location}
          helper="Optional."
        />
        <TextField
          label="Website"
          value={website ?? existing?.company.website ?? ''}
          onChangeText={setWebsite}
          placeholder="https://acme.example"
          autoCapitalize="none"
          keyboardType="url"
          maxLength={WEBSITE_MAX}
          error={errors.website}
          helper="Optional."
        />
        <TextField
          label="Industry"
          value={industry ?? existing?.company.industry ?? ''}
          onChangeText={setIndustry}
          placeholder="Software"
          maxLength={INDUSTRY_MAX}
          error={errors.industry}
          helper="Optional."
        />

        <AppText variant="label" tone="secondary">
          Company size (optional)
        </AppText>
        <View style={stepStyles.choiceRow}>
          {SIZES.map((option) => {
            const selected = size === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.label} people`}
                onPress={() => setSize(selected ? null : option.value)}
                style={[stepStyles.choice, selected ? stepStyles.choiceSelected : null]}>
                <AppText variant="small" tone={selected ? 'accent' : 'secondary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>

        <TextField
          label="About the company"
          value={description ?? existing?.company.description ?? ''}
          onChangeText={setDescription}
          placeholder="What you build, and who you hire for."
          multiline
          maxLength={DESCRIPTION_MAX}
          error={errors.description}
          helper="Optional."
        />
      </Card>
    </StepBody>
  );
}