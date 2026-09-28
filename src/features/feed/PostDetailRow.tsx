/**
 * Shared parts for the structured detail blocks (project, achievement).
 *
 * `DetailRow` is rendered **only** for a value that exists — the callers gate
 * every row — so an empty field can never appear as a blank label. `LinkButton`
 * is the single outbound-link control in the feed, used for a project's
 * `source_url` / `live_url` and for a certificate's real `verification_url`.
 */

import { Pressable, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/feed/feedStyles';

export function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <AppText variant="caption" tone="tertiary" style={styles.detailLabel}>
        {label}
      </AppText>
      <AppText variant="small" style={styles.detailValue}>
        {value}
      </AppText>
    </View>
  );
}

/** An outbound link that opens in the system browser, never in-app. */
export function LinkButton({
  label,
  url,
  icon,
  onOpenLink,
}: {
  label: string;
  url: string;
  icon: { ios: string; android: string };
  onOpenLink: (url: string) => void;
}) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={label}
      onPress={() => onOpenLink(url)}
      hitSlop={4}
      style={styles.link}>
      <AppIcon name={icon} size={16} color={colors.colorPrimary} />
      <AppText variant="small" style={styles.linkLabel}>
        {label}
      </AppText>
    </Pressable>
  );
}
