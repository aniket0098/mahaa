/**
 * The profile photo step. Optional, so Skip is offered and Continue is always
 * available — a person with no photo is a normal, complete account, and a wizard
 * that traps them over a cosmetic field is a broken wizard.
 *
 * Three states, kept visibly distinct because collapsing them is how a fake
 * success gets shipped:
 *
 * - **no photo** — an initials placeholder, never an image;
 * - **uploading** — the local `file://` preview, clearly a preview;
 * - **stored** — only after `PUT /users/me/photo` resolves, the server's
 *   `avatar_url`. The preview is not promoted to "saved" on optimism.
 *
 * The pick, upload and reconcile sequence is not written here: it is
 * {@link useProfilePhotoChange}, the same function the profile header's edit
 * control calls, so the two screens cannot drift into two different ideas of when
 * a photo is saved. This step supplies the framing (Skip, progress copy, Remove)
 * and the hook supplies the behaviour.
 *
 * **The stored photo is fetched with the bearer token.** It is served from
 * `GET /media/{id}`, which is uploader-only (§11.5), so it goes through
 * {@link authenticatedImageSource} exactly as the shared `Avatar` does. It used to
 * be a bare `react-native` `<Image source={{uri}}>`, which sends no
 * `Authorization` header — the upload succeeded, and the step then rendered a 401
 * as a blank circle. The local preview is the one image that needs no token,
 * because it is a `file://`/`blob:` handle the device can already read.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/errors';
import {
  absoluteMediaUri,
  authenticatedImageSource,
  deleteProfilePhoto,
} from '@/api/media';
import { invalidateAfterAvatarChange } from '@/api/avatarSync';
import { queryKeys } from '@/api/queryKeys';
import { fetchMe } from '@/api/users';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { StepBody } from '@/features/onboarding/StepBody';
import { stepStyles } from '@/features/onboarding/onboardingStyles';
import { useProfilePhotoChange } from '@/features/profile/useProfilePhotoChange';
import { colors, radius, spacing } from '@/theme/tokens';

/** Matches the placeholder circle, so swapping in a photo does not resize it. */
const PHOTO_SIZE = 120;

export interface PhotoStepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export function PhotoStep({ onNext, busy, canGoBack, onBack }: PhotoStepProps) {
  const queryClient = useQueryClient();
  const me = useQuery({ queryKey: queryKeys.me, queryFn: fetchMe });

  /**
   * The one implementation of "change my photo", shared with the profile header's
   * edit control. This step used to own a private copy of the upload **and** pass
   * it a hardcoded `mimeType: 'image/jpeg'` with zeroed dimensions — discarding
   * the real metadata the picker had just reported, which is what the server
   * cross-checks a `Content-Type` against.
   */
  const photo = useProfilePhotoChange();

  /**
   * The stored URL is the only source of truth for "is there a photo". A local
   * preview never replaces it, so a refresh cannot show a picture the server lost.
   */
  const savedUrl = me.data?.avatar_url ?? null;
  // Resolved by the one media helper, so this screen cannot disagree with the
  // post cards or the Profile header about what the same path means.
  const stored = savedUrl ? absoluteMediaUri(savedUrl) : null;

  /**
   * The local file preview, while and only while the upload is in flight.
   *
   * A `file://`/`blob:` handle needs no token; the stored asset does, because
   * `GET /media/{id}` is uploader-only. Reading it with `authenticatedImageSource`
   * is what makes the saved photo actually appear on this step — using a bare
   * `<Image source={{ uri }}>` here sent no `Authorization` header, so the upload
   * succeeded and the step rendered a 401 as an empty circle.
   */
  const source = photo.previewUri
    ? { uri: photo.previewUri }
    : stored
      ? authenticatedImageSource(stored)
      : null;

