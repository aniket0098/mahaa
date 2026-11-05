/** Save / unsave toggle for a lecture or course, backed by the real API. *
 *
 * Uses `POST /saved` (idempotent) and `DELETE /saved/{id}` so state is
 * server-persisted and owned by the authenticated user. Updates are optimistic
 * with rollback on failure, and duplicate taps are guarded by the pending flag.
 */

import { useCallback, useState } from 'react';
import { Pressable } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing } from '@/theme/tokens';
import type { SavedItemType } from '@/types/saved';

export interface SaveButtonProps {
  /** The resource type (`course` or `lecture`). */
  resourceType: SavedItemType;
  /** The server id of the resource to save / unsave. */
  resourceId: string;
  /** Whether the resource is currently saved (drives icon + label). */
  isSaved: boolean;
  /** The saved item's server id, required to unsave. Omit when not yet saved. */
  savedItemId?: string | null;
  /** Save mutation; provided by the parent's `useSavedItems`. */
  onSave: (resourceType: SavedItemType, resourceId: string) => void;
  /** Unsave mutation; provided by the parent's `useSavedItems`. */
  onUnsave: (savedItemId: string) => void;
  /** True while either mutation is in flight. */
  isPending: boolean;
  /** Accessibility label override. */
  accessibilityLabel?: string;
  testID?: string;
}

export function SaveButton({
  resourceType,
  resourceId,
  isSaved,
  savedItemId,
  onSave,
  onUnsave,
  isPending,
  accessibilityLabel,
  testID,
}: SaveButtonProps) {
  const [optimistic, setOptimistic] = useState(isSaved);

  const disabled = isPending;

  const onPress = useCallback(() => {
    if (isPending) return;
    setOptimistic(!optimistic);
    if (optimistic) {
      const id = savedItemId;
      if (!id) return;
      void onUnsave(id).catch(() => {
        // Rollback on failure
        setOptimistic(true);
      });
    } else {
      void onSave(resourceType, resourceId).catch(() => setOptimistic(false));
    }
  }, [optimistic, isPending, savedItemId, resourceType, resourceId, onSave, onUnsave]);

  const label = optimistic ? 'Unsave' : 'Save';
  const icon = optimistic
    ? { ios: 'bookmark.fill', android: 'bookmark' }
    : { ios: 'bookmark', android: 'bookmark_border' };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: optimistic, disabled }}
      accessibilityLabel={accessibilityLabel ?? `${label} ${resourceType}`}
      disabled={disabled}
      hitSlop={8}
      onPress={onPress}
      testID={testID}
      style={styles.button}>
      <AppIcon name={icon} size={20} color={optimistic ? colors.colorPrimary : colors.colorTextSecondary} />
      <AppText variant="caption" weight="medium" style={styles.label}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = {
  button: {
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 36,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.colorBorder,
    backgroundColor: colors.colorBgSurface,
  } as const,
  label: {
    fontSize: 11,
    lineHeight: 14,
  } as const,
};
