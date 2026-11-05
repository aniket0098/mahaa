/**
 * MessageSearchField — the rounded search input for the Messages header.
 *
 * A plain `TextInput` styled to the reference, not the shared `TextField`: this
 * is a single local filter over the threads and requests already loaded (member
 * names and the last message — never a claim to search the server). 48px high,
 * per the input rule, with a clear affordance so a stale filter cannot strand
 * the reader on an empty list.
 */

import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';

export interface MessageSearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
}

export function MessageSearchField({
  value,
  onChangeText,
  placeholder = 'Search messages',
}: MessageSearchFieldProps) {
  return (
    <View style={styles.wrap}>
      <AppIcon name={{ ios: 'magnifyingglass', android: 'search' }} size={18} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.colorTextTertiary}
        accessibilityLabel="Search messages"
        accessibilityHint="Filters the conversations loaded on this screen"
        style={styles.input}
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        testID="messages-search"
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => onChangeText('')}
          hitSlop={layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          style={styles.clear}>
          <AppIcon name={{ ios: 'xmark.circle.fill', android: 'cancel' }} size={16} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.control,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: layout.inputHeight,
    paddingHorizontal: spacing.md,
  },
  input: {
    color: colors.colorTextPrimary,
    flex: 1,
    fontSize: typography.fontSizeBody,
    // Android renders a taller line than iOS at the same font size; pin it so
    // the field never overflows its 48px box.
    paddingVertical: spacing.sm,
  },
  clear: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.touchTargetSecondary,
    minWidth: layout.touchTargetSecondary,
  },
});
