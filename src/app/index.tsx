/**
 * Public landing screen (docs/SCREEN_DESIGN_RULES.md — Landing).
 *
 * Public by design: no route guard, no data fetching, no fabricated metrics.
 * The "What works today" band lists only surfaces backed by a real FastAPI
 * endpoint; the "Arriving in later stages" band is the honest alternative to a
 * screen full of placeholder numbers.
 *
 * The hero uses the navy public surface (DESIGN_TOKENS §14); every band below
 * switches back to the light semantic tokens, so the product keeps its
 * light-first identity.
 */

import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/components/ui/AppText';
import { BrandMark } from '@/components/ui/BrandMark';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { useAuth } from '@/auth/AuthContext';
import { homePathForRole } from '@/auth/roleHome';
import { HIGHLIGHTS, LATER_STAGES, LIVE_SURFACES, PILLARS } from '@/features/landing/content';
import { landingStyles as styles } from '@/features/landing/landingStyles';
import { colors, spacing } from '@/theme/tokens';

export default function LandingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, principal } = useAuth();

  const isAuthenticated = status === 'authenticated';
  const primaryLabel = isAuthenticated ? 'Open your dashboard' : 'Create your account';
  // A signed-in visitor returns to their own tree, so the landing page never
  // becomes a way into the other role's navigation.
  const primaryAction = () =>
    router.push(
      (isAuthenticated ? homePathForRole(principal?.role ?? 'candidate') : '/signup') as never,
    );

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + spacing.xxl }}
        showsVerticalScrollIndicator={false}>
        {/* Hero — navy public surface */}
        <View style={[styles.hero, { paddingTop: insets.top + spacing.xl }]}>
          <BrandMark tone="inverse" size="lg" />

          <View style={styles.heroCopy}>
            <AppText variant="label" tone="inverse" uppercase style={styles.eyebrow}>
              Academia × Industry
            </AppText>
            <AppText variant="display" tone="inverse" weight="bold">
              Turn your skills into real opportunities.
            </AppText>
            <AppText variant="body" tone="inverse" style={styles.lead}>
              Build an industry-ready profile today. MahaJob is building a clearer path from your
              skills to practical projects, internships, and jobs.
            </AppText>
          </View>

          <View style={styles.heroActions}>
            <Button label={primaryLabel} size="lg" fullWidth onPress={primaryAction} />
            {isAuthenticated ? null : (
              <Button
                label="I already have an account"
                size="lg"
                variant="ghost"
                fullWidth
                onPress={() => router.push('/login' as never)}
              />
            )}
          </View>

          <View style={styles.chips}>
            {HIGHLIGHTS.map((item) => (
              <View key={item} style={styles.chip}>
                <AppText variant="caption" tone="inverse">
                  {item}
                </AppText>
              </View>
            ))}
          </View>
        </View>


        {/* Pillars — light semantic surface */}
        <View style={styles.band}>
          <AppText variant="h2" accessibilityRole="header">
            What MahaJob connects
          </AppText>
          <AppText variant="body" tone="secondary">
            One honest loop: profile → skills → match → apply → track → interview → hire.
          </AppText>
          {PILLARS.map((pillar) => (
            <Card key={pillar.title} style={styles.pillar}>
              <AppText variant="h3">{pillar.title}</AppText>
              <AppText variant="small" tone="secondary">
                {pillar.body}
              </AppText>
            </Card>
          ))}
        </View>

        {/* Honest status */}
        <View style={styles.band}>
          <AppText variant="h2" accessibilityRole="header">
            What works today
          </AppText>
          <AppText variant="body" tone="secondary">
            This release ships the account, profile, skills, resume, and company foundations. Every
            item below is backed by a real API response.
          </AppText>
          <Card>
            <BulletList items={LIVE_SURFACES} tone="success" />
          </Card>

          <AppText variant="h2" accessibilityRole="header" style={styles.spaced}>
            Arriving in later stages
          </AppText>
          <AppText variant="body" tone="secondary">
            We would rather show an honest “not yet” than a screen full of invented numbers.
          </AppText>
          <Card>
            <BulletList items={LATER_STAGES} tone="tertiary" />
          </Card>
        </View>

        {/* Closing CTA */}
        <View style={[styles.band, styles.closing]}>
          <AppText variant="h2" tone="inverse" accessibilityRole="header">
            Ready when you are
          </AppText>
          <AppText variant="body" tone="inverse">
            Create an account and start building a profile a recruiter can actually read.
          </AppText>
          <Button
            label={primaryLabel}
            size="lg"
            fullWidth
            onPress={primaryAction}
            style={styles.closingButton}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function BulletList({ items, tone }: { items: readonly string[]; tone: 'success' | 'tertiary' }) {
  return (
    <View style={styles.list}>
      {items.map((item) => (
        <View key={item} style={styles.listRow}>
          <View
            style={[
              styles.bullet,
              {
                backgroundColor:
                  tone === 'success' ? colors.colorSuccess : colors.colorBorderStrong,
              },
            ]}
          />
          <AppText variant="small" tone={tone === 'success' ? 'primary' : 'secondary'}>
            {item}
          </AppText>
        </View>
      ))}
    </View>
  );
}
