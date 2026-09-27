/**
 * API connection panel — the shared, platform-identical connection indicator.
 *
 * Shows the exact base URL the app is using and, on demand, whether the API
 * answered. Used on the sign-in screen (before the auth gate, where a network
 * failure is otherwise invisible) and on the authenticated home screen.
 *
 * There is one implementation on purpose: a diagnostic that exists in two
 * slightly different forms is a diagnostic that gives different answers.
 */

import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { useApiConnection } from '@/features/connection/useApiConnection';
import { colors, radius, spacing } from '@/theme/tokens';

export interface ApiConnectionPanelProps {
  /** Probe as soon as the screen mounts. */
  autoStart?: boolean;
}

export function ApiConnectionPanel({ autoStart = false }: ApiConnectionPanelProps) {
  const { state, baseUrl, check } = useApiConnection(autoStart);

  const dot =
    state.status === 'ok'
      ? colors.colorSuccess
      : state.status === 'failed'
        ? colors.colorDanger
        : colors.colorBorderStrong;

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <View style={styles.headerText}>
          <AppText variant="label" tone="secondary">
            API connection
          </AppText>
          <AppText variant="caption" tone="tertiary" numberOfLines={2}>
            {baseUrl}
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Check the API connection"
          onPress={check}
          hitSlop={8}
          style={({ pressed }) => [styles.checkButton, pressed ? styles.pressed : null]}>
          {state.status === 'checking' ? (
            <ActivityIndicator size="small" color={colors.colorPrimary} />
          ) : (
            <AppText variant="small" weight="semibold" tone="accent">
              Check
            </AppText>
          )}
        </Pressable>
      </View>

      {state.status === 'checking' ? <Skeleton height={14} width="60%" /> : null}

      {state.status === 'ok' ? (
        <AppText variant="small" tone="success">
          Connected · {state.detail}
        </AppText>
      ) : null}

      {state.status === 'failed' ? (
        <View style={styles.failure} accessibilityLiveRegion="polite">
          <AppText variant="small" tone="danger">
            {state.message}
          </AppText>
          <AppText variant="caption" tone="secondary">
            {state.hint}
          </AppText>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
  },
  headerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  dot: {
    borderRadius: radius.full,
    height: 10,
    width: 10,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  checkButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    minWidth: 56,
  },
  pressed: {
    opacity: 0.7,
  },
  failure: {
    backgroundColor: colors.colorDangerSubtle,
    borderRadius: radius.control,
    gap: spacing.xs,
    padding: spacing.md,
  },
});
