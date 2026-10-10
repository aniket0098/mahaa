/**
 * OpportunityEmptyState — the honest "nothing to show" block, with a visual
 * anchor, a plain explanation, and one working action.
 *
 * A bare line of text reads as a bug; a soft icon circle reads as a decision.
 * The icon is decoration behind a real label, so it is never the only signal.
 * The caller picks the icon per cause (no search match / no filter match /
 * nothing published) and supplies the action that actually recovers — clear the
 * search, clear the filters, or nothing at all when there is genuinely nothing
 * to do but wait.
 *
 * It is the body inside a `Card`; the surrounding list supplies that surface.
 */

import { View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { colors } from '@/theme/tokens';

import { styles } from './discoverStyles';

export interface OpportunityEmptyStateProps {
  icon: { ios: string; android: string };
  title: string;
  description: string;
  action?: { label: string; onPress: () => void };
}

export function OpportunityEmptyState({ icon, title, description, action }: OpportunityEmptyStateProps) {
  return (
    <View style={styles.emptyState}>
      <View style={styles.emptyIconCircle}>
        <AppIcon name={icon} size={28} color={colors.colorPrimary} />
      </View>
      <AppText variant="h3" weight="semibold" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      <AppText variant="small" tone="secondary" style={{ textAlign: 'center' }}>
        {description}
      </AppText>
      {action ? (
        <Button label={action.label} variant="secondary" onPress={action.onPress} />
      ) : null}
    </View>
  );
}
