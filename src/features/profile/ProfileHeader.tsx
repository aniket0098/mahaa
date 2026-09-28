/**
 * Profile header — cover band, overlapping avatar, identity, and the two
 * actions that genuinely work today.
 *
 * Honest absences, all deliberate:
 *  - **No cover upload.** `avatar_url` is the only image field on `IdentityRead`
 *    and there is no endpoint that writes it, so the cover is a token-blue band
 *    and the avatar falls back to the shared initials `Avatar`.
 *  - **No verification badge.** The API's `verified` signal is hard-coded false
 *    server-side, so a badge could only be decorative.
 *  - **No Connect/Follow button.** There is no connection or follower domain.
 */

import { View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import {
  AVATAR_SIZE,
  styles,
} from '@/features/profile/profileStyles';
import type { HeaderMeta } from '@/features/profile/profileModel';
import type { IdentityRead } from '@/types/profile';

export interface ProfileHeaderProps {
  identity: IdentityRead;
  meta: HeaderMeta;
  onEdit: () => void;
  onShare: () => void;
}

export function ProfileHeader({ identity, meta, onEdit, onShare }: ProfileHeaderProps) {
  const lines = [
    [meta.course, meta.institution].filter(Boolean).join(' — '),
    [meta.graduation, meta.location].filter(Boolean).join(' · '),
  ].filter(Boolean);

  return (
    <View>
      <View style={styles.cover} accessibilityRole="image" accessibilityLabel="Profile cover">
        <View style={[styles.coverBand, styles.coverBandSecond]} />
        <View style={styles.coverBand} />
        <AppText style={styles.coverLabel}>MahaJob</AppText>
      </View>

      <View style={[styles.padded, styles.headerBlock]}>
        <View style={styles.avatarRing}>
          <Avatar name={identity.name} src={identity.avatar_url} size={AVATAR_SIZE} />
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

        <View style={styles.actionsRow}>
          <Button label="Edit Profile" onPress={onEdit} accessibilityHint="Opens the profile editor." />
          <Button label="Share Profile" variant="secondary" onPress={onShare} />
        </View>
      </View>
    </View>
  );
}
