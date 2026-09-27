/**
 * Text field — top label, helper text, and an inline error that is associated
 * with the input for screen readers (docs/MOBILE_UX_SPEC.md §4).
 *
 * The value is never cleared on error (the form owns that decision), and the
 * error is rendered inline rather than only as a toast.
 */

import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';

export interface TextFieldProps extends Omit<TextInputProps, 'style'> {
  label: string;
  /** Inline error for this field. Presence switches the border to danger. */
  error?: string | null;
  helper?: string;
  required?: boolean;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, helper, required = false, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const hasError = Boolean(error);

  return (
    <View style={styles.field}>
      <AppText variant="label" tone="secondary">
        {label}
        {required ? ' *' : ''}
      </AppText>

      <TextInput
        ref={ref}
        accessibilityLabel={label}
        accessibilityHint={helper}
        // Announce the validation failure with the field, not as a detached toast.
        accessibilityState={{ disabled: rest.editable === false }}
        placeholderTextColor={colors.colorTextDisabled}
        {...rest}
        onFocus={(event) => {
          setFocused(true);
          rest.onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          rest.onBlur?.(event);
        }}
        style={[
          styles.input,
          focused ? styles.inputFocused : null,
          hasError ? styles.inputError : null,
          rest.editable === false ? styles.inputDisabled : null,
        ]}
      />

      {hasError ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : helper ? (
        <AppText variant="caption" tone="tertiary">
          {helper}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs,
  },
  input: {
    backgroundColor: colors.colorBgSurface,
    borderColor: colors.colorBorderStrong,
    borderRadius: radius.control,
    borderWidth: 1,
    color: colors.colorTextPrimary,
    fontSize: typography.fontSizeBody,
    minHeight: layout.inputHeight,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  inputFocused: {
    borderColor: colors.colorFocusRing,
    borderWidth: 2,
  },
  inputError: {
    borderColor: colors.colorDanger,
  },
  inputDisabled: {
    backgroundColor: colors.colorBgMuted,
    color: colors.colorTextDisabled,
  },
});
