/**
 * Learning Hub — Upload section.
 *
 * A real media library: pick an image/video/document, validate against the
 * server's published limits, upload with real byte progress, and manage the
 * caller's own uploads (view + delete). Nothing here is invented — every byte
 * goes through `POST /media` and the list comes from `GET /media/mine`.
 */

import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

import { queryKeys } from '@/api/queryKeys';
import {
  absoluteMediaUri,
  authenticatedImageSource,
  deleteMedia,
  fetchMediaLimits,
  fetchMyUploads,
  uploadPickedMedia,
  type MediaRead,
} from '@/api/media';
import { pickDocument, pickImage, pickVideo, type PickResult } from '@/lib/filePicker';
import { colors, spacing } from '@/theme/tokens';

const KIND_LABEL: Record<string, string> = {
  image: 'Image',
  video: 'Video',
  document: 'Document',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function LearningHubUploadScreen() {
  const queryClient = useQueryClient();

  const limitsQuery = useQuery({
    queryKey: queryKeys.mediaLimits,
    queryFn: fetchMediaLimits,
    staleTime: 60_000,
  });

  const uploadsQuery = useQuery({
    queryKey: queryKeys.myUploads,
    queryFn: fetchMyUploads,
    staleTime: 30_000,
  });

  const [selected, setSelected] = useState<PickResult | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (selected?.status !== 'picked') throw new Error('No file selected');
      setProgress(0);
      const result = await uploadPickedMedia(selected.media, (p) => setProgress(p.fraction));
      return result;
    },
    onSuccess: () => {
      setProgress(null);
      setSelected(null);
      setUploadError(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.myUploads });
    },
    onError: (err: unknown) => {
      setProgress(null);
      setUploadError(err instanceof Error ? err.message : 'Upload failed.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMedia(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.myUploads });
    },
  });

  async function handlePick(kind: 'image' | 'video' | 'document') {
    setUploadError(null);
    let result: PickResult;
    if (kind === 'image') result = await pickImage();
    else if (kind === 'video') result = await pickVideo();
    else result = await pickDocument();
    setSelected(result);
    if (result.status === 'too-large') setUploadError(result.message);
    if (result.status === 'permission-denied') setUploadError(result.message);
    if (result.status === 'failed') setUploadError(result.message);
  }

  const limits = limitsQuery.data;
  const uploads = uploadsQuery.data ?? [];

  return (
    <Screen testID="learn-upload-screen">
      <BackButton label="Back" />

      <AppText variant="h2" tone="primary" weight="semibold" style={styles.header}>
        Upload
      </AppText>

      <Card style={styles.section}>
        <AppText variant="body" weight="semibold" style={styles.sectionTitle}>
          Supported types
        </AppText>
        {limitsQuery.isLoading ? (
          <AppText variant="small" tone="secondary">Loading limits…</AppText>
        ) : limitsQuery.isError ? (
          <StatusBanner
            title="Could not load upload limits"
            description="The server's limits are unavailable. Try again."
            onRetry={() => limitsQuery.refetch()}
          />
        ) : limits ? (
          <View style={styles.limits}>
            <AppText variant="small" tone="secondary">
              Images: {limits.image_mime_types.join(', ')} (max {formatBytes(limits.max_bytes)})
            </AppText>
            <AppText variant="small" tone="secondary">
              Videos: {limits.video_mime_types.join(', ')} (max {formatBytes(limits.max_bytes)})
            </AppText>
            <AppText variant="small" tone="secondary">
              Documents: {limits.document_mime_types.join(', ')} (max {formatBytes(limits.max_document_bytes)})
            </AppText>
            <AppText variant="small" tone="secondary">
              Up to {limits.max_items_per_post} items per post
            </AppText>
          </View>
        ) : null}
      </Card>
      {/* Upload panel */}
      <Card style={styles.section}>
        <AppText variant="body" weight="semibold" style={styles.sectionTitle}>
          Add a file
        </AppText>
        <View style={styles.pickRow}>
          <Button label="Image" variant="secondary" onPress={() => handlePick('image')} />
          <Button label="Video" variant="secondary" onPress={() => handlePick('video')} />
          <Button label="Document" variant="secondary" onPress={() => handlePick('document')} />
        </View>

        {selected?.status === 'picked' ? (
          <View style={styles.selected}>
            <AppText variant="small" tone="primary">
              {selected.media.fileName} ({formatBytes(selected.media.sizeBytes)}) — {KIND_LABEL[selected.media.kind] ?? selected.media.kind}
            </AppText>
          </View>
        ) : null}

        {uploadError ? (
          <StatusBanner title="Upload problem" description={uploadError} />
        ) : null}

        {progress !== null ? (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        ) : null}

        <Button
          label={uploadMutation.isPending ? 'Uploading…' : 'Upload'}
          variant="primary"
          fullWidth
          loading={uploadMutation.isPending}
          disabled={selected?.status !== 'picked' || uploadMutation.isPending}
          onPress={() => uploadMutation.mutate()}
        />
      </Card>

      {/* My uploads */}
      <Card style={styles.section}>
        <AppText variant="body" weight="semibold" style={styles.sectionTitle}>
          My uploads
        </AppText>
        {uploadsQuery.isLoading ? (
          <AppText variant="small" tone="secondary">Loading…</AppText>
        ) : uploadsQuery.isError ? (
          <StatusBanner
            title="Could not load uploads"
            description="Try again."
            onRetry={() => uploadsQuery.refetch()}
          />
        ) : uploads.length === 0 ? (
          <AppText variant="small" tone="secondary">No uploads yet.</AppText>
        ) : (
          <View style={styles.list}>
            {uploads.map((u: MediaRead) => (
              <View key={u.id} style={styles.row}>
                {u.kind === 'image' ? (
                  <Image
                    source={authenticatedImageSource(absoluteMediaUri(u.served_at))}
                    style={styles.thumb}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.thumbPlaceholder}>
                    <AppText variant="small" tone="secondary">{KIND_LABEL[u.kind] ?? u.kind}</AppText>
                  </View>
                )}
                <View style={styles.rowMeta}>
                  <AppText variant="small" tone="primary" numberOfLines={1}>
                    {KIND_LABEL[u.kind] ?? u.kind} · {formatBytes(u.size_bytes)}
                  </AppText>
                  <AppText variant="small" tone="secondary" numberOfLines={1}>
                    {u.mime_type}
                  </AppText>
                </View>
                <Button
                  label="Delete"
                  variant="danger"
                  size="md"
                  loading={deleteMutation.isPending && deleteMutation.variables === u.id}
                  disabled={deleteMutation.isPending}
                  onPress={() => deleteMutation.mutate(u.id)}
                />
              </View>
            ))}
          </View>
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.md, marginTop: spacing.sm },
  section: { marginBottom: spacing.md },
  sectionTitle: { marginBottom: spacing.sm },
  limits: { gap: spacing.xs },
  pickRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  selected: { marginBottom: spacing.sm },
  progressTrack: {
    height: 6,
    backgroundColor: colors.colorBgMuted,
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  progressFill: { height: '100%', backgroundColor: colors.colorPrimary },
  list: { gap: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumb: { width: 48, height: 48, borderRadius: 8 },
  thumbPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: colors.colorBgMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMeta: { flex: 1, gap: 2 },
});
