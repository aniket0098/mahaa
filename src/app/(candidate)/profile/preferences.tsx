/**
 * Career preferences — `PUT /profile/preferences`.
 *
 * The endpoint is a full-state write, so the form is seeded from the aggregate's
 * `preferences` and always submits the complete state rather than a diff. A
 * candidate who has never set preferences gets the server's own documented
 * default currency and empty lists; nothing is presented as if they had chosen
 * it, because every chip starts unselected.
 *
 * Every option offered here is one of the server's closed enums, so no field
 * can produce a 422 from a value the API does not accept.
 */
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { fetchProfile, replacePreferences } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { SwitchRow } from '@/components/ui/SwitchRow';
import { TextField } from '@/components/ui/TextField';
import { styles } from '@/features/profile/profileStyles';
import { colors, spacing } from '@/theme/tokens';
import type { PreferencesRead, WorkMode } from '@/types/profile';

const WORK_MODES: readonly WorkMode[] = ['remote', 'hybrid', 'onsite'];
const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'internship', 'contract'] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

/** The server's own default, not a guess made by this app. */
const DEFAULT_CURRENCY = 'INR';

interface Draft {
  work_modes: WorkMode[];
  employment_types: string[];
  preferred_locations: string[];
  salary_min: string;
  salary_max: string;
  currency: string;
  availability_date: string;
  willing_to_relocate: boolean;
}

function label(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function toggle<T extends string>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((entry) => entry !== value) : [...values, value];
}

export default function CareerPreferencesScreen() {
  const profile = useQuery({ queryKey: queryKeys.profile, queryFn: fetchProfile });

  if (profile.isPending) {
    return (
      <Screen testID="career-preferences-screen">
        <BackButton />
        <SkeletonCard lines={4} />
      </Screen>
    );
  }

  if (profile.isError) {
    return (
      <Screen testID="career-preferences-screen">
        <BackButton />
        <StatusBanner
          title="Could not load your preferences"
          description={
            profile.error instanceof Error ? profile.error.message : 'The API did not answer.'
          }
          onRetry={() => void profile.refetch()}
        />
      </Screen>
    );
  }

  if (!profile.data) return null;

  // Mounted only once the server has answered, so the draft seeds itself from the
  // stored preferences in a lazy initialiser rather than through an effect.
  return <PreferencesForm saved={profile.data.preferences} />;
}

