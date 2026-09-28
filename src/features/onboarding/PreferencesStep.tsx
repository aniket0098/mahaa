/**
 * Candidate step 5 — job preferences.
 *
 * A required step, so no Skip: the server's completeness rule counts this section
 * only when all three lists are non-empty, so a half-filled preferences screen
 * would leave the wizard permanently unable to finish while looking finished.
 *
 * Values are saved with `PUT /profile/preferences`, which is replace-not-merge
 * semantics: the body is the complete state. So the screen always reads what is
 * stored, lets the person edit it, and writes the whole list back — never a
 * delta. That is what makes coming back and changing one chip behave as expected.
 */

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import { fetchPreferences, replacePreferences } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { StepBody } from '@/features/onboarding/StepBody';
import {
  EMPLOYMENT_TYPE_LABELS,
  EMPLOYMENT_TYPES,
  LOCATION_ITEM_MAX,
  PREFERENCE_MAX,
  WORK_MODES,
  stepStyles,
} from '@/features/onboarding/onboardingStyles';
import type { WorkMode } from '@/types/profile';

const WORK_MODE_VALUES: readonly WorkMode[] = ['remote', 'hybrid', 'onsite'];

/** Keeps a stored value only if the server's enum still recognises it. */
function isWorkMode(value: string): value is WorkMode {
  return (WORK_MODE_VALUES as readonly string[]).includes(value);
}

export interface PreferencesStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function PreferencesStep({ onNext, busy, canGoBack, onBack }: PreferencesStepProps) {
  /**
   * `null` means "not edited yet", which is distinct from `[]` (deliberately cleared).
   * That distinction matters because the write is replace-semantics: the first save
   * has to send what the server already holds, and only afterwards what the person
   * changed. Syncing from the server in an effect would instead repaint the form on
   * every refetch and fight the person while they are typing.
   */
  const [editedWorkModes, setWorkModes] = useState<WorkMode[] | null>(null);
  const [editedTypes, setTypes] = useState<string[] | null>(null);
  const [editedLocations, setLocations] = useState<string[] | null>(null);
  const [locationDraft, setLocationDraft] = useState('');

  const stored = useQuery({ queryKey: queryKeys.preferences, queryFn: fetchPreferences });
  const saved = stored.data;

  // Derived, not synchronised: before the first edit the screen shows the server's
  // values; after it, the person's. No effect, so no cascading render, and no
  // window where the form shows one value and saves another.
  const workModes = editedWorkModes ?? (saved?.work_modes ?? []).filter(isWorkMode);
  const types = editedTypes ?? saved?.employment_types ?? [];
  const locations = editedLocations ?? saved?.preferred_locations ?? [];

  const save = useMutation({
    mutationFn: () =>
      replacePreferences({
        work_modes: workModes,
        employment_types: types,
        preferred_locations: locations,
        // `PUT` is replace-semantics, so the fields this step does not collect
        // must be sent back as they already stand. Sending `null` here would
        // silently wipe a salary band or an availability date the person set from
        // the profile screen — a real data loss caused by an unrelated save.
        salary_min: saved?.salary_min ?? null,
        salary_max: saved?.salary_max ?? null,
        currency: saved?.currency ?? 'INR',
        availability_date: saved?.availability_date ?? null,
        willing_to_relocate: saved?.willing_to_relocate ?? false,
      }),
  });
  const errors = fieldErrors(save.error);

  // All three lists are required by the server's rule, so all three gate Continue.
  const ready = workModes.length > 0 && types.length > 0 && locations.length > 0;

  const toggle = <T,>(list: T[], value: T): T[] =>
    list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value];

  const addLocation = () => {
    const value = locationDraft.trim();
    if (!value || locations.length >= PREFERENCE_MAX) return;
    // Case-insensitive: "Pune" and "pune" are one place to a person, and two rows
    // of it would be noise in the saved list.
    if (locations.some((entry) => entry.toLowerCase() === value.toLowerCase())) return;
    setLocations([...locations, value]);
    setLocationDraft('');
  };

  return (
    <StepBody
      onNext={() => onNext(() => save.mutateAsync())}
      ready={ready}
      busy={busy || save.isPending || stored.isLoading}
      canGoBack={canGoBack}
      onBack={onBack}>
      {stored.isError ? (
        <StatusBanner
          title="Your saved preferences did not load"
          description={
            stored.error instanceof ApiError ? stored.error.message : 'Please try again.'
          }
          onRetry={() => void stored.refetch()}
        />
      ) : null}
      {save.isError ? (
        <StatusBanner
          title="Those preferences did not save"
          description={save.error instanceof ApiError ? save.error.message : 'Please try again.'}
          onRetry={() => save.mutate()}
        />
      ) : null}

      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Work mode
        </AppText>
        <View style={stepStyles.choiceRow}>
          {WORK_MODES.map((option) => {
            const selected = workModes.includes(option.value);
            return (
              <Pressable
                key={option.value}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={option.label}
                onPress={() => setWorkModes(toggle(workModes, option.value))}
                style={[stepStyles.choice, selected ? stepStyles.choiceSelected : null]}>
                <AppText variant="small" tone={selected ? 'accent' : 'secondary'}>
                  {option.label}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Employment type
        </AppText>
        <View style={stepStyles.choiceRow}>
          {EMPLOYMENT_TYPES.map((option) => {
            const selected = types.includes(option);
            return (
              <Pressable
                key={option}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={EMPLOYMENT_TYPE_LABELS[option] ?? option}
                onPress={() => setTypes(toggle(types, option))}
                style={[stepStyles.choice, selected ? stepStyles.choiceSelected : null]}>
                <AppText variant="small" tone={selected ? 'accent' : 'secondary'}>
                  {EMPLOYMENT_TYPE_LABELS[option] ?? option}
                </AppText>
              </Pressable>
            );
          })}
        </View>
      </Card>

      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Preferred locations
        </AppText>
        {locations.length > 0 ? (
          <View style={stepStyles.chipRow}>
            {locations.map((value) => (
              <Pressable
                key={value}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${value}`}
                hitSlop={8}
                onPress={() => setLocations(locations.filter((entry) => entry !== value))}
                style={stepStyles.chip}>
                <AppText style={stepStyles.chipLabel}>{`${value}  ×`}</AppText>
              </Pressable>
            ))}
          </View>
        ) : null}
        <TextField
          label="Add a location"
          value={locationDraft}
          onChangeText={setLocationDraft}
          onSubmitEditing={addLocation}
          placeholder="Pune"
          maxLength={LOCATION_ITEM_MAX}
          returnKeyType="done"
          error={errors.preferred_locations}
          helper={`${locations.length} of ${PREFERENCE_MAX}`}
        />
        <Button
          label="Add"
          variant="secondary"
          disabled={locationDraft.trim().length === 0 || locations.length >= PREFERENCE_MAX}
          onPress={addLocation}
        />
      </Card>
    </StepBody>
  );
}