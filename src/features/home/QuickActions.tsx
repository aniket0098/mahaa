/**
 * Quick actions — the six shortcut chips below the composer.
 *
 * Native reproduction of `QuickActions.tsx` + `quickActionItems.ts` +
 * `dashboardHome.module.css`, keeping the specified order exactly.
 *
 * The rule that matters here: an action whose destination does not exist renders
 * as a **labelled, non-interactive** "Soon" note rather than a dead button.
 * "Find Teammates" and "Explore Innovation" have no route and no backend, so
 * tapping them must not go anywhere — a tappable chip that leads nowhere is the
 * exact failure this pattern prevents.
 *
 * Every available action points at a route that really exists, so no navigation
 * item on the home page is a dead end.
 */

import { useRouter } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/home/homeStyles';

type QuickActionAvailability =
  | { status: 'available'; to: string }
  | { status: 'not-available'; note: string };

interface QuickAction {
  key: string;
  label: string;
  icon: { ios: string; android: string };
  availability: QuickActionAvailability;
}

/** Fixed order, mirroring `dashboardQuickActions`. */
const ACTIONS: readonly QuickAction[] = [
  {
    key: 'opportunities',
    label: 'Explore Opportunities',
    icon: { ios: 'safari', android: 'explore' },
    availability: { status: 'available', to: '/jobs' },
  },
  {
    key: 'learning',
    label: 'Continue Learning',
    icon: { ios: 'graduationcap', android: 'school' },
    availability: { status: 'available', to: 'learning' },
  },
  {
    key: 'project',
    label: 'Share a Project',
    icon: { ios: 'folder', android: 'folder' },
    availability: { status: 'available', to: '/profile/projects' },
  },
  {
    key: 'teammates',
    label: 'Find Teammates',
    icon: { ios: 'person.2', android: 'group' },
    availability: { status: 'not-available', note: 'Arrives with the community stage.' },
  },
  {
    key: 'innovation',
    label: 'Explore Innovation',
    icon: { ios: 'lightbulb', android: 'lightbulb' },
    availability: { status: 'not-available', note: 'Arrives with the innovation stage.' },
  },
  {
    key: 'skills',
    label: 'Improve Skills',
    icon: { ios: 'target', android: 'my_location' },
    availability: { status: 'available', to: '/profile/skills' },
  },
];

export interface QuickActionsProps {
  /**
   * Scrolls the page to the in-page "Continue Learning" section.
   *
   * The web version anchors this action to `#home-learning`. There is no separate
   * learning route to push, so the parent owns the scroll container and supplies
   * the handler — inventing a `/learning` route would be dead navigation.
   */
  onScrollToLearning: () => void;
}

export function QuickActions({ onScrollToLearning }: QuickActionsProps) {
  const router = useRouter();

  return (
    <View style={styles.quickActions} testID="quick-actions">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.quickActionsList}>
        {ACTIONS.map((action) =>
          action.availability.status === 'available' ? (
            <Pressable
              key={action.key}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={styles.quickAction}
              onPress={() => {
                if (action.availability.status !== 'available') return;
                if (action.availability.to === 'learning') {
                  onScrollToLearning();
                  return;
                }
                router.push(action.availability.to as never);
              }}>
              <AppIcon name={action.icon} size={18} color={colors.colorTextPrimary} />
              <AppText variant="small" weight="medium" style={styles.quickActionLabel}>
                {action.label}
              </AppText>
            </Pressable>
          ) : (
            <View
              key={action.key}
              accessible
              accessibilityLabel={`${action.label}. Not available yet. ${action.availability.note}`}
              // Not pressable on purpose: there is nowhere to go.
              style={styles.quickActionSoon}>
              <AppIcon name={action.icon} size={18} color={colors.colorTextTertiary} />
              <AppText variant="small" weight="medium" tone="tertiary" style={styles.quickActionLabel}>
                {action.label}
              </AppText>
              <AppText variant="caption" weight="semibold" tone="tertiary" style={styles.soonTag}>
                Soon
              </AppText>
            </View>
          ),
        )}
      </ScrollView>
    </View>
  );
}
