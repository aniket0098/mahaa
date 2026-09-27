/**
 * Feed engagement bar — rendered, but honest.
 *
 * Native reproduction of `FeedActionBar.tsx`.
 *
 * There is no posts or engagement API, so none of these controls can work and no
 * count can be shown. Each renders in the disabled treatment with a visible
 * "Coming soon" note rather than a fabricated number: the layout is reviewable,
 * and both a sighted user and a screen reader are told the feature is not live.
 * The controls are `disabled` rather than fake-interactive, so a tap does
 * nothing and nothing is implied.
 */

import { View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/home/homeStyles';

const ACTIONS = [
  { key: 'like', label: 'Like', icon: { ios: 'heart', android: 'favorite' } },
  { key: 'comment', label: 'Comment', icon: { ios: 'bubble.left', android: 'chat' } },
  { key: 'share', label: 'Share', icon: { ios: 'square.and.arrow.up', android: 'share' } },
  { key: 'bookmark', label: 'Bookmark', icon: { ios: 'bookmark', android: 'bookmark' } },
] as const;

export function FeedActionBar() {
  return (
    <View style={styles.actions} testID="feed-action-bar">
      <View style={styles.actionList}>
        {ACTIONS.map((action) => (
          <View
            key={action.key}
            accessible
            accessibilityLabel={`${action.label} — coming soon`}
            accessibilityState={{ disabled: true }}
            style={styles.actionButton}>
            <AppIcon name={action.icon} size={18} color={colors.colorTextDisabled} />
            <AppText variant="small" weight="medium" tone="disabled">
              {action.label}
            </AppText>
          </View>
        ))}
      </View>
      <AppText variant="caption" tone="disabled" style={styles.actionsNote}>
        Coming soon
      </AppText>
    </View>
  );
}
