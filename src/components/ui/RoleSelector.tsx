/**
 * Role selector — the signup's one required choice.
 *
 * Only `candidate` and `employer` are offered: `admin` is never self-
 * registerable (server-side bootstrap only, see
 * `apps/api/app/schemas/auth.py`). The control is a real radio group so screen
 * readers announce "selected", not just "tapped".
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing } from '@/theme/tokens';

export type SignupRole = 'candidate' | 'employer';

interface Option {
  value: SignupRole;
  title: string;
  description: string;
}

const OPTIONS: readonly Option[] = [
  {
    value: 'candidate',
    title: 'I am looking for opportunities',
    description: 'Build a profile, add skills and projects, and track applications.',
  },
  {
    value: 'employer',
    title: 'I am hiring',
    description: 'Set up a company, invite your team, and manage hiring.',
  },
];

export interface RoleSelectorProps {
  value: SignupRole;
  onChange: (value: SignupRole) => void;
}

export function RoleSelector({ value, onChange }: RoleSelectorProps) {
  return (
    <View accessibilityRole="radiogroup" style={styles.group}>
      {OPTIONS.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ selected, checked: selected }}
            accessibilityLabel={option.title}
            accessibilityHint={option.description}
            onPress={() => onChange(option.value)}
            style={({ pressed }) => [
              styles.card,
              selected ? styles.cardSelected : null,
              pressed ? styles.pressed : null,
            ]}>
            <View style={[styles.radio, selected ? styles.radioSelected : null]}>
              {selected ? <View style={styles.radioDot} /> : null}
            </View>
            <View style={styles.copy}>
              <AppText variant="body" weight="semibold">
                {option.title}
              </AppText>
              <AppText variant="small" tone="secondary">
                {option.description}
              </AppText>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    gap: spacing.md,
  },
  card: {
    alignItems: 'flex-start',
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorder,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 72,
    padding: spacing.lg,
  },
  cardSelected: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorPrimary,
    borderWidth: 2,
  },
  pressed: {
    opacity: 0.9,
  },
  radio: {
    alignItems: 'center',
    borderColor: colors.colorBorderStrong,
    borderRadius: radius.full,
    borderWidth: 2,
    height: 22,
    justifyContent: 'center',
    marginTop: 2,
    width: 22,
  },
  radioSelected: {
    borderColor: colors.colorPrimary,
  },
  radioDot: {
    backgroundColor: colors.colorPrimary,
    borderRadius: radius.full,
    height: 10,
    width: 10,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
});