  const [removeProblem, setRemoveProblem] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: deleteProfilePhoto,
    onSuccess: () => {
      setRemoveProblem(null);
      // Same reconciliation as an upload: a removal has to clear the avatar
      // everywhere too, or the deleted photo survives in every cached surface.
      invalidateAfterAvatarChange(queryClient);
    },
    onError: (error: unknown) => {
      setRemoveProblem(
        error instanceof ApiError ? error.message : 'The photo could not be removed. Try again.',
      );
    },
  });

  const problem = removeProblem ?? photo.problem;
  /*
   * Continue and Skip are both disabled while the photo is being written. That is
   * the whole of "the step must not navigate before the avatar operation has
   * completed": `StepBody` disables its primary button on `loading`, so there is
   * no path from this screen to Photo → Finish → Home while `PUT /users/me/photo`
   * is still in flight, and no way to leave having shown a preview the server
   * never received.
   */
  const busyNow = busy || photo.isBusy || remove.isPending;

  return (
    <StepBody
      // No save: the photo is stored by the time this is reachable, so Continue
      // only moves on. It is never gated on a photo existing.
      onNext={() => onNext()}
      ready
      busy={busyNow}
      canGoBack={canGoBack}
      onBack={onBack}
      onSkip={() => onNext()}
      skipLabel="Skip for now"
      nextLabel="Continue">
      {problem ? <StatusBanner title="Photo" description={problem} /> : null}
      {me.isError ? (
        <StatusBanner
          title="Your account did not load"
          description="You can still skip this step and add a photo later."
        />
      ) : null}

      <Card style={stepStyles.card}>
        <AppText variant="h3" accessibilityRole="header">
          Profile photo
        </AppText>
        <AppText variant="small" tone="tertiary">
          Optional. A photo helps people recognise you, but you can finish onboarding without one
          and add it later from your profile.
        </AppText>

        <View style={styles.photoRow}>
          {source ? (
            <Image
              source={source}
              style={styles.photo}
              contentFit="cover"
              accessibilityLabel="Your profile photo"
            />
          ) : (
            <View style={[styles.photo, styles.placeholder]}>
              <AppText variant="h2" tone="tertiary">
                {(me.data?.name ?? '?').slice(0, 1).toUpperCase()}
              </AppText>
            </View>
          )}
          <View style={styles.photoCopy}>
            <AppText variant="label" tone="secondary">
              {photo.isBusy || remove.isPending
                ? photo.fraction !== null
                  ? `Uploading ${Math.round(photo.fraction * 100)}%`
                  : 'Uploading…'
                : stored
                  ? 'Photo added'
                  : 'No photo yet'}
            </AppText>
            {photo.isUploading ? (
              <AppText variant="caption" tone="tertiary">
                Please wait — do not close the app.
              </AppText>
            ) : null}
            {!photo.isBusy && stored ? (
              <AppText variant="caption" tone="tertiary">
                Saved to your profile. It will still be here after a refresh.
              </AppText>
            ) : null}
            {!photo.isBusy && !stored ? (
              <AppText variant="caption" tone="tertiary">
                Choose a picture from your gallery, or take one with the camera.
              </AppText>
            ) : null}
          </View>
        </View>

        <Button
          label={stored ? 'Replace photo' : 'Add profile photo'}
          variant="secondary"
          fullWidth
          loading={photo.isBusy}
          onPress={() => void photo.changePhoto('library')}
        />
        <Button
          label="Take a photo"
          variant="ghost"
          fullWidth
          disabled={photo.isBusy}
          onPress={() => void photo.changePhoto('camera')}
        />
        {stored ? (
          <Button
            label="Remove photo"
            variant="ghost"
            fullWidth
            loading={remove.isPending}
            onPress={() => remove.mutate()}
          />
        ) : null}
      </Card>
    </StepBody>
  );
}

const styles = StyleSheet.create({
  photoRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  photo: {
    borderRadius: radius.full,
    height: PHOTO_SIZE,
    width: PHOTO_SIZE,
  },
  placeholder: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    justifyContent: 'center',
  },
  photoCopy: { flex: 1, gap: 2 },
});
