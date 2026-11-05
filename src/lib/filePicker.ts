import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';

import type { PickedMedia } from '@/api/media';

export type PickResult =
  | { status: 'picked'; media: PickedMedia }
  | { status: 'cancelled' }
  | { status: 'permission-denied'; message: string }
  | { status: 'too-large'; message: string }
  | { status: 'failed'; message: string };

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

function tooLarge(size: number, limit: number, kind: string): PickResult {
  return { status: 'too-large', message: `That ${kind} is too large. Maximum ${Math.round(limit / (1024 * 1024))} MB.` };
}

export async function pickImage(): Promise<PickResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    return { status: 'permission-denied', message: 'Photo library access is required to pick an image.' };
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 1,
    allowsEditing: false,
  });
  if (result.canceled || !result.assets?.length) return { status: 'cancelled' };
  const asset = result.assets[0];
  const size = asset.fileSize ?? 0;
  if (size > MAX_IMAGE_BYTES) return tooLarge(size, MAX_IMAGE_BYTES, 'image');
  const media: PickedMedia = {
    localUri: asset.uri,
    kind: 'image',
    width: asset.width ?? null,
    height: asset.height ?? null,
    mimeType: asset.mimeType ?? 'image/jpeg',
    fileName: asset.fileName ?? 'image.jpg',
    sizeBytes: size,
  };
  return { status: 'picked', media };
}

export async function pickVideo(): Promise<PickResult> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    return { status: 'permission-denied', message: 'Photo library access is required to pick a video.' };
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['videos'],
    quality: 1,
  });
  if (result.canceled || !result.assets?.length) return { status: 'cancelled' };
  const asset = result.assets[0];
  const size = asset.fileSize ?? 0;
  if (size > MAX_IMAGE_BYTES) return tooLarge(size, MAX_IMAGE_BYTES, 'video');
  const media: PickedMedia = {
    localUri: asset.uri,
    kind: 'video',
    width: asset.width ?? null,
    height: asset.height ?? null,
    mimeType: asset.mimeType ?? 'video/mp4',
    fileName: asset.fileName ?? 'video.mp4',
    sizeBytes: size,
  };
  return { status: 'picked', media };
}

export async function pickDocument(): Promise<PickResult> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ['application/pdf'],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return { status: 'cancelled' };
  const asset = result.assets?.[0];
  if (!asset) return { status: 'cancelled' };
  const size = asset.size ?? 0;
  if (size > MAX_DOCUMENT_BYTES) return tooLarge(size, MAX_DOCUMENT_BYTES, 'document');
  const media: PickedMedia = {
    localUri: asset.uri,
    kind: 'document',
    width: null,
    height: null,
    mimeType: asset.mimeType ?? 'application/pdf',
    fileName: asset.name ?? 'document.pdf',
    sizeBytes: size,
  };
  return { status: 'picked', media };
}