/**
 * Demo lesson detail — an honest preview state for sample lessons.
 *
 * Demo lessons carry no server lecture id and no media source, so they
 * cannot be played in the lecture player. This screen shows the lesson
 * information and clearly communicates that playback is not yet available.
 */

import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BackButton } from '@/components/ui/BackButton';
import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { DEMO_PLAYLIST } from '@/features/learningHub/demoPlaylist';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';

export default function DemoLessonScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();

  const demoId = typeof params.id === 'string' ? params.id : String(params.id ?? '');

  const demoLecture = DEMO_PLAYLIST.lectures.find((l) => l.id === demoId);

  const handleBack = () => { void router.navigate('/learn' as never); };

  if (!demoLecture) {
    return (
      <Screen style={styles.screen}>
        <View style={styles.container}>
          <AppText variant="h3" weight="semibold" style={styles.title}>
            Demo lesson not found
          </AppText>
          <Button label="Back to Lectures" variant="primary" fullWidth onPress={handleBack} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen style={styles.screen}>
      <View style={styles.container}>
        <BackButton onPress={handleBack} />

        <Card style={styles.card}>
          <View style={styles.cardBody}>
            <Badge tone="info" style={styles.demoBadge}>DEMO</Badge>
            <AppText variant="h1" weight="semibold" style={styles.title}>
              {demoLecture.title}
            </AppText>
            <AppText variant="small" tone="secondary" style={styles.playlistLabel}>
              {DEMO_PLAYLIST.title}
            </AppText>
            {demoLecture.description ? (
              <AppText variant="body" tone="secondary" style={styles.description}>
                {demoLecture.description}
              </AppText>
            ) : null}
            <View style={styles.noticeWrap}>
              <View style={styles.noticeIconWrap}>
                <AppIcon name={{ ios: 'information.circle', android: 'info' }} size={20} color={colors.colorTextTertiary} />
              </View>
              <AppText variant="small" tone="secondary" style={styles.noticeText}>
                This is a sample lesson. Video playback is not yet available for demo content.
              </AppText>
            </View>
          </View>
        </Card>

        <Button label="Back to Lectures" variant="secondary" fullWidth onPress={handleBack} style={styles.backButton} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.colorBgPage },
  container: { paddingHorizontal: spacing.pagePadding, paddingTop: spacing.pagePadding, paddingBottom: spacing.xl, gap: spacing.lg },
  card: { borderRadius: radius.card, borderWidth: 1, borderColor: colors.colorBorder },
  cardBody: { padding: spacing.lg, gap: spacing.sm },
  demoBadge: { alignSelf: 'flex-start', minHeight: 22, paddingHorizontal: spacing.xs },
  title: { marginBottom: spacing.xs },
  playlistLabel: { fontSize: typography.fontSizeCaption, color: colors.colorTextSecondary, textTransform: 'uppercase', marginBottom: spacing.xs },
  description: { lineHeight: typography.lineHeightBody, marginBottom: spacing.md },
  noticeWrap: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, backgroundColor: colors.colorBgMuted, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.sm },
  noticeIconWrap: { marginTop: 2 },
  noticeText: { flex: 1, lineHeight: typography.lineHeightBody },
  backButton: { marginTop: spacing.md, minHeight: layout.touchTargetPrimary },
});
