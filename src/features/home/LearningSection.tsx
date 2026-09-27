/**
 * Continue Learning — the fourth section.
 *
 * Native reproduction of `LearningSection.tsx`.
 *
 * There is no courses/learning API or route, so this renders the section header
 * and an honest empty state — no invented courses and no invented progress. The
 * real skills and learning records a candidate has live on their profile, and
 * the action goes there.
 */

import { useRouter } from 'expo-router';
import { View } from 'react-native';

import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { colors } from '@/theme/tokens';
import { styles } from '@/features/home/homeStyles';

export interface LearningSectionProps {
  /** Reports this section's Y offset so the page can scroll to it. */
  onLayout: (y: number) => void;
}

export function LearningSection({ onLayout }: LearningSectionProps) {
  const router = useRouter();

  return (
    <View
      style={styles.section}
      testID="learning-section"
      onLayout={(event) => onLayout(event.nativeEvent.layout.y)}>
      <View style={styles.sectionHeader}>
        <AppText variant="h2" weight="semibold" accessibilityRole="header">
          Continue Learning
        </AppText>
      </View>
      <Card>
        <View style={styles.emptyState}>
          <AppIcon
            name={{ ios: 'graduationcap', android: 'school' }}
            size={24}
            color={colors.colorTextTertiary}
          />
          <AppText variant="body" weight="semibold">
            No learning resources are available yet.
          </AppText>
          <AppText variant="body" tone="secondary">
            Courses, progress tracking, and certificates arrive with the learning stage. Your
            skills and learning records live on your profile today.
          </AppText>
          <Button label="Open your profile" onPress={() => router.push('/profile' as never)} />
        </View>
      </Card>
    </View>
  );
}
