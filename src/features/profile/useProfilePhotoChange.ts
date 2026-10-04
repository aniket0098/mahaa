/**
 * `useProfilePhotoChange` — the **one** way this app changes a profile photo.
 *
 * The onboarding photo step and the profile header both need the same five steps
 * in the same order, and they used to each own a copy of them:
 *
 *   pick  →  upload  →  point the account at it  →  reconcile the caches  →  show it
 *
 * Two copies is how the two screens came to disagree: the step kept a local
 * preview it never promoted, and the header had no way to change the photo at all.
 * Everything lives here instead, and a caller gets a typed outcome rather than a
 * promise that resolves to nothing.
 *
 * **The upload response is never written into a cache.** `PUT /users/me/photo`
 * returns a `MediaRead` (§11.2), which has no `avatar_url`. Writing that into
 * `queryKeys.me` cached a media row under the account's key and blanked every
 * avatar in the app — the bug this module exists to make impossible. The account
 * is re-read from the server, which is the only place `avatar_url` exists.
 *
 * **It resolves only once the avatar is readable.** The two queries that render
 * the avatar — `users/me` and the `profile` aggregate — are fetched before the
 * promise settles, so a caller that navigates on success cannot land on a screen
 * that still shows the previous face. A read that fails does not fail the upload:
 * the bytes and the pointer genuinely changed, and the screen reports its own load
 * error rather than a false upload failure.
 *
 * **One upload at a time.** `running` is a ref, not state, because a double tap
 * happens before React re-renders and `isPending` would still be false.
 */

import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { invalidateAfterAvatarChange } from '@/api/avatarSync';
import { ApiError } from '@/api/errors';
import { uploadProfilePhoto, type MediaRead, type PickedMedia } from '@/api/media';
import { fetchProfile } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { fetchMe } from '@/api/users';
import { pickPhotoFromLibrary, takePhotoWithCamera } from '@/lib/photoPicker';

/** Which picker to open. The camera is not available in a browser. */
export type PhotoSource = 'library' | 'camera';

/** What happened. `cancelled` is a person changing their mind, not a failure. */
export type PhotoChangeOutcome =
  | { status: 'saved'; media: MediaRead }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

export interface ProfilePhotoChange {
  /** Pick, upload, and point the account at the result. Never throws. */
  changePhoto: (source?: PhotoSource) => Promise<PhotoChangeOutcome>;
  /** True while the upload is on the wire — drives the spinner and the disable. */
  isUploading: boolean;
  /** True from the moment the picker opens until the upload settles. */
  isBusy: boolean;
  /** The server's own message when something failed, else null. */
  problem: string | null;
  /** The local file being uploaded, so a caller can show it as a *preview*. */
  previewUri: string | null;
  /** Real bytes-sent fraction from the upload task, 0..1, or null when idle. */
  fraction: number | null;
  dismissProblem: () => void;
}

function messageFor(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The photo could not be saved. Check your connection and try again.';
}

export function useProfilePhotoChange(): ProfilePhotoChange {
  const queryClient = useQueryClient();
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [fraction, setFraction] = useState<number | null>(null);
  const running = useRef(false);

  const upload = useMutation({
    mutationFn: (picked: PickedMedia) =>
      // The progress callback is the transport's own byte count, so the number a
      // screen shows is real on both the native task and the browser's XHR.
      uploadProfilePhoto(picked, (progress) => setFraction(progress.fraction)),
    onSuccess: async () => {
      // The preview is dropped only now: until the server has the photo, the
      // local file is the only thing that is definitely on screen, and pretending
      // otherwise is exactly how a lost upload looks like a successful one.
      setPreviewUri(null);
      setFraction(null);
      invalidateAfterAvatarChange(queryClient);

      // Await the two reads that actually render an avatar, so this promise does
      // not settle while `users/me` and `profile` still describe the old one.
      await Promise.allSettled([
        queryClient.fetchQuery({ queryKey: queryKeys.me, queryFn: fetchMe, staleTime: 0 }),
        queryClient.fetchQuery({
          queryKey: queryKeys.profile,
          queryFn: fetchProfile,
          staleTime: 0,
        }),
      ]);
    },
    onError: (error: unknown) => {
      setPreviewUri(null);
      setFraction(null);
      setProblem(messageFor(error));
    },
  });

  const changePhoto = useCallback(
    async (source: PhotoSource = 'library'): Promise<PhotoChangeOutcome> => {
      if (running.current) return { status: 'cancelled' };
      running.current = true;
      setProblem(null);
      setFraction(null);
      setPicking(true);

      try {
        const picked =
          source === 'camera' ? await takePhotoWithCamera() : await pickPhotoFromLibrary();
        setPicking(false);

        if (picked.status === 'cancelled') return { status: 'cancelled' };
        if (picked.status !== 'picked') {
          setProblem(picked.message);
          return { status: 'failed', message: picked.message };
        }

        setPreviewUri(picked.media.localUri);
        const media = await upload.mutateAsync(picked.media);
        return { status: 'saved', media };
      } catch (error: unknown) {
        // `mutateAsync` rejects as well as running `onError`; this branch is what
        // keeps a picker-level throw from escaping as an unhandled rejection.
        setPicking(false);
        setPreviewUri(null);
        setFraction(null);
        const message = messageFor(error);
        setProblem(message);
        return { status: 'failed', message };
      } finally {
        running.current = false;
      }
    },
    [upload],
  );

  return {
    changePhoto,
    isUploading: upload.isPending,
    isBusy: picking || upload.isPending,
    problem,
    previewUri,
    fraction,
    dismissProblem: () => setProblem(null),
  };
}
