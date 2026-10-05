/**
 * Candidate Add Post — the real composer.
 *
 * Replaces the StageScreen notice that stood here while there was no posts API.
 * The flow is the honest one, in order: choose a type → type content → pick
 * images → validate → upload with real progress → **wait for the server's 201** →
 * refresh the feed → close.
 *
 * Three rules this screen is built around:
 *
 *  - **Nothing is published optimistically.** The post reaches the feed only
 *    after `POST /posts` has answered. Before that the draft is kept, so a
 *    failure loses nothing.
 *  - **A failed request never clears the form.** Caption, images, and every
 *    typed field survive, and the draft file is still on disk.
 *  - **Leaving with work in progress asks first.** An unfinished post is never
 *    discarded silently.
 *
 * The rules themselves (what is valid, what may be submitted, what the request
 * body looks like) live in `composerModel.ts` and are unit tested; this file is
 * the wiring.
 *
 * **One optional query param: `?type=`.** Home's create chips pass the type they
 * were tapped, so tapping "Project" opens a project draft rather than making the
 * user choose again. It is read once, as the draft's initial value, and validated
 * against `COMPOSER_TYPES`; with no param the screen behaves exactly as before.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { launchImageLibraryAsync, requestMediaLibraryPermissionsAsync } from 'expo-image-picker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth/AuthContext';
import { fetchProfile } from '@/api/profile';
import { createPost } from '@/api/posts';
import type { FeedPost } from '@/features/feed/feedModel';
import { fetchMediaLimits, primeMediaAuth, uploadPickedMedia, type MediaKind } from '@/api/media';
import { queryKeys } from '@/api/queryKeys';
import { colors, spacing } from '@/theme/tokens';
import { clearDraft, loadDraft, saveDraft } from '@/lib/draftStore';
import { composerStyles as s } from '@/features/composer/composerStyles';
import {
  AuthorRow,
  CaptionField,
  ComposerHeader,
  Field,
  ImageGrid,
  Notice,
  TypeSelector,
  UploadList,
  type NoticeTone,
} from '@/features/composer/ComposerFields';
import {
  buildCreateInput,
  canSubmit,
  acceptsMedia,
  COMPOSER_TYPES,
  emptyDraft,
  initialSlots,
  isDirty,
  mediaForType,
  mimeTypeFromName,
  remainingMediaSlots,
  validateDraft,
  validatePickedMedia,
  withStatus,
  type ComposerType,
  type Draft,
  type UploadSlot,
} from '@/features/composer/composerModel';
import { measureLocalFileSize } from '@/lib/localMedia';

type Phase = 'editing' | 'uploading' | 'submitting';

interface NoticeState {
  tone: NoticeTone;
  title: string;
  description?: string;
}

/** The server's published limits, or the documented defaults while it loads. */
function toComposerLimits(
  limits: Awaited<ReturnType<typeof fetchMediaLimits>> | undefined,
) {
  return {
    maxBodyChars: limits?.max_body_chars ?? 5000,
    maxItems: limits?.max_items_per_post ?? 10,
    maxImageBytes: 8 * 1024 * 1024,
    imageMimeTypes: limits?.image_mime_types ?? ['image/jpeg', 'image/png', 'image/webp'],
    // Both ceilings come from `GET /media` so a limit change never needs a
    // client release. The defaults are only what shows for the moment before
    // that request answers.
    maxVideoBytes: limits?.max_bytes ?? 10 * 1024 * 1024,
    videoMimeTypes: limits?.video_mime_types ?? ['video/mp4', 'video/quicktime'],
    videoDurationEnforced: limits?.video_duration_enforced ?? false,
  };
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong.';
}

