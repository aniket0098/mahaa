/**
 * Presentational parts of the Create Post screen.
 *
 * Split from the screen so the state machine (draft, uploads, publishing) lives in
 * one file and the layout lives here. Nothing in this file performs a request:
 * every action is a callback the screen supplies.
 *
 * Touch sizing comes from `composerStyles` — 48px inputs, 48px primary action,
 * and small icon buttons with a generous `hitSlop`.
 */

import { type ReactNode } from 'react';
import { Image } from 'expo-image';
import { Pressable, TextInput, View } from 'react-native';

import type { MediaKind } from '@/api/media';
import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { colors } from '@/theme/tokens';
import { composerStyles as s } from '@/features/composer/composerStyles';
import {
  COMPOSER_TYPES,
  type ComposerType,
  type DraftMedia,
  type UploadSlot,
} from '@/features/composer/composerModel';

/* -------------------------------------------------------------------------- */
/* Header                                                                      */
/* -------------------------------------------------------------------------- */

export function ComposerHeader({
  leading,
  draftLabel,
  publishLabel,
  canSubmit,
  submitting,
  onSubmit,
}: {
  /** The back control. Supplied by the screen, which owns the discard prompt. */
  leading: ReactNode;
  /** "Draft saved" or similar; empty when there is nothing to say. */
  draftLabel: string;
  publishLabel: string;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
}) {
  return (
    <View style={s.header}>
      {leading}

      <View style={s.headerTitle}>
        <AppText variant="h3" weight="semibold">
          Create Post
        </AppText>
        {draftLabel ? (
          <AppText variant="caption" tone="tertiary">
            {draftLabel}
          </AppText>
        ) : null}
      </View>

      <Button
        label={publishLabel}
        onPress={onSubmit}
        disabled={!canSubmit}
        loading={submitting}
        size="md"
      />
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Author + type selector                                                      */
/* -------------------------------------------------------------------------- */

export function AuthorRow({
  name,
  headline,
  avatarUrl,
}: {
  name: string;
  headline: string | null;
  avatarUrl: string | null;
}) {
  return (
    <View style={s.author}>
      <Avatar name={name} src={avatarUrl} size={40} />
      <View style={s.authorText}>
        <AppText variant="body" weight="semibold" numberOfLines={1}>
          {name}
        </AppText>
        {headline ? (
          <AppText variant="small" tone="tertiary" numberOfLines={1}>
            {headline}
          </AppText>
        ) : null}
      </View>
    </View>
  );
}

export function TypeSelector({
  value,
  onChange,
}: {
  value: ComposerType;
  onChange: (type: ComposerType) => void;
}) {
  return (
    <View>
      <AppText variant="caption" tone="tertiary" style={s.sectionLabel}>
        Post type
      </AppText>
      <View style={s.typeRow} accessibilityLabel="Post type">
        {COMPOSER_TYPES.map((option) => {
          const active = option.value === value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: active, disabled: !option.enabled }}
              accessibilityLabel={option.label}
              accessibilityHint={option.enabled ? option.hint : option.unavailableReason}
              disabled={!option.enabled}
              onPress={() => onChange(option.value)}
              style={[
                s.typeChip,
                active ? s.typeChipActive : null,
                option.enabled ? null : s.typeChipDisabled,
              ]}>
              <AppIcon
                name={option.icon}
                size={20}
                color={active ? colors.colorPrimary : colors.colorTextTertiary}
              />
              <AppText variant="small" weight="medium" style={s.typeChipLabel}>
                {option.label}
              </AppText>
              <AppText variant="caption" style={s.typeChipHint} numberOfLines={2}>
                {option.enabled ? option.hint : 'Not available yet'}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Inputs                                                                      */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  invalid,
  error,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  multiline?: boolean;
  invalid?: boolean;
  error?: string;
  keyboardType?: 'default' | 'url';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View style={s.inputRow}>
      <AppText variant="caption" tone="tertiary" style={s.sectionLabel}>
        {label}
      </AppText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.colorTextTertiary}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        accessibilityLabel={label}
        style={[s.input, multiline ? s.textarea : null, invalid ? s.inputInvalid : null]}
      />
      {error ? (
        <AppText variant="caption" style={s.fieldError}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/** The caption, with a live counter that turns red only past the limit. */
export function CaptionField({
  value,
  onChangeText,
  limit,
  error,
}: {
  value: string;
  onChangeText: (value: string) => void;
  limit: number;
  error?: string;
}) {
  const over = value.length > limit;
  return (
    <View style={s.inputRow}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="Share your thoughts, learning experience, or career journey..."
        placeholderTextColor={colors.colorTextTertiary}
        multiline
        accessibilityLabel="Post caption"
        style={[s.input, s.textarea, error ? s.inputInvalid : null]}
      />
      <View style={s.counterRow}>
        <AppText variant="caption" tone="tertiary" style={over ? s.counterOver : undefined}>
          {`${value.length} / ${limit}`}
        </AppText>
      </View>
      {error ? (
        <AppText variant="caption" style={s.fieldError}>
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Media                                                                       */
/* -------------------------------------------------------------------------- */

/** The picker's accessible name, so it matches what it will actually add. */
function mediaKindLabel(kind: MediaKind): string {
  return kind === 'video'
    ? 'Add a video from your gallery'
    : 'Add images from your gallery';
}

/**
 * The picked-media grid: a preview per item, a remove button on each, and an
 * "add" tile until the server's item limit is reached.
 *
 * **A video gets a labelled tile, not a thumbnail.** `expo-image` cannot decode a
 * `.mp4`, so handing it one produces an empty square that looks exactly like a
 * broken image. A muted tile with a video icon and the file name says what was
 * chosen, which is the only truthful thing to show before the file is uploaded.
 */
export function ImageGrid({
  media,
  canAddMore,
  onPick,
  onRemove,
  mediaKind = 'image',
}: {
  media: readonly DraftMedia[];
  canAddMore: boolean;
  onPick: () => void;
  onRemove: (localUri: string) => void;
  /**
   * Which media the picker is adding, so the control says "Add a video"
   * rather than promising images the composer will refuse.
   */
  mediaKind?: MediaKind;
}) {
  return (
    <View style={s.grid}>
      {media.map((item) => (
        <View key={item.localUri} style={s.thumbnail}>
          {item.kind === 'video' ? (
            <View style={s.videoTile} accessibilityLabel={item.fileName || 'Selected video'}>
              <AppIcon
                name={{ ios: 'video.fill', android: 'videocam' }}
                size={22}
                color={colors.colorTextSecondary}
              />
              <AppText variant="caption" tone="secondary" numberOfLines={1}>
                Video
              </AppText>
            </View>
          ) : (
            <Image
              source={{ uri: item.localUri }}
              style={{ height: '100%', width: '100%' }}
              contentFit="cover"
              accessibilityLabel={item.fileName || 'Selected image'}
            />
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.kind === 'video' ? 'Remove this video' : 'Remove this image'}
            onPress={() => onRemove(item.localUri)}
            hitSlop={8}
            style={s.removeButton}>
            <AppIcon
              name={{ ios: 'xmark', android: 'close' }}
              size={14}
              color={colors.colorTextOnPrimary}
            />
          </Pressable>
        </View>
      ))}

      {canAddMore ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={mediaKindLabel(mediaKind)}
          onPress={onPick}
          style={s.addTile}>
          <AppIcon
            name={{ ios: 'plus', android: 'add' }}
            size={20}
            color={colors.colorTextSecondary}
          />
          <AppText variant="caption" tone="secondary">
            Add
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * One line per upload, with a **real** progress bar.
 *
 * The fraction comes from the native upload task's own byte count, so it moves
 * because bytes moved. A slot that has not started reads "Waiting" rather than
 * sitting at an empty bar pretending to be 0%.
 */
export function UploadList({
  media,
  slots,
  onRetry,
}: {
  media: readonly DraftMedia[];
  slots: readonly UploadSlot[];
  onRetry: (localUri: string) => void;
}) {
  return (
    <View style={s.uploadRow}>
      {media.map((item) => {
        const slot = slots.find((entry) => entry.localUri === item.localUri);
        const status = slot?.status ?? 'waiting';
        const percent = slot ? Math.round(slot.fraction * 100) : 0;
        return (
          <View key={item.localUri} style={s.inputRow}>
            <View style={s.uploadLine}>
              <AppText variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                {item.fileName || (item.kind === 'video' ? 'Video' : 'Image')}
              </AppText>
              <AppText variant="caption" tone={status === 'failed' ? 'danger' : 'tertiary'}>
                {status === 'waiting'
                  ? 'Waiting'
                  : status === 'uploading'
                    ? `${percent}%`
                    : status === 'done'
                      ? 'Uploaded'
                      : 'Failed'}
              </AppText>
            </View>

            {status === 'uploading' ? (
              <View style={s.progressTrack}>
                <View style={[s.progressFill, { width: `${Math.max(percent, 2)}%` }]} />
              </View>
            ) : null}

            {status === 'failed' ? (
              <>
                <AppText variant="caption" style={s.fieldError}>
                  {slot?.errorMessage ?? 'The upload did not finish.'}
                </AppText>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Retry this upload"
                  onPress={() => onRetry(item.localUri)}
                  hitSlop={8}
                  style={{ minHeight: 40, justifyContent: 'center' }}>
                  <AppText variant="small" weight="medium" tone="accent">
                    Retry
                  </AppText>
                </Pressable>
              </>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/* Notices                                                                     */
/* -------------------------------------------------------------------------- */

export type NoticeTone = 'info' | 'warning' | 'danger' | 'success';

export function Notice({
  tone,
  title,
  description,
}: {
  tone: NoticeTone;
  title: string;
  description?: string | null;
}) {
  const toneStyle =
    tone === 'info'
      ? s.noticeInfo
      : tone === 'warning'
        ? s.noticeWarning
        : tone === 'danger'
          ? s.noticeDanger
          : s.noticeSuccess;

  return (
    <View accessibilityLiveRegion="polite" style={[s.notice, toneStyle]}>
      <AppText variant="body" weight="semibold">
        {title}
      </AppText>
      {description ? (
        <AppText variant="small" tone="secondary">
          {description}
        </AppText>
      ) : null}
    </View>
  );
}



