/**
 * Career snapshot — the last section.
 *
 * Native reproduction of `CareerSnapshot.tsx` + `dashboardHome.module.css`.
 *
 * Every value shown is real, and the completeness number is the server's:
 * `profile.completeness.percent` comes from `GET /profile` and is never computed
 * or estimated here. The blocks are a single column on a phone (the web grid is
 * `1fr` below 768px, `2fr` at 768px, `3fr` at 1024px).
 *
 * **The completeness indicator is a horizontal bar, not a ring.** The original is
 * an 8px `.completenessTrack` with a rounded `.completenessFill`; there is no
 * circular progress indicator anywhere in the original candidate home, so none
 * is drawn here. It is exposed to assistive tech as a `progressbar` carrying the
 * real value, exactly as the web markup does with `aria-valuenow`.
 *
 * "Career readiness" and "Career goal" have no computed source and no schema
 * field, so those blocks say so plainly instead of showing a score.
 */

import { useRouter } from 'expo-router';
import { Pressable, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { styles } from '@/features/home/homeStyles';
import type { ProfileAggregate } from '@/types/profile';

export interface CareerSnapshotProps {
  status: 'loading' | 'error' | 'ready';
  profile?: ProfileAggregate;
  errorMessage?: string | null;
  onRetry?: () => void;
}

function BlockLabel({ children }: { children: string }) {
  return (
    <AppText variant="caption" weight="semibold" tone="tertiary" style={styles.careerLabel}>
      {children}
    </AppText>
  );
}

export function CareerSnapshot({ status, profile, errorMessage, onRetry }: CareerSnapshotProps) {
  const router = useRouter();

  if (status === 'loading') {
    return (
      <View style={styles.section} testID="career-snapshot">
        <SkeletonCard lines={4} />
      </View>
    );
  }

  if (status === 'error' || !profile) {
    return (
      <View style={styles.section} testID="career-snapshot">
        <View style={styles.sectionHeader}>
          <AppText variant="h2" weight="semibold" accessibilityRole="header">
            Career snapshot
          </AppText>
        </View>
        <Card>
          <StatusBanner
            title="Your career snapshot could not load"
            description={errorMessage ?? 'The API did not answer.'}
            onRetry={onRetry}
          />
        </Card>
      </View>
    );
  }

  const { completeness, skills, preferences } = profile;
  const percent = Math.max(0, Math.min(100, Math.round(completeness.percent)));
  const nextSection = completeness.sections.find((section) => !section.complete);
  const shownSkills = skills.slice(0, 6);

  return (
    <View style={styles.section} testID="career-snapshot">
      <View style={styles.sectionHeader}>
        <AppText variant="h2" weight="semibold" accessibilityRole="header">
          Career snapshot
        </AppText>
        <Badge tone="neutral">From your profile</Badge>
      </View>

      <Card>
        <View style={styles.careerGrid}>
          <View style={styles.careerBlock}>
            <BlockLabel>PROFILE COMPLETENESS</BlockLabel>
            <View
              accessible
              accessibilityRole="progressbar"
              accessibilityLabel="Profile completeness"
              accessibilityValue={{ min: 0, max: 100, now: percent }}
              style={styles.completenessTrack}>
              <View style={[styles.completenessFill, { width: `${percent}%` }]} />
            </View>
            <AppText variant="h3" weight="semibold" style={styles.careerValue}>
              {percent}% complete
            </AppText>
            <AppText variant="small" tone="secondary" style={styles.careerText}>
              {nextSection
                ? `${nextSection.label}: ${nextSection.hint || 'this section is still open.'}`
                : completeness.sections.length > 0
                  ? 'Every profile section is complete.'
                  : 'No profile sections are recorded yet.'}
            </AppText>
            <ActionLink
              label={nextSection ? 'Continue profile' : 'Review profile'}
              onPress={() => router.push('/profile' as never)}
            />
          </View>
          <View style={styles.careerBlock}>
            <BlockLabel>WHAT YOU ARE LOOKING FOR</BlockLabel>
            {preferences ? (
              <>
                <View style={styles.careerChips}>
                  {preferences.employment_types.map((type) => (
                    <Badge key={type} tone="primary">
                      {type.replace('_', ' ')}
                    </Badge>
                  ))}
                  {preferences.work_modes.map((mode) => (
                    <Badge key={mode} tone="neutral">
                      {mode}
                    </Badge>
                  ))}
                </View>
                <AppText variant="small" tone="secondary" style={styles.careerText}>
                  {preferences.preferred_locations.length > 0
                    ? `Preferred locations: ${preferences.preferred_locations.join(', ')}`
                    : 'No preferred locations saved yet.'}
                </AppText>
              </>
            ) : (
              <>
                <AppText variant="small" tone="secondary" style={styles.careerText}>
                  Add your job preferences so opportunities can be matched to what you want.
                </AppText>
                <ActionLink
                  label="Add preferences"
                  onPress={() => router.push('/profile' as never)}
                />
              </>
            )}
          </View>

          <View style={styles.careerBlock}>
            <BlockLabel>SKILLS ON YOUR PROFILE</BlockLabel>
            {shownSkills.length > 0 ? (
              <>
                <View style={styles.careerChips}>
                  {shownSkills.map((skill) => (
                    <Badge key={skill.id} tone="primary">
                      {`${skill.name} · ${skill.level}`}
                    </Badge>
                  ))}
                </View>
                <ActionLink
                  label="Improve skills"
                  onPress={() => router.push('/profile/skills' as never)}
                />
              </>
            ) : (
              <>
                <AppText variant="small" tone="secondary" style={styles.careerText}>
                  No skills saved yet. Skills you add are what matching and readiness build on
                  later.
                </AppText>
                <ActionLink
                  label="Add skills"
                  onPress={() => router.push('/profile/skills' as never)}
                />
              </>
            )}
          </View>

          <View style={styles.careerBlock}>
            <BlockLabel>CAREER READINESS</BlockLabel>
            <AppText variant="small" tone="secondary" style={styles.careerText}>
              A readiness score appears only when it is computed from real requirements — MahaJob
              does not show an estimated percentage.
            </AppText>
            <AppText variant="small" tone="secondary" style={styles.careerText}>
              Skill analysis, career matching, and coaching arrive in later stages.
            </AppText>
          </View>

          <View style={styles.careerBlock}>
            <BlockLabel>CAREER GOAL</BlockLabel>
            <AppText variant="small" tone="secondary" style={styles.careerText}>
              A career goal is not part of your profile yet. Until it is, this snapshot stays based
              on your real profile, skills, and preferences.
            </AppText>
          </View>
        </View>
      </Card>
    </View>
  );
}

/** The original `DashboardActionLink`: a button-shaped link to a real route. */
function ActionLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      onPress={onPress}>
      <AppText variant="small" weight="medium" tone="accent" style={styles.careerLink}>
        {label}
      </AppText>
    </Pressable>
  );
}