export default function CandidateAddPostScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { principal } = useAuth();
  const userId = principal?.id ?? null;

  /**
   * The type Home asked for, if it asked for one.
   *
   * **Read once, as the draft's initial value, not as a live input.** An effect
   * that re-applied it would overwrite a type the user changed by hand, because
   * the param does not change while the screen stays mounted.
   *
   * `COMPOSER_TYPES` is the authority: a value that is not one of the composer's
   * own types falls back to the default, so a hand-edited URL cannot reach a
   * branch with no fields behind it.
   */
  const { type: typeParam } = useLocalSearchParams<{ type?: string | string[] }>();
  const requestedType = useMemo<ComposerType>(() => {
    const value = Array.isArray(typeParam) ? typeParam[0] : typeParam;
    const match = COMPOSER_TYPES.find((option) => option.value === value);
    return match?.value ?? emptyDraft().type;
  }, [typeParam]);

  const profileQuery = useQuery({ queryKey: queryKeys.profile, queryFn: fetchProfile });
  const limitsQuery = useQuery({ queryKey: queryKeys.mediaLimits, queryFn: fetchMediaLimits });

  const [draft, setDraft] = useState<Draft>(() => ({
    ...emptyDraft(),
    // The type the Home card was tapped for, when it passed one. Validated
    // against `COMPOSER_TYPES` rather than trusted, so a hand-typed URL cannot
    // put the draft into a type the composer does not have fields for.
    type: requestedType,
  }));
  const [slots, setSlots] = useState<UploadSlot[]>([]);
  const [restored, setRestored] = useState(false);
  const [phase, setPhase] = useState<Phase>('editing');
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const [askingToClose, setAskingToClose] = useState(false);

  const limits = useMemo(() => toComposerLimits(limitsQuery.data), [limitsQuery.data]);
  const errors = useMemo(() => validateDraft(draft, limits), [draft, limits]);
  const busy = phase !== 'editing';
  const submittable = canSubmit(draft, limits) && !busy;
  // An image post takes a gallery; a project takes one cover image; an
  // achievement one certificate image. A video post takes exactly one video.
  const showMediaPicker = acceptsMedia(draft.type);
  const remainingSlots = remainingMediaSlots(draft.type, draft.media.length, limits.maxItems);

  // Fill the in-memory token cache the feed's media components read from.
  useEffect(() => {
    void primeMediaAuth();
  }, []);

  // Restore this user's draft once. A stored draft for another user is ignored
  // by `parseDraft`, so this cannot resurrect someone else's work.
  useEffect(() => {
    if (!userId || restored) return;
    let active = true;
    void loadDraft(userId).then((stored) => {
      if (!active) return;
      if (stored) {
        setDraft(stored);
        setSlots(initialSlots(stored.media));
      }
      setRestored(true);
    });
    return () => {
      active = false;
    };
  }, [userId, restored]);

  // Autosave. Debounced so a fast typist does not write a file per keystroke.
  useEffect(() => {
    if (!userId || !restored || !isDirty(draft)) return;
    const handle = setTimeout(() => {
      void saveDraft(userId, draft);
    }, 700);
    return () => clearTimeout(handle);
  }, [draft, userId, restored]);

  const update = useCallback((patch: Partial<Draft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  /**
   * Switching type has to reconcile the chosen images with what the new type can
   * carry, and the upload slots have to follow. `mediaForType` owns the rule; this
   * only applies it and tells the user what it cost them.
   */
  const changeType = useCallback(
    (type: ComposerType) => {
      if (type === draft.type) return;
      const media = mediaForType(type, draft.media);
      const keptUris = new Set(media.map((item) => item.localUri));

      setDraft((current) => ({ ...current, type, media }));
      // A dropped image must not leave an orphan slot behind, or the old upload
      // row would keep counting towards the "everything is uploaded" gate.
      setSlots((current) => current.filter((slot) => keptUris.has(slot.localUri)));

      const dropped = draft.media.length - media.length;
      if (dropped > 0) {
        setNotice({
          tone: 'warning',
          title: dropped === 1 ? 'One image was removed' : `${dropped} images were removed`,
          description: acceptsMedia(type)
            ? 'This post type keeps a single image.'
            : 'This post type has no image.',
        });
      }
    },
    [draft.media, draft.type],
  );

  /* --------------------------------- picking -------------------------------- */

  const pickImages = useCallback(async () => {
    if (!userId) return;
    setNotice(null);

    // Permission is requested at the moment it is needed, not on mount.
    const permission = await requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setNotice({
        tone: 'warning',
        title: 'Photo access is off',
        description:
          'Allow access to your photos in the device settings to attach an image to a post.',
      });
      return;
    }

    // A video post takes one video; the image-bearing types take stills. The
    // picker is asked for exactly that, so the OS never offers a file this
    // post type would then have to reject.
    const wantsVideo = draft.type === 'video';

    const result = await launchImageLibraryAsync({
      mediaTypes: wantsVideo ? ['videos'] : ['images'],
      allowsMultipleSelection: !wantsVideo,
      // One video per post: a second would be a playlist, which this composer
      // does not build, so the picker is capped at the real slot count.
      selectionLimit: wantsVideo ? 1 : remainingSlots,
      quality: 1,
    });
    if (result.canceled) return;

    const accepted: Draft['media'] = [];
    const rejected: string[] = [];

    for (const asset of result.assets) {
      // The picker knows what the user chose; the server decides what the bytes
      // really are. Both are recorded, because they are different questions.
      const kind: MediaKind = asset.mimeType?.startsWith('video/')
        ? 'video'
        : wantsVideo
          ? 'video'
          : 'image';

      const candidate = {
        localUri: asset.uri,
        kind,
        fileName: asset.fileName ?? (kind === 'video' ? 'Video' : 'Image'),
        // The picker's type is optional; the server's allow-list is the real
        // authority, and an unknown type is resolved from the file extension.
        mimeType: asset.mimeType ?? mimeTypeFromName(asset.fileName),
        // `fileSize` is optional and often absent. When it is missing the real
        // size is read from the file, rather than treating "unknown" as "empty" —
        // which is what previously made every image on those devices unpublishable.
        sizeBytes: asset.fileSize ?? measureLocalFileSize(asset.uri),
        // Width/height are documented as "can be 0". Zero means unknown, and the
        // card renders a 4:3 box, so the value is passed through as-is.
        width: asset.width,
        height: asset.height,
      };
      const problem = validatePickedMedia(candidate, limits);
      if (problem) {
        rejected.push(problem);
        continue;
      }
      if (!accepted.some((item) => item.localUri === candidate.localUri)) {
        accepted.push(candidate);
      }
    }

    if (accepted.length > 0) {
      // Two independent, pure updaters. Nesting one inside the other would make
      // a state update depend on being run once, which React does not promise.
      setDraft((current) => ({
        ...current,
        media: [...current.media, ...accepted].slice(0, limits.maxItems),
      }));
      setSlots((current) => {
        const known = new Set(current.map((slot) => slot.localUri));
        return [
          ...current,
          ...accepted
            .filter((item) => !known.has(item.localUri))
            .map((item) => ({ localUri: item.localUri, status: 'waiting' as const, fraction: 0 })),
        ];
      });
    }
    if (rejected.length > 0) {
      setNotice({
        tone: 'warning',
        title: draft.type === 'video'
          ? 'That video was skipped'
          : rejected.length === 1
            ? 'One image was skipped'
            : `${rejected.length} images were skipped`,
        description: rejected[0],
      });
    }
    // `draft.type` is read below to decide what the picker offers, so leaving it
    // out would let a stale closure offer images after a switch to Video.
  }, [limits, remainingSlots, userId, draft.type]);

  const removeImage = useCallback((localUri: string) => {
    setDraft((current) => ({
      ...current,
      media: current.media.filter((item) => item.localUri !== localUri),
    }));
    setSlots((current) => current.filter((slot) => slot.localUri !== localUri));
  }, []);

  /* --------------------------------- uploading ------------------------------- */

  /**
   * Uploads one image and returns the updated slot list.
   *
   * The working list is threaded through rather than read from state, because
   * several uploads happen inside one press and React state would still be a
   * render behind by the time the post body is built.
   */
  const uploadOne = useCallback(
    async (item: Draft['media'][number], working: UploadSlot[]): Promise<UploadSlot[]> => {
      const existing = working.find((slot) => slot.localUri === item.localUri);
      // Already confirmed by the server: reuse it rather than storing the bytes twice.
      if (existing?.status === 'done' && existing.mediaId) return working;

      const mark = (patch: Parameters<typeof withStatus>[2]) =>
        setSlots((current) => withStatus(current, item.localUri, patch));

      mark({ status: 'uploading', fraction: 0, errorMessage: undefined });

      try {
        const uploaded = await uploadPickedMedia(item, (progress) => {
          mark({ fraction: progress.fraction });
        });
        mark({ status: 'done', fraction: 1, mediaId: uploaded.id });
        return withStatus(working, item.localUri, {
          status: 'done',
          fraction: 1,
          mediaId: uploaded.id,
        });
      } catch (error) {
        mark({ status: 'failed', errorMessage: messageOf(error) });
        return withStatus(working, item.localUri, {
          status: 'failed',
          errorMessage: messageOf(error),
        });
      }
    },
    [],
  );

  /* --------------------------------- publishing ------------------------------ */

  const publish = useCallback(async () => {
    if (!userId || !submittable) return;
    setNotice(null);

    let working: UploadSlot[] = slots;

    if (draft.media.length > 0) {
      setPhase('uploading');
      for (const item of draft.media) {
        working = await uploadOne(item, working);
      }
      const failed = working.find((slot) => slot.status === 'failed');
      if (failed) {
        // The draft is untouched: the caption and the images are all still here.
        setPhase('editing');
        // A video failure said "image" in every clause. The kind comes from
        // the draft item the failed slot belongs to, so the copy matches what
        // the person actually chose.
        const failedKind =
          draft.media.find((item) => item.localUri === failed.localUri)?.kind ===
            'video'
            ? 'video'
            : 'image';
        setNotice({
          tone: 'danger',
          title:
            failedKind === 'video'
              ? 'A video did not upload'
              : 'An image did not upload',
          description:
            `${failed.errorMessage ?? 'The upload did not finish.'} Your draft is kept — retry that` +
            `${failedKind}, then publish again.`,
        });
        return;
      }
    }

    setPhase('submitting');
    try {
      // Only now, with every image confirmed by the server, is the post sent.
      const created = await createPost(buildCreateInput(draft, working, limits));
      await clearDraft(userId);

      // **The server's own copy, not a locally assembled one.** `createPost`
      // returns the stored `WirePost` — the author's identity, the real
      // engagement zeros, the resolved media — so inserting *that* cannot show a
      // card that differs from what every other member will read. It is
      // de-duplicated by id, so a refetch that has already included it is a
      // no-op rather than a second copy at the top of the feed.
      queryClient.setQueryData<FeedPost[]>(queryKeys.posts, (current) => {
        if (!current) return [created];
        return current.some((post) => post.id === created.id) ? current : [created, ...current];
      });

      // Then refresh the one feed query Home renders from, so the new post is
      // reconciled against the authoritative list — including
      // `['posts', 'mine']`, which this one prefix also covers — without a
      // restart and without a second competing feed.
      await queryClient.invalidateQueries({ queryKey: queryKeys.posts });
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace('/home' as never);
      }
    } catch (error) {
      setPhase('editing');
      setNotice({
        tone: 'danger',
        title: 'The post was not published',
        description: `${messageOf(error)} Nothing was lost — your draft is still here.`,
      });
    }
  }, [draft, limits, queryClient, router, slots, submittable, uploadOne, userId]);

  const retryUpload = useCallback(
    async (localUri: string) => {
      const item = draft.media.find((entry) => entry.localUri === localUri);
      if (!item) return;
      setPhase('uploading');
      await uploadOne(item, slots);
      setPhase('editing');
    },
    [draft.media, slots, uploadOne],
  );

  /* ---------------------------------- leaving -------------------------------- */

  const requestClose = useCallback(() => {
    // An unfinished post is never discarded silently.
    if (isDirty(draft) && !busy) {
      setAskingToClose(true);
      return;
    }
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/home' as never);
    }
  }, [busy, draft, router]);

  const discard = useCallback(() => {
    setAskingToClose(false);
    if (userId) {
      void clearDraft(userId);
    }
    setDraft(emptyDraft());
    setSlots([]);
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/home' as never);
    }
  }, [router, userId]);

  /* ---------------------------------- render --------------------------------- */

  const identity = profileQuery.data?.identity;
  const draftLabel =
    phase === 'uploading'
      ? 'Uploading images…'
      : phase === 'submitting'
        ? 'Publishing…'
        : isDirty(draft)
          ? 'Draft saved on this device'
          : '';

  return (
    <View style={s.root} testID="add-post-screen">
      <ComposerHeader
        leading={<BackButton label="Back" onPress={requestClose} />}
        draftLabel={draftLabel}
        publishLabel={phase === 'uploading' ? 'Uploading…' : 'Publish'}
        canSubmit={submittable}
        submitting={busy}
        onSubmit={() => void publish()}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.top + 56}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag">
          {identity ? (
            <AuthorRow
              name={identity.name}
              headline={identity.headline}
              avatarUrl={identity.avatar_url}
            />
          ) : null}

          <TypeSelector value={draft.type} onChange={changeType} />

          {notice ? (
            <Notice tone={notice.tone} title={notice.title} description={notice.description} />
          ) : null}

          {showMediaPicker ? (
            <View style={s.section}>
              {/* The grid is shared; the label says what the image is for, so a
                  single cover is never mistaken for a gallery. */}
              <AppText variant="caption" tone="tertiary" style={s.sectionLabel}>
                {draft.type === 'image'
                  ? 'Images'
                  : draft.type === 'video'
                    ? 'Video'
                    : draft.type === 'project'
                      ? 'Cover image'
                      : 'Certificate image'}
              </AppText>
              <ImageGrid
                media={draft.media}
                mediaKind={draft.type === 'video' ? 'video' : 'image'}
                canAddMore={remainingSlots > 0}
                onPick={() => void pickImages()}
                onRemove={removeImage}
              />
              {errors.media ? (
                <AppText variant="caption" style={s.fieldError}>
                  {errors.media}
                </AppText>
              ) : null}
              {draft.media.length > 0 ? (
                <UploadList
                  media={draft.media}
                  slots={slots}
                  onRetry={(uri) => void retryUpload(uri)}
                />
              ) : null}
            </View>
          ) : null}

          {draft.type === 'project' ? (
            <View style={s.section}>
              <Field
                label="Project title"
                value={draft.project.title}
                onChangeText={(title) => update({ project: { ...draft.project, title } })}
                placeholder="Campus Event Platform"
                invalid={Boolean(errors.project)}
                error={errors.project}
              />
              <Field
                label="What did you build?"
                value={draft.project.description}
                onChangeText={(description) =>
                  update({ project: { ...draft.project, description } })
                }
                placeholder="Two or three sentences about the problem and your solution."
                multiline
              />
              <Field
                label="Technologies"
                value={draft.project.technologies}
                onChangeText={(technologies) =>
                  update({ project: { ...draft.project, technologies } })
                }
                placeholder="React, FastAPI, PostgreSQL"
                autoCapitalize="none"
              />
              <Field
                label="Category"
                value={draft.project.category}
                onChangeText={(category) => update({ project: { ...draft.project, category } })}
                placeholder="Web Development"
              />
              <Field
                label="Status"
                value={draft.project.status}
                onChangeText={(status) => update({ project: { ...draft.project, status } })}
                placeholder="Academic project"
              />
              <Field
                label="Team"
                value={draft.project.team}
                onChangeText={(team) => update({ project: { ...draft.project, team } })}
                placeholder="Team project · 4 students"
              />
              <Field
                label="Repository URL"
                value={draft.project.sourceUrl}
                onChangeText={(sourceUrl) => update({ project: { ...draft.project, sourceUrl } })}
                placeholder="https://github.com/…"
                keyboardType="url"
                autoCapitalize="none"
                invalid={Boolean(errors.links)}
                error={errors.links}
              />
              <Field
                label="Live demo URL"
                value={draft.project.liveUrl}
                onChangeText={(liveUrl) => update({ project: { ...draft.project, liveUrl } })}
                placeholder="https://…"
                keyboardType="url"
                autoCapitalize="none"
              />
            </View>
          ) : null}
          {draft.type === 'achievement' ? (
            <View style={s.section}>
              <Field
                label="Achievement"
                value={draft.achievement.title}
                onChangeText={(title) => update({ achievement: { ...draft.achievement, title } })}
                placeholder="Full-Stack Web Development"
                invalid={Boolean(errors.achievement)}
                error={errors.achievement}
              />
              <Field
                label="Issued by"
                value={draft.achievement.issuer}
                onChangeText={(issuer) => update({ achievement: { ...draft.achievement, issuer } })}
                placeholder="Issuing organisation"
              />
              <Field
                label="Date"
                value={draft.achievement.achievedOn}
                onChangeText={(achievedOn) =>
                  update({ achievement: { ...draft.achievement, achievedOn } })
                }
                placeholder="2026-02-10"
                autoCapitalize="none"
              />
              <Field
                label="Description"
                value={draft.achievement.description}
                onChangeText={(description) =>
                  update({ achievement: { ...draft.achievement, description } })
                }
                placeholder="What the course covered, or what you did."
                multiline
              />
              <Field
                label="Verification link"
                value={draft.achievement.verificationUrl}
                onChangeText={(verificationUrl) =>
                  update({ achievement: { ...draft.achievement, verificationUrl } })
                }
                placeholder="https://…"
                keyboardType="url"
                autoCapitalize="none"
                invalid={Boolean(errors.links)}
                error={errors.links}
              />
            </View>
          ) : null}

          {draft.type !== 'achievement' ? (
            <CaptionField
              value={draft.body}
              onChangeText={(body) => update({ body })}
              limit={limits.maxBodyChars}
              error={errors.body}
            />
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* A modal rather than `Alert.alert`, because the web build has no native
          alert and the user must be asked on every platform. */}
      <Modal
        visible={askingToClose}
        transparent
        animationType="fade"
        onRequestClose={() => setAskingToClose(false)}
        testID="discard-dialog">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Keep editing"
          onPress={() => setAskingToClose(false)}
          style={[
            s.notice,
            {
              backgroundColor: colors.colorOverlay,
              flex: 1,
              justifyContent: 'center',
              padding: spacing.pagePadding,
            },
          ]}>
          <Pressable
            onPress={() => undefined}
            style={{
              backgroundColor: colors.colorBgSurface,
              borderRadius: spacing.lg,
              gap: spacing.md,
              padding: spacing.cardPadding,
            }}>
            <AppText variant="h3" weight="semibold">
              Discard your changes?
            </AppText>
            <AppText variant="small" tone="secondary">
              This post has not been published. Leaving now removes the draft from this device.
            </AppText>
            <View style={{ gap: spacing.sm }}>
              <Button label="Keep Editing" onPress={() => setAskingToClose(false)} />
              <Button label="Discard" variant="secondary" onPress={discard} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}




