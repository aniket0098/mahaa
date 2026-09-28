/**
 * Image picking for the profile photo, wrapped in one module.
 *
 * `expo-image-picker` is behind this function for two reasons. First, the picker
 * needs a media-library permission, and a denied permission is a normal outcome
 * with a specific remedy — so the caller gets a typed result describing *why*
 * nothing was picked rather than an exception it has to guess at. Second, every
 * consumer then shares one set of rules: images only, a size ceiling, and a
 * request that degrades to a plain "cancelled" when the person backs out.
 *
 * **Nothing here uploads.** It returns a local `file://` handle. The upload is a
 * separate, explicit step (`uploadProfilePhoto`), so a picked file can never be
 * mistaken for a stored one — the failure this design is most careful about.
 */

import * as ImagePicker from 'expo-image-picker';

import type { PickedMedia } from '@/api/media';

/** Mirrors the server's `max_bytes`; checked before uploading to save the round trip. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export type PickResult =
  | { status: 'picked'; media: PickedMedia }
  /** The person dismissed the picker. Not an error and not worth a message. */
  | { status: 'cancelled' }
  | { status: 'permission-denied'; message: string }
  | { status: 'too-large'; message: string }
  | { status: 'failed'; message: string };

function describe(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'The photo could not be selected. Please try again.';
}

/** Opens the gallery. Never throws; every outcome is a typed result. */
export async function pickPhotoFromLibrary(): Promise<PickResult> {
  try {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return {
        status: 'permission-denied',
        message:
          'Photo access is off for this app. Enable it in your device settings to add a profile photo, or continue without one.',
      };
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      // Not asked for here: the upload is the only thing that needs them.
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled) return { status: 'cancelled' };

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return { status: 'failed', message: 'No image was returned by the picker.' };
    }
    if (typeof asset.fileSize === 'number' && asset.fileSize > MAX_PHOTO_BYTES) {
      const mb = Math.round(MAX_PHOTO_BYTES / (1024 * 1024));
      return {
        status: 'too-large',
        message: `That image is larger than ${mb} MB. Choose a smaller one, or continue without a photo.`,
      };
    }

    return {
      status: 'picked',
      media: {
        localUri: asset.uri,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        // A real mime is required by the upload endpoint; `image/jpeg` is what the
        // picker produces for a still photo, and it is always accepted.
        mimeType: asset.mimeType ?? 'image/jpeg',
        fileName: asset.fileName ?? `profile-photo-${Date.now()}.jpg`,
        sizeBytes: asset.fileSize ?? 0,
      },
    };
  } catch (error) {
    return { status: 'failed', message: describe(error) };
  }
}

/** Opens the camera. Falls back to a typed failure where the device has no camera. */
export async function takePhotoWithCamera(): Promise<PickResult> {
  try {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return {
        status: 'permission-denied',
        message:
          'Camera access is off for this app. Enable it in your device settings to take a photo, or choose one from your gallery.',
      };
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });

    if (result.canceled) return { status: 'cancelled' };

    const asset = result.assets?.[0];
    if (!asset?.uri) {
      return { status: 'failed', message: 'No image was returned by the camera.' };
    }

    return {
      status: 'picked',
      media: {
        localUri: asset.uri,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        mimeType: asset.mimeType ?? 'image/jpeg',
        fileName: asset.fileName ?? `profile-photo-${Date.now()}.jpg`,
        sizeBytes: asset.fileSize ?? 0,
      },
    };
  } catch (error) {
    return { status: 'failed', message: describe(error) };
  }
}