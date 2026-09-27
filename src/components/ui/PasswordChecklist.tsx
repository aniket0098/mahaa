/**
 * Password checklist — shows exactly the three server rules, never more.
 *
 * The server (`apps/api/app/schemas/auth.py`) is authoritative: min 8, max 128,
 * at least one letter, at least one digit. This list exists so the user is never
 * surprised by a rejection they could have avoided.
 */

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing } from '@/theme/tokens';
import { evaluatePassword, passwordRules } from '@/lib/passwordRules';

export interface PasswordChecklistProps {
  value: string;
}

export function PasswordChecklist({ value }: PasswordChecklistProps) {
  const state = evaluatePassword(value);
  const visible = value.length > 0;

  return (
    <View style={styles.list} accessibilityLiveRegion="polite">
      {passwordRules.map((rule) => {
        const met = state[rule.key];
        return (
          <View key={rule.key} style={styles.row}>
            <View
              style={[
                styles.marker,
                {
                  backgroundColor: met ? colors.colorSuccess : colors.colorBorder,
                },
              ]}
            />
            <AppText variant="caption" tone={met ? 'success' : 'tertiary'}>
              {rule.label}
            </AppText>
          </View>
        );
      })}
      {visible ? null : (
        <AppText variant="caption" tone="tertiary">
          Your password must satisfy all three.
        </AppText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.xs,
    paddingTop: spacing.xs,
  },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  marker: {
    borderRadius: radius.full,
    height: 8,
    width: 8,
  },
});