function PreferencesForm({ saved }: { saved: PreferencesRead | null }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => ({
    work_modes: (saved?.work_modes ?? []) as WorkMode[],
    employment_types: saved?.employment_types ?? [],
    preferred_locations: saved?.preferred_locations ?? [],
    salary_min: saved?.salary_min != null ? String(saved.salary_min) : '',
    salary_max: saved?.salary_max != null ? String(saved.salary_max) : '',
    currency: saved?.currency ?? DEFAULT_CURRENCY,
    availability_date: saved?.availability_date ?? '',
    willing_to_relocate: saved?.willing_to_relocate ?? false,
  }));
  const [location, setLocation] = useState('');

  const save = useMutation({
    mutationFn: (body: Draft) =>
      replacePreferences({
        work_modes: body.work_modes,
        employment_types: body.employment_types,
        preferred_locations: body.preferred_locations,
        salary_min: body.salary_min === '' ? null : Number(body.salary_min),
        salary_max: body.salary_max === '' ? null : Number(body.salary_max),
        currency: body.currency.toUpperCase(),
        availability_date: body.availability_date || null,
        willing_to_relocate: body.willing_to_relocate,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      router.back();
    },
  });

  const addLocation = () => {
    const value = location.trim();
    if (!value) return;
    if (draft.preferred_locations.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
      setLocation('');
      return;
    }
    setDraft({ ...draft, preferred_locations: [...draft.preferred_locations, value] });
    setLocation('');
  };

  const availabilityOk =
    draft.availability_date.trim() === '' || ISO_DATE.test(draft.availability_date.trim());
  const currencyOk = CURRENCY.test(draft.currency.trim().toUpperCase());
  const numbersOk = [draft.salary_min, draft.salary_max].every(
    (value) => value === '' || /^\d+$/.test(value),
  );
  const canSave = availabilityOk && currencyOk && numbersOk && !save.isPending;

  return (
    <Screen testID="career-preferences-screen">
      <View style={styles.stack}>
        <BackButton />
        <AppText variant="h1" accessibilityRole="header">
          Career preferences
        </AppText>
        <AppText variant="body" tone="secondary">
          Private by definition. None of this is shown on your public profile.
        </AppText>

        {save.isError ? (
          <StatusBanner
            title="Those preferences did not save"
            description={save.error instanceof ApiError ? save.error.message : 'Please try again.'}
            onRetry={() => save.mutate(draft)}
          />
        ) : null}

        <Card style={styles.card}>
          <AppText variant="h3">Work modes</AppText>
          <View style={styles.chipRow}>
            {WORK_MODES.map((option) => (
              <Option
                key={option}
                selected={draft.work_modes.includes(option)}
                label={label(option)}
                onPress={() => setDraft({ ...draft, work_modes: toggle(draft.work_modes, option) })}
              />
            ))}
          </View>

          <AppText variant="h3">Employment types</AppText>
          <View style={styles.chipRow}>
            {EMPLOYMENT_TYPES.map((option) => (
              <Option
                key={option}
                selected={draft.employment_types.includes(option)}
                label={label(option)}
                onPress={() =>
                  setDraft({ ...draft, employment_types: toggle(draft.employment_types, option) })
                }
              />
            ))}
          </View>
        </Card>


        <Card style={styles.card}>
          <AppText variant="h3">Preferred locations</AppText>
          {draft.preferred_locations.length > 0 ? (
            <View style={styles.chipRow}>
              {draft.preferred_locations.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${value}`}
                  hitSlop={8}
                  onPress={() =>
                    setDraft({
                      ...draft,
                      preferred_locations: draft.preferred_locations.filter(
                        (entry) => entry !== value,
                      ),
                    })
                  }
                  style={styles.chip}>
                  <AppText style={styles.chipLabel}>{`${value}  ×`}</AppText>
                </Pressable>
              ))}
            </View>
          ) : (
            <AppText variant="small" tone="secondary">
              No locations yet.
            </AppText>
          )}
          <TextField
            label="Add a location"
            value={location}
            onChangeText={setLocation}
            onSubmitEditing={addLocation}
            placeholder="Bengaluru"
          />
          <Button
            label="Add"
            variant="secondary"
            disabled={location.trim().length === 0}
            onPress={addLocation}
          />
        </Card>

        <Card style={styles.card}>
          <AppText variant="h3">Compensation</AppText>
          <View style={optionRow}>
            <View style={optionCell}>
              <TextField
                label="Minimum"
                value={draft.salary_min}
                onChangeText={(value) => setDraft({ ...draft, salary_min: value })}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>
            <View style={optionCell}>
              <TextField
                label="Maximum"
                value={draft.salary_max}
                onChangeText={(value) => setDraft({ ...draft, salary_max: value })}
                placeholder="0"
                keyboardType="number-pad"
              />
            </View>
          </View>
          <TextField
            label="Currency"
            value={draft.currency}
            onChangeText={(value) => setDraft({ ...draft, currency: value })}
            placeholder="INR"
            autoCapitalize="characters"
            maxLength={3}
            error={currencyOk ? null : 'Use a three-letter code such as INR.'}
          />
          <TextField
            label="Available from"
            value={draft.availability_date}
            onChangeText={(value) => setDraft({ ...draft, availability_date: value })}
            placeholder="2026-08-01"
            helper="YYYY-MM-DD"
            error={availabilityOk ? null : 'Use the YYYY-MM-DD format.'}
          />
          <SwitchRow
            label="Willing to relocate"
            hint="Employers see this when they shortlist you."
            value={draft.willing_to_relocate}
            onChange={(value) => setDraft({ ...draft, willing_to_relocate: value })}
          />
        </Card>

        <Button
          label="Save preferences"
          fullWidth
          loading={save.isPending}
          disabled={!canSave}
          onPress={() => save.mutate(draft)}
        />
        <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

/** One selectable option. Selection is never carried by colour alone. */
function Option({
  label: text,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={text}
      onPress={onPress}
      style={[
        styles.chip,
        selected ? { backgroundColor: colors.colorPrimary, borderColor: colors.colorPrimary } : null,
      ]}>
      <AppText style={[styles.chipLabel, selected ? { color: colors.colorTextOnPrimary } : null]}>
        {text}
      </AppText>
    </Pressable>
  );
}

const optionRow = {
  flexDirection: 'row' as const,
  gap: spacing.md,
};

const optionCell = {
  flex: 1,
  gap: spacing.xs,
};

