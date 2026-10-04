/**
 * Profile header — cover band, the avatar with its edit control, and identity.
 *
 * **The avatar and the pencil are one control with two hit areas.** Both call
 * `changePhoto` from `useProfilePhotoChange` — *the same function the onboarding
 * photo step calls* — so the app has exactly one
 * pick → upload → reconcile sequence and no second way for a photo to be saved.
 *
 * **A failed replacement never blanks the photo.** The stored `avatar_url` is
 * untouched until `PUT /users/me/photo` answers, and the failure is reported in a
 * persistent banner with the control usable again, so a rejected file leaves the
 * current picture exactly where it was.
 *
 * **The pencil is anchored to the circle, not to the page.** Both sit inside one
 * `position: 'relative'` block that shrinks to the avatar's own box, so the badge
 * cannot drift with the column width, be clipped, or land under the name.
 *
 * Honest absences, all deliberate:
 *  - **No cover upload.** `avatar_url` is the only image field on `IdentityRead`
 *    and there is no endpoint that writes a cover, so the cover is a token-blue
 *    band.
 *  - **No verification badge.** The API's `verified` signal is hard-coded false
 *    server-side, so a badge could only be decorative.
 *  - **No Connect/Follow button.** There is no connection or follower domain.
 */

import { ActivityIndicator, Pressable, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { AVATAR_SIZE, styles } from '@/features/profile/profileStyles';
import { useProfilePhotoChange } from '@/features/profile/useProfilePhotoChange';
import type { HeaderMeta } from '@/features/profile/profileModel';
import { colors, layout } from '@/theme/tokens';
import type { IdentityRead } from '@/types/profile';

/** `edit-2`-style pencil: the iOS symbol and its Material equivalent. */
const PENCIL_ICON = { ios: 'pencil', android: 'edit' } as const;

const CHANGE_PHOTO_LABEL = 'Change profile photo';

export interface ProfileHeaderProps {
  identity: IdentityRead;
  meta: HeaderMeta;
  onEdit: () => void;
  onShare: () => void;
}

export function ProfileHeader({ identity, meta, onEdit, onShare }: ProfileHeaderProps) {
  const photo = useProfilePhotoChange();

  const lines = [
    [meta.course, meta.institution].filter(Boolean).join(' — '),
    [meta.graduation, meta.location].filter(Boolean).join(' · '),
  ].filter(Boolean);

  /**
   * One handler, referenced by both controls. Not two functions that happen to
   * contain the same calls: a single reference is what stops the circle's path
   * and the pencil's path from drifting apart.
   */
  const changePhoto = () => void photo.changePhoto('library');

  return (
    <View>
      <View style={styles.cover} accessibilityRole="image" accessibilityLabel="Profile cover">
        <View style={[styles.coverBand, styles.coverBandSecond]} />
        <View style={styles.coverBand} />
        <AppText style={styles.coverLabel}>MahaJob</AppText>
      </View>

      <View style={[styles.padded, styles.headerBlock]}>
        <View style={styles.avatarBlock}>
          {/*
            The circle is itself the primary control — a photo you can tap is what
            people try first. The ring is applied to the pressable rather than to
            an inner `View`, so the touch target is exactly the visible circle.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={CHANGE_PHOTO_LABEL}
            accessibilityHint="Opens your photo library to choose a picture."
            accessibilityState={{ busy: photo.isUploading, disabled: photo.isBusy }}
            disabled={photo.isBusy}
            onPress={changePhoto}
            style={({ pressed }) => [styles.avatarRing, pressed ? styles.pressed : null]}>
            <Avatar name={identity.name} src={identity.avatar_url} size={AVATAR_SIZE} />

            {/*
              A scrim *over* the current picture, not a placeholder instead of it:
              the previous photo stays visible for the whole upload, so a failed
              replacement is a visible no-op rather than a face that vanished.
            */}
            {photo.isBusy ? (
              <View
                style={styles.avatarBusy}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants">
                <ActivityIndicator color={colors.colorTextOnPrimary} />
              </View>
            ) : null}
          </Pressable>

          {/*
            The pencil, declared second so it sits above the circle and wins the
            touch in the region where the two overlap.
          */}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={CHANGE_PHOTO_LABEL}
            accessibilityHint="Opens your photo library to choose a picture."
            accessibilityState={{ busy: photo.isUploading, disabled: photo.isBusy }}
            disabled={photo.isBusy}
            hitSlop={layout.hitSlop}
            onPress={changePhoto}
            style={({ pressed }) => [styles.avatarEdit, pressed ? styles.pressed : null]}>
            <AppIcon name={PENCIL_ICON} size={16} color={colors.colorPrimary} />
          </Pressable>
        </View>

        <View style={styles.nameRow}>
          <AppText variant="h1" accessibilityRole="header">
            {identity.name}
          </AppText>
        </View>

        {identity.headline ? (
          <AppText variant="body" tone="secondary">
            {identity.headline}
          </AppText>
        ) : null}

        {lines.map((line) => (
          <AppText key={line} style={styles.metaLine}>
            {line}
          </AppText>
        ))}

        {/*
          Persistent, not a toast: the photo did not change, and that has to be
          visible whether or not the person was watching when it failed. "Retry"
          re-opens the picker — the rejected file is gone, so choosing again is the
          only honest retry available.
        */}
        {photo.problem ? (
          <StatusBanner
            title="Could not change your profile photo"
            description={photo.problem}
            onRetry={changePhoto}
          />
        ) : null}

        <View style={styles.actionsRow}>
          <Button label="Edit Profile" onPress={onEdit} accessibilityHint="Opens the profile editor." />
          <Button label="Share Profile" variant="secondary" onPress={onShare} />
        </View>
      </View>
    </View>
  );
}
