/**
 * Candidate Create Story — publish a story to the tray.
 *
 * **This screen did not exist before Phase 12.** `POST /stories` had always been
 * on the server (marked [F], "no mobile caller") and `src/api/stories.ts` had
 * three read routes, so a story could be fetched and viewed but never created:
 * the tray showed whatever was already in the database and nothing else. This is
 * the caller the route was waiting for.
 *
 * The flow is the post composer's, in the same order and for the same reasons:
 * pick → validate → upload with real progress → **wait for the server's 201** →
 * refresh the tray → close. Nothing is rendered optimistically, a failed request
 * never clears the form. Publish stays tappable while the draft is incomplete so
 * the tap can say what is missing; it is disabled only while a publish is in
 * flight.
 *
 * **It reuses the existing upload and story-read architecture rather than
 * reimplementing either.** `uploadPickedMedia` carries the magic-byte sniffing,
 * the size ceiling and the server's allow-list; `queryKeys.stories` owns the
 * tray. The only thing written here is the flow.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
} from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { BackButton } from '@/components/ui/BackButton';
import { useAuth } from '@/auth/AuthContext';
import { fetchProfile } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { absoluteMediaUri, uploadPickedMedia } from '@/api/media';
import { createStory } from '@/api/stories';
import { ComposerHeader } from '@/features/composer/ComposerFields';
import { composerStyles as s } from '@/features/composer/composerStyles';
import { colors, radius, spacing } from '@/theme/tokens';
import { measureLocalFileSize } from '@/lib/localMedia';
import {
  buildStoryInput,
  canPublishStory,
  emptyStoryDraft,
  MAX_STORY_CAPTION_CHARS,
  storyCaptionLength,
  storyMediaKindFor,
  STORY_CONTENT_TYPES,
  STORY_TTL_HOURS,
  validateStoryDraft,
  type StoryDraft,
} from '@/features/stories/storyModel';

type Phase = 'editing' | 'uploading' | 'submitting';

interface Notice {
  readonly tone: 'danger' | 'warning' | 'success';
  readonly title: string;
  readonly description?: string;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export default function CandidateCreateStoryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { principal } = useAuth();

  const profileQuery = useQuery({ queryKey: queryKeys.profile, queryFn: fetchProfile });
  const [draft, setDraft] = useState<StoryDraft>(emptyStoryDraft);
  const [phase, setPhase] = useState<Phase>('editing');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [uploadFraction, setUploadFraction] = useState<number | null>(null);
  /**
   * The server's id for the file the **Upload** button already sent, keyed to
   * the exact local URI it came from. Keyed rather than a bare id: picking a
   * *different* file has to invalidate it, or Publish would attach the previous
   * file's id to a story whose caption describes the new one. A stale key
   * simply fails to match and the upload runs again.
   */
  const [uploaded, setUploaded] = useState<{ localUri: string; id: string } | null>(null);

  /**
   * A ref, not the `phase` state, because the duplicate-tap guard has to hold
   * *within* one render.
   *
   * `phase` is state: two taps in the same frame both read the old value, both
   * pass the `busy` check, and two stories are created. A ref is written
   * synchronously, so the second tap sees it and returns. The same reason
   * `usePostEngagement` carries a ref alongside its state.
   */
  const publishing = useRef(false);
  /**
   * The same within-render guard for the Upload button. `phase` is state, so a
   * fast double tap reads the old value twice and starts two uploads of the
   * same bytes; this ref is written synchronously.
   */
  const uploading = useRef(false);

  const errors = useMemo(() => validateStoryDraft(draft), [draft]);
  const busy = phase !== 'editing';
  const submittable = canPublishStory(draft) && !busy;

  const update = useCallback((patch: Partial<StoryDraft>) => {
    // Any change to the attachment — new file or none — makes a previous upload
    // irrelevant. The server id is dropped here rather than in each caller so
    // there is one place that could forget.
    if ('media' in patch) setUploaded(null);
    setDraft((current) => {
      // Picking media on a `text` story would leave the draft unpublishable: the
      // validator rejects media on `text`, so the attachment would be chosen yet
      // Publish could never fire. Flip to `announcement` (the most general
      // category) the moment media arrives, so the gate can pass.
      const next: Partial<StoryDraft> =
        patch.media && (current.contentType as string) === 'text'
          ? { ...patch, contentType: 'announcement' }
          : patch;
      return { ...current, ...next };
    });
    setNotice(null);
  }, []);

  const pick = useCallback(
    async (kind: 'image' | 'video') => {
      setNotice(null);
      const permission = await requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setNotice({
          tone: 'warning',
          title: 'Photo access is off',
          description:
            'Allow access to your photos in the device settings to attach media to a story.',
        });
        return;
      }

      const result = await launchImageLibraryAsync({
        mediaTypes: kind === 'video' ? ['videos'] : ['images'],
        allowsMultipleSelection: false,
        selectionLimit: 1,
        quality: 1,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      if (!asset) return;
      update({
        media: {
          localUri: asset.uri,
          // The picker records the choice; the server decides what the bytes are.
          kind: storyMediaKindFor(asset.mimeType),
          fileName: asset.fileName ?? (kind === 'video' ? 'Video' : 'Image'),
          // `fileSize` is optional and often absent; the real size is read from the
          // file rather than treating "unknown" as "empty".
          sizeBytes: asset.fileSize ?? measureLocalFileSize(asset.uri),
          width: asset.width,
          height: asset.height,
          mimeType: asset.mimeType ?? '',
        },
      });
    },
    [update],
  );

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home' as never);
  }, [router]);

  /**
   * The explicit **Upload** button's action: send the chosen file now, with the
   * real byte-progress bar, and keep the server's id so Publish can reference
   * it instead of uploading the same bytes a second time.
   *
   * Failure keeps the attachment and the caption exactly as they were — the
   * notice says what happened and the button simply returns to "Upload" so the
   * tap can be retried. Nothing is cleared on error anywhere in this flow.
   */
  const uploadNow = useCallback(async () => {
    const media = draft.media;
    if (!media || uploading.current || phase !== 'editing') return;
    // Already uploaded and not since replaced — nothing to do.
    if (uploaded && uploaded.localUri === media.localUri) return;

    uploading.current = true;
    setNotice(null);
    setPhase('uploading');
    setUploadFraction(0);
    try {
      const result = await uploadPickedMedia(media, (progress) => {
        setUploadFraction(progress.fraction);
      });
      setUploaded({ localUri: media.localUri, id: result.id });
      setNotice({
        tone: 'success',
        title: 'Media uploaded',
        description:
          'Your photo or video is on the server. Add a caption if you have not, then tap Publish.',
      });
    } catch (error) {
      setNotice({
        tone: 'danger',
        title: media.kind === 'video' ? 'That video did not upload' : 'That image did not upload',
        description: `${messageOf(error)} Your file is still attached — try again.`,
      });
    } finally {
      setUploadFraction(null);
      setPhase('editing');
      uploading.current = false;
    }
  }, [draft.media, phase, uploaded]);

  const publish = useCallback(async () => {
    // Two guards, for two different failures: `submittable` is the form's own
    // validity, and the ref is the same-frame duplicate tap the state cannot
    // catch. The button stays tappable while the form is incomplete so the tap
    // can explain what is missing (via `publishOrExplain`); this guard is what
    // actually blocks the request.
    if (!submittable || publishing.current) return;
    publishing.current = true;
    setNotice(null);

    try {
      let mediaId: string | null = null;
      if (draft.media) {
        const alreadyUploaded = uploaded && uploaded.localUri === draft.media.localUri;
        if (alreadyUploaded && uploaded) {
          // The Upload button already sent these exact bytes — reference the
          // id it got rather than uploading the same file twice.
          mediaId = uploaded.id;
        } else {
          setPhase('uploading');
          setUploadFraction(0);
          try {
            // The same upload the post composer uses: one request, real progress,
            // and the server's own magic-byte check as the authority.
            const result = await uploadPickedMedia(draft.media, (progress) => {
              setUploadFraction(progress.fraction);
            });
            mediaId = result.id;
            setUploaded({ localUri: draft.media.localUri, id: result.id });
          } catch (error) {
            // **The media failed.** The story was never attempted, so the caption
            // and the chosen file are all still here to retry with.
            setPhase('editing');
            setUploadFraction(null);
            setNotice({
              tone: 'danger',
              title:
                draft.media.kind === 'video'
                  ? 'That video did not upload'
                  : 'That image did not upload',
              description: `${messageOf(error)} Your story is kept — try again.`,
            });
            return;
          }
        }
      }

      setPhase('submitting');
      const input = buildStoryInput(draft, mediaId);
      if (!input) {
        setPhase('editing');
        return;
      }

      // Only now, with any media confirmed by the server, is the story sent.
      await createStory(input);

      // The tray is the one query this screen makes stale. The server has already
      // emitted `story.created`, so any *other* member's tray updates from the
      // socket; this is the author's own device, which never saw its own event.
      await queryClient.invalidateQueries({ queryKey: queryKeys.stories });
      leave();
    } catch (error) {
      // **The story failed after its media succeeded.** The distinction matters,
      // so the copy distinguishes the two. The stored media is deliberately left
      // alone: there is no orphan sweep in the media design, and inventing one
      // here would be a new mechanism with its own failure modes. Re-publishing
      // uploads again, which is honest — the user is told exactly what happened.
      setPhase('editing');
      setUploadFraction(null);
      setNotice({
        tone: 'danger',
        title: 'Your story was not published',
        description: `${messageOf(error)} Your caption is still here — try again.`,
      });
    } finally {
      // Released in `finally` so a failed attempt can be retried: only a
      // *successful* one leaves the screen, and only this guard is temporary.
      publishing.current = false;
    }
  }, [draft, leave, queryClient, submittable, uploaded]);

  /**
   * The button's tap target. When the draft is incomplete the press cannot
   * publish, so it says exactly what is missing instead of silently doing
   * nothing — a Publish control that looks dead on a phone with no visible
   * reason is the bug this replaces.
   */
  const publishOrExplain = useCallback(() => {
    if (busy) return;
    if (!submittable) {
      setNotice({
        tone: 'warning',
        title: 'Not ready to publish yet',
        description: draft.media
          ? 'Write a caption above, then tap Publish again.'
          : 'Add a photo or video, or write a caption above, then tap Publish again.',
      });
      return;
    }
    void publish();
  }, [busy, draft.media, publish, submittable]);

  const name = profileQuery.data?.identity.name ?? principal?.username ?? 'You';
  const avatarUrl = profileQuery.data?.identity.avatar_url ?? null;
  const captionLength = storyCaptionLength(draft);

  return (
    <KeyboardAvoidingView
      style={s.root}
      // iOS only: Android's window already resizes for the keyboard, and
      // applying it there would lift the publish bar twice.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}>
      <View style={s.root} testID="create-story-screen">
        {/* The Publish control lives in the header — the same proven pattern as
            Create Post — so it is always on screen. The previous bottom publish
            bar was present in the hierarchy yet never visible on device, which
            made story publishing impossible to reach. */}
        <ComposerHeader
          leading={<BackButton onPress={leave} />}
          draftLabel=""
          publishLabel={busy ? 'Working…' : 'Publish'}
          canSubmit={!busy}
          submitting={busy}
          onSubmit={publishOrExplain}
        />
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingBottom: insets.bottom + spacing.huge }]}
        keyboardShouldPersistTaps="handled">
        <View style={s.author}>
          <Avatar name={name} src={avatarUrl ? absoluteMediaUri(avatarUrl) : null} size={40} />
          <View style={s.authorText}>
            <AppText variant="body" weight="semibold">
              {name}
            </AppText>
            <AppText variant="caption" tone="tertiary">
              {`Visible to every member for ${STORY_TTL_HOURS} hours`}
            </AppText>
          </View>
        </View>

        {notice ? (
          <View
            style={[
              s.notice,
              notice.tone === 'danger'
                ? s.noticeDanger
                : notice.tone === 'success'
                  ? s.noticeSuccess
                  : s.noticeWarning,
            ]}
            accessibilityRole="alert"
            testID="create-story-notice">
            <AppText variant="small" weight="semibold" style={styles.noticeTitle}>
              {notice.title}
            </AppText>
            {notice.description ? (
              <AppText variant="small" tone="secondary">
                {notice.description}
              </AppText>
            ) : null}
          </View>
        ) : null}

        <View style={s.section}>
          <AppText variant="small" tone="tertiary" style={s.sectionLabel}>
            STORY TYPE
          </AppText>
          <View style={s.typeRow}>
            {STORY_CONTENT_TYPES.map((option) => {
              const active = draft.contentType === option.value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={option.label}
                  accessibilityHint={option.hint}
                  onPress={() => update({ contentType: option.value })}
                  style={[s.typeChip, active ? s.typeChipActive : null]}
                  testID={`create-story-type-${option.value}`}>
                  <AppText
                    variant="small"
                    weight={active ? 'semibold' : 'regular'}
                    tone={active ? 'onPrimary' : 'secondary'}
                    style={s.typeChipLabel}>
                    {option.label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
          {errors.contentType ? (
            <AppText variant="caption" style={s.fieldError}>
              {errors.contentType}
            </AppText>
          ) : null}
        </View>

        <View style={s.section}>
          <View style={s.counterRow}>
            <AppText variant="small" tone="tertiary" style={s.sectionLabel}>
              CAPTION
            </AppText>
            <AppText
              variant="caption"
              style={captionLength > MAX_STORY_CAPTION_CHARS ? s.counterOver : undefined}>
              {`${captionLength} / ${MAX_STORY_CAPTION_CHARS}`}
            </AppText>
          </View>
          <TextInput
            value={draft.caption}
            onChangeText={(caption) => update({ caption })}
            placeholder="What do you want to share?"
            placeholderTextColor={colors.colorTextTertiary}
            style={[s.input, s.textarea, errors.caption ? s.inputInvalid : null]}
            multiline
            accessibilityLabel="Story caption"
            testID="create-story-caption"
          />
          {errors.caption ? (
            <AppText variant="caption" style={s.fieldError}>
              {errors.caption}
            </AppText>
          ) : null}
        </View>

        <View style={s.section}>
          <AppText variant="small" tone="tertiary" style={s.sectionLabel}>
            MEDIA (OPTIONAL)
          </AppText>
          <View style={s.typeRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach a photo"
              accessibilityHint="Choose one image for this story"
              onPress={() => void pick('image')}
              style={s.addTile}
              testID="create-story-add-image">
              <AppIcon
                name={{ ios: 'photo', android: 'image' }}
                size={20}
                color={colors.colorTextSecondary}
              />
              <AppText variant="small" tone="secondary">
                Photo
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach a video"
              accessibilityHint="Choose one video for this story"
              onPress={() => void pick('video')}
              style={s.addTile}
              testID="create-story-add-video">
              <AppIcon
                name={{ ios: 'video', android: 'videocam' }}
                size={20}
                color={colors.colorTextSecondary}
              />
              <AppText variant="small" tone="secondary">
                Video
              </AppText>
            </Pressable>
          </View>

          {draft.media ? (
            <View style={s.uploadRow} testID="create-story-chosen-media">
              <View style={s.uploadLine}>
                <AppText variant="small" tone="secondary" numberOfLines={1} style={styles.grow}>
                  {draft.media.fileName}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Remove the attachment"
                  hitSlop={8}
                  onPress={() => {
                    update({ media: null });
                    setUploadFraction(null);
                  }}
                  testID="create-story-remove-media">
                  <AppIcon
                    name={{ ios: 'xmark.circle.fill', android: 'cancel' }}
                    size={20}
                    color={colors.colorTextTertiary}
                  />
                </Pressable>
              </View>

              {/* The explicit Upload action. It sends the file now with real
                  byte progress and keeps the server id, so Publish afterwards
                  references it instead of re-uploading the same bytes. Once the
                  same file is confirmed uploaded it becomes a status line — the
                  button does not linger as a dead second Publish. */}
              {uploaded && uploaded.localUri === draft.media.localUri ? (
                <View style={styles.uploadedRow} testID="create-story-media-uploaded">
                  <AppIcon
                    name={{ ios: 'checkmark.circle.fill', android: 'check_circle' }}
                    size={16}
                    color={colors.colorSuccess}
                  />
                  <AppText variant="caption" tone="secondary">
                    Uploaded — ready to publish
                  </AppText>
                </View>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Upload the chosen media"
                  accessibilityHint="Send the selected file to the server before publishing"
                  disabled={busy}
                  onPress={() => void uploadNow()}
                  style={[styles.uploadButton, busy ? styles.uploadButtonDisabled : null]}
                  testID="create-story-upload">
                  <AppIcon
                    name={{ ios: 'arrow.up.circle', android: 'upload' }}
                    size={18}
                    color={busy ? colors.colorTextTertiary : colors.colorPrimary}
                  />
                  <AppText
                    variant="small"
                    weight="semibold"
                    style={busy ? styles.uploadLabelDisabled : styles.uploadLabel}>
                    {uploadFraction !== null
                      ? `Uploading… ${Math.round(uploadFraction * 100)}%`
                      : 'Upload'}
                  </AppText>
                </Pressable>
              )}
            </View>
          ) : null}

          {!submittable && !busy && !notice ? (
            <AppText variant="caption" tone="secondary">
              {draft.media
                ? 'Write a caption above to enable Publish.'
                : 'Add a photo or video, or write a caption above, to enable Publish.'}
            </AppText>
          ) : null}

          {uploadFraction !== null ? (
            <View style={s.uploadRow} testID="create-story-upload-progress">
              {/* A real progress track, not a spinner: the fraction comes from the
                  native upload task's own byte counter, so it moves because bytes
                  moved. */}
              <View style={s.progressTrack}>
                <View
                  style={[s.progressFill, { width: `${Math.round(uploadFraction * 100)}%` }]}
                />
              </View>
              <AppText variant="caption" tone="tertiary">
                {`Uploading… ${Math.round(uploadFraction * 100)}%`}
              </AppText>
            </View>
          ) : null}
        </View>
      </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

/** Styles the shared composer sheet does not already define. */
const styles = {
  /** A file name that truncates rather than pushing its row's sibling off-screen. */
  grow: { flex: 1 },
  /** The notice's heading, so the message under it is never mistaken for it. */
  noticeTitle: { fontWeight: '600' as const },
  /**
   * The explicit Upload control: an inline secondary action, so it clears the
   * 44px touch minimum and spans the row — impossible to miss or mis-tap.
   */
  uploadButton: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimarySubtle,
    borderRadius: radius.control,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'center',
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  uploadButtonDisabled: { backgroundColor: colors.colorBgMuted },
  uploadLabel: { color: colors.colorPrimary },
  uploadLabelDisabled: { color: colors.colorTextTertiary },
  /** Post-upload confirmation: icon plus words, never colour alone. */
  uploadedRow: { alignItems: 'center', flexDirection: 'row', gap: spacing.xs, minHeight: 24 },
} as const;