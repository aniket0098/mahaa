/**
 * Publish never overlaps the Android status bar.
 *
 * Source-level (the `feedAutoplayWiring.test.ts` approach): the composers and
 * their style module import react-native, which this runner is not. The point
 * being guarded is narrow — the header that carries Publish renders inside
 * the real safe-area inset on every create screen, with no fixed paddingTop
 * anywhere near it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('Publish clears the Android status bar on every create screen', () => {
  const post = read('../../app/(candidate)/add-post.tsx');
  const story = read('../../app/(candidate)/add-story.tsx');
  const styles = read('composerStyles.ts');

  it('the header style carries the safe-area surface, never a fixed offset', () => {
    expect(styles).toContain('headerSafeArea: { backgroundColor: colors.colorBgSurface }');
    expect(styles).not.toMatch(/headerSafeArea[\s\S]*?paddingTop/);
  });

  it('Create Post renders Publish inside the safe-area wrapper', () => {
    expect(post).toContain('<View style={[s.headerSafeArea, { paddingTop: insets.top }]}>');
    expect(post).not.toMatch(/paddingTop:\s*\d/);
  });

  it('Create Story renders Publish inside the safe-area wrapper', () => {
    expect(story).toContain('<View style={[s.headerSafeArea, { paddingTop: insets.top }]}>');
    expect(story).not.toMatch(/paddingTop:\s*\d/);
  });

  it('scrolling content respects the bottom inset with the keyboard', () => {
    expect(post).toContain('paddingBottom: spacing.huge + insets.bottom');
    expect(story).toContain('paddingBottom: insets.bottom + spacing.huge');
  });
});
