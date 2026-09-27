/**
 * Brand mark — the one place the MahaJob identity is drawn, so the landing hero,
 * the auth screens, and the app header cannot drift apart.
 *
 * Drawn with views rather than an image asset: it stays crisp at every density
 * and needs no font or image loading, which keeps first paint instant.
 */

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { colors, radius, spacing, typography } from '@/theme/tokens';

export interface BrandMarkProps {
  /** `inverse` for the navy landing surface, `default` for light product screens. */
  tone?: 'default' | 'inverse';
  size?: 'sm' | 'md' | 'lg';
  /** Hide the wordmark and render the glyph alone. */
  glyphOnly?: boolean;
}

const glyphSize = { sm: 28, md: 36, lg: 48 } as const;

export function BrandMark({ tone = 'default', size = 'md', glyphOnly = false }: BrandMarkProps) {
  const dimension = glyphSize[size];
  const inverse = tone === 'inverse';

  return (
    <View style={styles.row}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={[
          styles.glyph,
          {
            width: dimension,
            height: dimension,
            borderRadius: dimension / 3,
            backgroundColor: inverse ? colors.landingAccentStrong : colors.colorPrimary,
          },
        ]}>
        <AppText
          variant="h2"
          weight="bold"
          style={{ color: colors.colorOnPrimary, fontSize: dimension * 0.5, lineHeight: dimension * 0.62 }}>
          M
        </AppText>
      </View>

      {glyphOnly ? null : (
        <View>
          <AppText
            variant="h2"
            weight="bold"
            tone={inverse ? 'inverse' : 'primary'}
            style={styles.wordmark}>
            MahaJob
          </AppText>
          <AppText variant="caption" tone={inverse ? 'inverse' : 'tertiary'}>
            Academia × Industry
          </AppText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  glyph: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  wordmark: {
    letterSpacing: typography.fontWeightBold === '700' ? -0.2 : 0,
  },
});
