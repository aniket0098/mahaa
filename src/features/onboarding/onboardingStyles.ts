/**
 * Shared styles and constants for the onboarding steps.
 *
 * Pulled out because the steps live in separate files (one per concern, rather
 * than one very long module) and would otherwise each re-declare the same card
 * gap and chip treatment — which is how two visually identical steps drift apart.
 */

import { StyleSheet } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

/** Mirrors `app.schemas.profile.ProfileIdentityUpdate` bounds. */
export const HEADLINE_MAX = 200;
export const SUMMARY_MAX = 4000;
export const LOCATION_MAX = 160;
export const INTEREST_MAX = 80;
export const INTERESTS_MAX = 20;
/**
 * Mirrors `app.schemas.profile.EducationCreate` bounds.
 */
export const INSTITUTION_MAX = 200;
export const DEGREE_MAX = 120;

/**
 * The server's own skills rule (`completeness_service`): three catalog skills are
 * what earn the section's completion, so three is what this screen asks for. It is
 * a recommendation rather than a hard block — the step is skippable either way.
 */
export const MIN_SKILLS = 3;

/*
 * The work-mode, employment-type and preference-list constants that used to live
 * here went with the onboarding `preferences` step. `/profile/preferences` has
 * always declared its own copies inline next to the form that uses them, which is
 * where they belong: they are that screen's options, not a shared wizard constant
 * that a second screen happened to import.
 */

export const stepStyles = StyleSheet.create({
  card: { gap: spacing.md },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    backgroundColor: colors.colorPrimarySubtle,
    // `full` is the token that means "rounds to a capsule". There is no `pill`
    // token, and inventing a raw number here is exactly what the token rules
    // forbid — the same shape is spelled `radius.full` everywhere else.
    borderRadius: radius.full,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipLabel: { color: colors.colorPrimary },
  results: { gap: spacing.xs },
  result: {
    alignItems: 'center',
    borderColor: colors.colorBorder,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resultCopy: { flex: 1, gap: 2 },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  choice: {
    alignItems: 'center',
    borderColor: colors.colorBorder,
    borderRadius: radius.full,
    borderWidth: 1,
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  choiceSelected: { backgroundColor: colors.colorPrimarySubtle, borderColor: colors.colorPrimary },
  /** A square thumbnail for the upload steps, so a big photo does not stretch a card. */
  preview: {
    borderRadius: radius.card,
    height: 96,
    width: 96,
  },
});
