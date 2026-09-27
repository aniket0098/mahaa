/**
 * Switch row — a labelled on/off control used by the settings surfaces.
 *
 * Built on the platform `Switch` rather than a custom toggle so it inherits the
 * OS accessibility semantics (announced as a switch, correct role, spoken
 * on/off state) instead of re-implementing them. The label and hint sit inside
 * the same touch target, so tapping the text toggles the control.
 */

import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export interface SwitchRowProps {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

export function SwitchRow({ label, hint, value, onChange, disabled = false }: SwitchRowProps) {
  return (
    <View style={[styles.row, disabled ? styles.disabled : null]}>
      <View style={styles.text}>
        <AppText variant="body">{label}</AppText>
        {hint ? (
          <AppText variant="caption" tone="tertiary">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ checked: value, disabled }}
        disabled={disabled}
        value={value}
        onValueChange={onChange}
        trackColor={{ false: colors.colorBorderStrong, true: colors.colorPrimary }}
        thumbColor={colors.colorBgSurface}
        ios_backgroundColor={colors.colorBorderStrong}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    borderRadius: radius.control,
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
    minHeight: 48,
    paddingVertical: spacing.sm,
  },
  text: { flex: 1, gap: 2 },
  disabled: { opacity: 0.5 },
});