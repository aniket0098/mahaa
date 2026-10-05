/**
 * Avatar — identity bubble with an initials fallback.
 *
 * Native port of `apps/web/src/components/ui/Avatar.tsx` + `avatar.module.css`.
 * The same four sizes and the same deterministic name-derived tint are used, so
 * the same person or company gets the same colour in both apps.
 *
 * The tint is decoration: the name is always rendered as text beside the avatar,
 * so a screen reader never depends on the colour to identify anyone.
 *
 * **The image is fetched with the bearer token, and that is load-bearing.** A
 * profile photo is served from `GET /media/{id}`, which is deliberately
 * uploader-only (§11.5) — there is no unsigned variant of that route. This
 * component used to render a bare `react-native` `<Image source={{uri}}>`, which
 * sends no `Authorization` header, so the request came back **401** and the
 * `onError` handler quietly swapped in initials. The photo saved perfectly on
 * the server and rendered nowhere, which is indistinguishable from "this person
 * has no photo" from the outside.
 *
 * It now goes through {@link authenticatedImageSource} — the same helper the
 * post cards already used — and resolves a relative `served_at` path onto the
 * configured base with {@link absoluteMediaUri}, so the §14.11 contract
 * (`/api/v1/media/<id>` joined onto the base) holds here too and no caller has to
 * remember to do it.
 */

import { useState, useSyncExternalStore } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';

import {
  absoluteMediaUri,
  authenticatedImageSource,
  getMediaAuthVersion,
  subscribeMediaAuth,
} from '@/api/media';
import { colors, radius, typography } from '@/theme/tokens';

export type AvatarSize = 32 | 40 | 56 | 96;

export interface AvatarProps {
  /** Display name — drives both the initials and the deterministic tint. */
  name: string;
  src?: string | null;
  size?: AvatarSize;
  /** `rounded` (radius 10) is used for company logos. */
  shape?: 'circle' | 'rounded';
  style?: StyleProp<ViewStyle>;
}

const TINTS = ['slate', 'blue', 'sky', 'emerald', 'amber', 'rose'] as const;
type Tint = (typeof TINTS)[number];

/** First letter of the first and last words, e.g. "Ada Lovelace" -> "AL". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

/** Stable colour per name, so the same company is always the same colour. */
export function tintFor(name: string): Tint {
  let hash = 0;
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) % 997;
  }
  return TINTS[hash % TINTS.length] ?? 'slate';
}

const tintColors: Record<Tint, { bg: string; fg: string }> = {
  slate: { bg: colors.colorBgMuted, fg: colors.colorTextSecondary },
  blue: { bg: colors.colorPrimarySubtle, fg: colors.colorPrimary },
  sky: { bg: colors.colorInfoSubtle, fg: colors.colorInfo },
  emerald: { bg: colors.colorSuccessSubtle, fg: colors.colorSuccess },
  amber: { bg: colors.colorWarningSubtle, fg: colors.colorWarning },
  rose: { bg: colors.colorDangerSubtle, fg: colors.colorDanger },
};

const sizeFont: Record<AvatarSize, number> = {
  32: typography.fontSizeCaption,
  40: typography.fontSizeSmall,
  56: typography.fontSizeH3,
  96: typography.fontSizeH1,
};

export function Avatar({ name, src = null, size = 40, shape = 'circle', style }: AvatarProps) {
  /*
   * The media path is resolved here, once, rather than at each call site. It used
   * to be handed a raw `/api/v1/media/<id>` from the profile aggregate and a raw
   * path from the stories payload, while the post cards pre-resolved theirs — so
   * the same avatar could load in one screen and 404 in another.
   */
  const resolved = src ? absoluteMediaUri(src) : null;

  // Keyed on the url so replacing a photo clears the previous failure and the new
  // image is actually attempted, instead of the old `onError` state sticking.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = resolved !== null && failedUrl !== resolved;
  const tint = tintFor(name);
  const palette = tintColors[tint];

  /**
   * Re-render once the session token reaches the media cache.
   *
   * The source is built during render while the token is mirrored into memory
   * asynchronously, so the first render's source carries no `Authorization` and
   * nothing would otherwise rebuild it. See the same subscription in `PostMedia`,
   * which this matches: both are surfaces that read private bytes.
   */
  useSyncExternalStore(subscribeMediaAuth, getMediaAuthVersion, getMediaAuthVersion);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.base,
        { width: size, height: size },
        shape === 'rounded' ? styles.rounded : styles.circle,
        showImage ? styles.imageBackground : { backgroundColor: palette.bg },
        style,
      ]}>
      {showImage && resolved ? (
        <Image
          source={authenticatedImageSource(resolved)}
          style={[styles.image, { width: size, height: size }]}
          contentFit="cover"
          cachePolicy="memory-disk"
          onError={() => setFailedUrl(resolved)}
        />
      ) : (
        <Text
          style={[styles.initials, { color: palette.fg, fontSize: sizeFont[size] }]}
          numberOfLines={1}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    /**
     * Spelled out rather than written as `flex: 0`.
     *
     * `flex: 0` is React Native's shorthand for "neither grow nor shrink" — Yoga
     * reads it as `flexGrow: 0, flexShrink: 0, flexBasis: auto`. It is *also* the
     * CSS shorthand for `flex: 0 1 0%`, and react-native-web emits it verbatim
     * rather than translating it. The explicit `height` on this view then loses
     * to `flex-basis: 0%`, so on the web every avatar collapsed to zero height
     * and the initials text was all that was left: the profile header's circle
     * rendered as a squashed pill with the edit badge crammed into it.
     *
     * Written this way both engines read the same thing — Yoga as
     * `0 / 0 / auto`, CSS as `flex-grow: 0; flex-shrink: 0; flex-basis: auto`,
     * which is what `flex: none` computes to.
     */
    flexBasis: 'auto',
    flexGrow: 0,
    flexShrink: 0,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  circle: { borderRadius: radius.full },
  rounded: { borderRadius: radius.control },
  imageBackground: { backgroundColor: colors.colorBgMuted },
  image: { height: '100%', width: '100%' },
  initials: {
    fontWeight: typography.fontWeightSemibold,
    textAlign: 'center',
  },
});