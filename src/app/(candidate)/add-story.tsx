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
 * never clears the form, and Publish is disabled while it is in flight.
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
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/auth/AuthContext';
import { fetchProfile } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { absoluteMediaUri, uploadPickedMedia } from '@/api/media';
import { createStory } from '@/api/stories';
import { composerStyles as s } from '@/features/composer/composerStyles';
import { colors, spacing } from '@/theme/tokens';
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
  readonly tone: 'danger' | 'warning';
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
   * A ref, not the `phase` state, because the duplicate-tap guard has to hold
   * *within* one render.
   *
   * `phase` is state: two taps in the same frame both read the old value, both
   * pass the `busy` check, and two stories are created. A ref is written
   * synchronously, so the second tap sees it and returns. The same reason
   * `usePostEngagement` carries a ref alongside its state.
   */
  const publishing = useRef(false);

  const errors = useMemo(() => validateStoryDraft(draft), [draft]);
  const busy = phase !== 'editing';
  const submittable = canPublishStory(draft) && !busy;

  const update = useCallback((patch: Partial<StoryDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
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

  const publish = useCallback(async () => {
    // Two guards, for two different failures: `submittable` is the form's own
    // validity (and the disabled button's reason), and the ref is the same-frame
    // duplicate tap the state cannot catch.
    if (!submittable || publishing.current) return;
    publishing.current = true;
    setNotice(null);

    try {
      let mediaId: string | null = null;
      if (draft.media) {
        setPhase('uploading');
        setUploadFraction(0);
        try {
          // The same upload the post composer uses: one request, real progress,
          // and the server's own magic-byte check as the authority.
          const uploaded = await uploadPickedMedia(draft.media, (progress) => {
            setUploadFraction(progress.fraction);
          });
          mediaId = uploaded.id;
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
  }, [draft, leave, queryClient, submittable]);

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
      <View style={s.header}>
        <BackButton onPress={leave} />
        <AppText variant="h2" weight="semibold" style={s.headerTitle} accessibilityRole="header">
          New story
        </AppText>
      </View>

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
          <View style={[s.notice, s.noticeDanger]} accessibilityRole="alert" testID="create-story-notice">
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

      <View style={[s.publishBar, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label={busy ? 'Working…' : 'Publish story'}
          onPress={() => void publish()}
          disabled={!submittable}
          style={s.publishButton}
          accessibilityHint="Publishes this story to every member"
        />
      </View>
      </View>
    </KeyboardAvoidingView>
  );
}

/** The two styles the shared composer sheet does not already define. */
const styles = {
  /** A file name that truncates rather than pushing its row's sibling off-screen. */
  grow: { flex: 1 },
  /** The notice's heading, so the message under it is never mistaken for it. */
  noticeTitle: { fontWeight: '600' as const },
};