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
 * Replace and Remove both talk to the server, so a refresh shows the truth. A
 * failed upload leaves the step as it was, with the server's message and a retry.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { deleteProfilePhoto, uploadProfilePhoto } from '@/api/media';
import { queryKeys } from '@/api/queryKeys';
import { fetchMe } from '@/api/users';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { StepBody } from '@/features/onboarding/StepBody';
import { stepStyles } from '@/features/onboarding/onboardingStyles';
import { pickPhotoFromLibrary, takePhotoWithCamera, type PickResult } from '@/features/onboarding/photoPicker';
import { colors, radius, spacing } from '@/theme/tokens';
import { env } from '@/lib/env';

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

  // The stored URL is the only source of truth for "is there a photo". A local
  // preview never sets it, so a refresh cannot show a picture the server lost.
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [fraction, setFraction] = useState<number | null>(null);

  const account = me.data;
  const savedUrl = account?.avatar_url ?? null;
  const shown = previewUri ?? (savedUrl ? avatarUri(savedUrl) : null);

  const upload = useMutation({
    mutationFn: (localUri: string) =>
      uploadProfilePhoto(
        {
          localUri,
          width: 0,
          height: 0,
          mimeType: 'image/jpeg',
          fileName: 'profile-photo.jpg',
          sizeBytes: 0,
        },
        (progress) => setFraction(progress.fraction),
      ),
    onSuccess: (updated) => {
      // Only now is the photo real. The preview is dropped so the circle shows the
      // stored URL — which is exactly what a refresh will show.
      setPreviewUri(null);
      setProblem(null);
      setFraction(null);
      if (updated) queryClient.setQueryData(queryKeys.me, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
    onError: (error: unknown) => {
      setFraction(null);
      setPreviewUri(null);
      setProblem(error instanceof ApiError ? error.message : 'The upload did not finish. Try again.');
    },
  });

  const remove = useMutation({
    mutationFn: deleteProfilePhoto,
    onSuccess: (updated) => {
      setPreviewUri(null);
      setProblem(null);
      if (updated) queryClient.setQueryData(queryKeys.me, updated);
      void queryClient.invalidateQueries({ queryKey: queryKeys.me });
    },
    onError: (error: unknown) => {
      setProblem(
        error instanceof ApiError ? error.message : 'The photo could not be removed. Try again.',
      );
    },
  });

  const handle = (result: PickResult) => {
    setProblem(null);
    if (result.status === 'cancelled') return;
    if (result.status === 'picked') {
      setPreviewUri(result.media.localUri);
      upload.mutate(result.media.localUri);
      return;
    }
    setProblem(result.message);
  };
  const busyNow = busy || upload.isPending || remove.isPending;

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
          {shown ? (
            <Image
              source={{ uri: shown }}
              style={styles.photo}
              accessibilityLabel="Your profile photo"
            />
          ) : (
            <View style={[styles.photo, styles.placeholder]}>
              <AppText variant="h2" tone="tertiary">
                {(account?.name ?? '?').slice(0, 1).toUpperCase()}
              </AppText>
            </View>
          )}
          <View style={styles.photoCopy}>
            <AppText variant="label" tone="secondary">
              {upload.isPending
                ? `Uploading${fraction !== null ? ` ${Math.round(fraction * 100)}%` : '…'}`
                : shown
                  ? 'Photo added'
                  : 'No photo yet'}
            </AppText>
            {upload.isPending ? (
              <AppText variant="caption" tone="tertiary">
                Please wait — do not close the app.
              </AppText>
            ) : null}
            {!upload.isPending && shown ? (
              <AppText variant="caption" tone="tertiary">
                Saved to your profile. It will still be here after a refresh.
              </AppText>
            ) : null}
            {!upload.isPending && !shown ? (
              <AppText variant="caption" tone="tertiary">
                Choose a picture from your gallery, or take one with the camera.
              </AppText>
            ) : null}
          </View>
        </View>

        <Button
          label={shown ? 'Replace photo' : 'Add profile photo'}
          variant="secondary"
          fullWidth
          loading={upload.isPending}
          onPress={() => void pickPhotoFromLibrary().then(handle)}
        />
        <Button
          label="Take a photo"
          variant="ghost"
          fullWidth
          disabled={upload.isPending}
          onPress={() => void takePhotoWithCamera().then(handle)}
        />
        {shown ? (
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

/** Joins a served path onto the API base, leaving an absolute URL alone. */
function avatarUri(url: string): string {
  if (url.startsWith('http')) return url;
  return `${env.apiBaseUrl}${url}`;
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
