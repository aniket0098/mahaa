import { describe, expect, it } from 'vitest';

import {
  applicationStatusVisuals,
  colors,
  layout,
  spacing,
  type ApplicationStatus,
} from '@/theme/tokens';

const APPLICATION_STATUSES: ApplicationStatus[] = [
  'applied',
  'under_review',
  'shortlisted',
  'interview',
  'offer',
  'hired',
  'rejected',
  'withdrawn',
];

describe('application status vocabulary (docs/DESIGN_TOKENS §4)', () => {
  it('covers every documented status', () => {
    expect(Object.keys(applicationStatusVisuals).sort()).toEqual(
      [...APPLICATION_STATUSES].sort(),
    );
  });

  it('gives every status a label and both platform icons', () => {
    for (const status of APPLICATION_STATUSES) {
      const visual = applicationStatusVisuals[status];
      expect(visual.label.length).toBeGreaterThan(0);
      expect(visual.icon.ios.length).toBeGreaterThan(0);
      expect(visual.icon.android.length).toBeGreaterThan(0);
      expect(visual.fg).toMatch(/^#/);
      expect(visual.bg).toMatch(/^#/);
    }
  });

  it('humanises `rejected` without renaming the stored enum', () => {
    expect(applicationStatusVisuals.rejected.label).toBe('Not selected');
  });
});

describe('design tokens', () => {
  it('enforces the 48px minimum primary touch target', () => {
    expect(layout.touchTargetPrimary).toBeGreaterThanOrEqual(48);
    expect(layout.touchTargetSecondary).toBeGreaterThanOrEqual(44);
    expect(layout.inputHeight).toBeGreaterThanOrEqual(48);
  });

  it('exposes an 8px-based spacing scale', () => {
    expect(spacing.xs % 4).toBe(0);
    expect(spacing.lg).toBe(16);
  });

  it('defines the semantic tokens components are allowed to use', () => {
    // Components must never reach for a raw hex; these are the names they use.
    expect(colors.colorPrimary).toMatch(/^#/);
    expect(colors.colorTextPrimary).toMatch(/^#/);
    expect(colors.colorBgPage).toMatch(/^#/);
    expect(colors.colorBorder).toMatch(/^#/);
    expect(colors.colorFocusRing).toMatch(/^#/);
  });
});
