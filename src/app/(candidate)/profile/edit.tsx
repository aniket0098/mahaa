/**
 * Edit profile — the one screen behind the profile header's "Edit Profile"
 * button and the About and My Journey section actions.
 *
 * `PATCH /profile` is the only identity write the API exposes, and it carries
 * exactly four fields: headline, summary, location, and interests. Grouping them
 * on one screen keeps the three Edit actions on the profile page honest — they
 * all land here rather than each promising an editor that does not exist.
 *
 * The form is seeded from `GET /profile`, so it is inert until the server has
 * answered and a `PATCH` can never be sent with a guessed default. Nothing is
 * cleared on failure: whatever the candidate typed is still on screen when the
 * persistent error banner appears.
 */

import { useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { fetchProfile, updateIdentity } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { journeyChips } from '@/features/profile/profileModel';
import { styles } from '@/features/profile/profileStyles';
import type { IdentityRead } from '@/types/profile';

/** `app.schemas.profile.ProfileIdentityUpdate` bounds, mirrored on the client. */
const HEADLINE_MAX = 200;
const SUMMARY_MAX = 4000;
const LOCATION_MAX = 160;
const INTEREST_MAX = 80;
const INTERESTS_MAX = 20;

interface Draft {
  headline: string;
  summary: string;
  location: string;
  interests: string[];
}

export default function EditProfileScreen() {
  const profile = useQuery({ queryKey: queryKeys.profile, queryFn: fetchProfile });

  if (profile.isPending) {
    return (
      <Screen testID="edit-profile-screen">
        <BackButton />
        <SkeletonCard lines={4} />
      </Screen>
    );
  }

  if (profile.isError) {
    return (
      <Screen testID="edit-profile-screen">
        <BackButton />
        <StatusBanner
          title="Could not load your profile"
          description={
            profile.error instanceof Error ? profile.error.message : 'The API did not answer.'
          }
          onRetry={() => void profile.refetch()}
        />
      </Screen>
    );
  }

  if (!profile.data) return null;

  // The form mounts only once the server has answered, so it seeds itself from
  // the response in a lazy initialiser. There is no effect re-seeding it, and no
  // `PATCH` can therefore be sent with a value the API never returned.
  return <EditProfileForm identity={profile.data.identity} />;
}

function EditProfileForm({ identity }: { identity: IdentityRead }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => ({
    headline: identity.headline ?? '',
    summary: identity.summary ?? '',
    location: identity.location ?? '',
    interests: journeyChips(identity.interests),
  }));
  const [interest, setInterest] = useState('');

  const save = useMutation({
    mutationFn: (body: Draft) =>
      updateIdentity({
        headline: body.headline.trim() || null,
        summary: body.summary.trim() || null,
        location: body.location.trim() || null,
        interests: body.interests,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.profile });
      router.back();
    },
  });

  const addInterest = () => {
    const value = interest.trim();
    if (!value) return;
    // A duplicate or a list past the server's cap is simply not added, rather
    // than being sent to a 422.
    const duplicate = draft.interests.some(
      (entry) => entry.toLowerCase() === value.toLowerCase(),
    );
    if (duplicate || draft.interests.length >= INTERESTS_MAX) {
      setInterest('');
      return;
    }
    setDraft({ ...draft, interests: [...draft.interests, value] });
    setInterest('');
  };

  const removeInterest = (value: string) => {
    setDraft({ ...draft, interests: draft.interests.filter((entry) => entry !== value) });
  };

  return (
    <Screen testID="edit-profile-screen">
      <View style={styles.stack}>
        <BackButton />
        <AppText variant="h1" accessibilityRole="header">
          Edit profile
        </AppText>
        <AppText variant="body" tone="secondary">
          The four fields the profile API accepts. Everything else lives in its own section screen.
        </AppText>

        {save.isError ? (
          <StatusBanner
            title="That change did not save"
            description={save.error instanceof ApiError ? save.error.message : 'Please try again.'}
            onRetry={() => save.mutate(draft)}
          />
        ) : null}

        <Card style={styles.card}>
          <TextField
            label="Headline"
            value={draft.headline}
            onChangeText={(value) => setDraft({ ...draft, headline: value })}
            placeholder="Software Engineering Intern"
            maxLength={HEADLINE_MAX}
          />
          <TextField
            label="Location"
            value={draft.location}
            onChangeText={(value) => setDraft({ ...draft, location: value })}
            placeholder="Pune"
            maxLength={LOCATION_MAX}
          />
          <TextField
            label="About"
            value={draft.summary}
            onChangeText={(value) => setDraft({ ...draft, summary: value })}
            placeholder="Two sentences on what you are working towards."
            multiline
            maxLength={SUMMARY_MAX}
          />
        </Card>

        <Card style={styles.card}>
          <AppText variant="h3" accessibilityRole="header">
            Interests
          </AppText>
          <AppText variant="small" tone="tertiary">
            {`${draft.interests.length} of ${INTERESTS_MAX} · up to ${INTEREST_MAX} characters each`}
          </AppText>

          {draft.interests.length > 0 ? (
            <View style={styles.chipRow}>
              {draft.interests.map((value) => (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${value}`}
                  hitSlop={8}
                  onPress={() => removeInterest(value)}
                  style={styles.chip}>
                  <AppText style={styles.chipLabel}>{`${value}  ×`}</AppText>
                </Pressable>
              ))}
            </View>
          ) : (
            <AppText variant="small" tone="secondary">
              No interests yet. Add the fields you want a recruiter to associate you with.
            </AppText>
          )}

          <TextField
            label="Add an interest"
            value={interest}
            onChangeText={setInterest}
            onSubmitEditing={addInterest}
            placeholder="Data Science"
            maxLength={INTEREST_MAX}
            returnKeyType="done"
          />
          <Button
            label="Add"
            variant="secondary"
            disabled={interest.trim().length === 0 || draft.interests.length >= INTERESTS_MAX}
            onPress={addInterest}
          />
        </Card>

        <Button
          label="Save changes"
          fullWidth
          loading={save.isPending}
          onPress={() => save.mutate(draft)}
          accessibilityHint="Saves your headline, location, about text, and interests."
        />
        <Button label="Cancel" variant="ghost" fullWidth onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

