/**
 * Stage notice — the honest "not built yet" state.
 *
 * MahaJob ships no placeholder metrics, no mock records, and no UI-only shells
 * (`README.md`, `docs/ROADMAP.md`). A screen whose backend domain does not
 * exist yet says so plainly, names the stage that owns it, and shows the
 * current source of truth — instead of rendering invented content.
 */

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors, radius, spacing } from '@/theme/tokens';

export interface StageNoticeProps {
  /** Screen name, e.g. "Job discovery". */
  title: string;
  /** What this surface will do when its stage lands. */
  description: string;
  /** The stage that owns the backend domain. */
  stage: string;
  /** A concrete, honest next step for the user. */
  nextStep?: string;
  onBack?: () => void;
}

export function StageNotice({
  title,
  description,
  stage,
  nextStep,
  onBack,
}: StageNoticeProps) {
  return (
    <View style={styles.wrapper}>
      <Card style={styles.card}>
        <View style={styles.badge}>
          <AppText variant="caption" weight="semibold" tone="accent" uppercase>
            {stage}
          </AppText>
        </View>

        <AppText variant="h2">{title}</AppText>
        <AppText variant="body" tone="secondary">
          {description}
        </AppText>

        {nextStep ? (
          <View style={styles.next}>
            <AppText variant="small" tone="tertiary">
              {nextStep}
            </AppText>
          </View>
        ) : null}
      </Card>

      {onBack ? <Button label="Back" variant="ghost" onPress={onBack} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    gap: spacing.lg,
  },
  card: {
    gap: spacing.sm,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.colorPrimarySubtle,
    borderRadius: radius.full,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  next: {
    borderTopColor: colors.colorBorder,
    borderTopWidth: 1,
    marginTop: spacing.sm,
    paddingTop: spacing.md,
  },
});
