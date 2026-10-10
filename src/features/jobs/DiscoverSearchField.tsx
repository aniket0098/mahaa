/**
 * DiscoverSearchField — the opportunity search box.
 *
 * A controlled `TextInput` wired to the real `q` parameter of
 * `GET /opportunities`. It is deliberately **not** an autocomplete: the API has
 * no suggestion route, so the field never fabricates one. Debouncing lives in
 * the screen (`useDebouncedValue`), which keeps this component a plain
 * controlled input that always echoes what was typed.
 */

import { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { colors } from '@/theme/tokens';
import { styles } from './discoverStyles';

export interface DiscoverSearchFieldProps {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit?: () => void;
}

export function DiscoverSearchField({ value, onChangeText, onSubmit }: DiscoverSearchFieldProps) {
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  return (
    <View style={[styles.searchWrap, focused ? styles.searchWrapFocused : null]}>
      <AppIcon name={{ ios: 'magnifyingglass', android: 'search' }} size={18} color={colors.colorTextTertiary} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={() => {
          onSubmit?.();
          setFocused(false);
        }}
        placeholder="Search jobs, internships, companies…"
        placeholderTextColor={colors.colorTextDisabled}
        accessibilityLabel="Search opportunities"
        returnKeyType="search"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.searchInput}
      />
      {value.length > 0 ? (
        <Pressable
          onPress={() => {
            onChangeText('');
            inputRef.current?.focus();
          }}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={8}
          style={styles.searchClear}>
          <AppIcon name={{ ios: 'xmark.circle.fill', android: 'cancel' }} size={18} color={colors.colorTextTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

