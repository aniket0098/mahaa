/**
 * Candidate profile.
 *
 * One request to `GET /profile` renders identity, the server-derived
 * completeness breakdown, and every stored section. The percentage is the
 * server's, never a client estimate.
 *
 * Each section links to its own screen, which reads and writes the matching
 * `/profile/<section>` endpoints. The app therefore shows only what the API can
 * actually store — no editor that pretends to save before the endpoint exists.
 */

import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { View } from 'react-native';

import { fetchProfile } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ProgressMeter } from '@/components/ui/ProgressMeter';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { styles } from '@/features/profile/profileStyles';
import { colors, spacing } from '@/theme/tokens';

const SECTIONS = [
  { path: '/profile/skills', title: 'Skills', countKey: 'skills' },
  { path: '/profile/education', title: 'Education', countKey: 'education' },
  { path: '/profile/experience', title: 'Experience', countKey: 'experience' },
  { path: '/profile/projects', title: 'Projects', countKey: 'projects' },
] as const;

export default function CandidateProfileScreen() {
  const router = useRouter();
  const profile = useQuery({
    queryKey: queryKeys.profile,
    queryFn: fetchProfile,
    retry: false,
  });

  if (profile.isPending) {
    return (
      <Screen testID="profile-screen">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={4} />
      </Screen>
    );
  }

  if (profile.isError) {
    return (
      <Screen testID="profile-screen">
        <StatusBanner
          title="Could not load your profile"
          description={
            profile.error instanceof Error ? profile.error.message : 'The API did not answer.'
          }
          onRetry={() => void profile.refetch()}
        />
      </Screen>
    );
  }

  const data = profile.data;
  if (!data) return null;
  const { identity, completeness } = data;

  return (
    <Screen testID="profile-screen">
      <View style={styles.stack}>
        <View style={styles.header}>
          <AppText variant="h1" accessibilityRole="header">
            {identity.name}
          </AppText>
          <AppText variant="body" tone="secondary">
            {identity.headline ?? 'Add a headline so a recruiter knows what you do.'}
          </AppText>
          {identity.location ? (
            <AppText variant="small" tone="tertiary">
              {identity.location}
            </AppText>
          ) : null}
        </View>

        <Card style={styles.card}>
          <ProgressMeter
            value={completeness.percent}
            label="Profile completeness"
            caption="Calculated by the server, not this app."
          />
          <View style={styles.sections}>
            {completeness.sections.map((section) => (
              <View key={section.key} style={styles.sectionRow}>
                <View
                  style={[
                    styles.marker,
                    {
                      backgroundColor: section.complete
                        ? colors.colorSuccess
                        : colors.colorBorderStrong,
                    },
                  ]}
                />
                <View style={styles.sectionText}>
                  <AppText variant="small" weight="semibold">
                    {section.label}
                  </AppText>
                  <AppText variant="caption" tone="tertiary">
                    {section.hint}
                  </AppText>
                </View>
              </View>
            ))}
          </View>
        </Card>

        {SECTIONS.map((section) => {
          const count = data[section.countKey].length;
          return (
            <Card
              key={section.path}
              accessibilityLabel={`Open ${section.title}`}
              onPress={() => router.push(section.path as never)}
              style={styles.card}
            >
              <SectionHeader
                title={section.title}
                description={count === 1 ? '1 entry' : `${count} entries`}
              />
              <AppText variant="small" tone="tertiary">
                {count === 0 ? 'Nothing added yet.' : 'Tap to review and edit.'}
              </AppText>
            </Card>
          );
        })}

        <Card style={styles.card}>
          <SectionHeader title="Account" />
          <Button
            label="Notifications"
            variant="ghost"
            fullWidth
            onPress={() => router.push('/notifications' as never)}
          />
          <Button
            label="Settings"
            variant="ghost"
            fullWidth
            onPress={() => router.push('/settings' as never)}
          />
        </Card>

        <Button
          label="Refresh"
          variant="ghost"
          fullWidth
          onPress={() => void profile.refetch()}
        />
      </View>
    </Screen>
  );
}