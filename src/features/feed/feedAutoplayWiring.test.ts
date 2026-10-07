/**
 * The wiring that decides *where* each video is on the page.
 *
 * The coordinator's arithmetic is pinned in `feedPlayback.test.ts`; this file
 * pins the chain of measurements that feeds it, plus the pager gating that keeps
 * a hidden page from holding the coordinator's slot. Every step here has failed
 * in a way that only showed up on a device — autoplay firing when the card's
 * header crossed half the screen, or pausing the instant the video itself filled
 * it — because a number measured in the wrong coordinate space still looks
 * plausible. These assertions are source-level because the components import
 * `react-native`, which this runner is not (the approach `video.test.ts` uses
 * for the same components).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('video positions are measured in scroll-content coordinates', () => {
  const home = read('../../app/(candidate)/home.tsx');
  const feed = read('CommunityFeed.tsx');
  const card = read('FeedPostCard.tsx');

  it('Home publishes its wrapper offset, because the wrapper sits between the ScrollView and the feed', () => {
    // The `feedPullUp` wrapper made the section's own `onLayout` y start at zero
    // inside the wrapper, so every slot was measured a header-and-stories too
    // high — autoplay then fired at the wrong scroll position or never at all.
    expect(home).toMatch(
      /<View\s+style=\{styles\.feedPullUp\}\s+onLayout=\{[\s\S]*?setFeedOriginY\(/,
    );
    expect(home).toContain('originOffset={feedOriginY}');
  });

  it('the feed sums wrapper + section + list offsets into one base', () => {
    expect(feed).toContain('originOffset?: number');
    expect(feed).toContain('const baseOffset = originOffset + feedY + listY;');
  });

  it('the card measures the media band, not just its own top', () => {
    // The coordinator's slot is the *video's* rectangle. Keying it on the card's
    // top alone starts playback when the header crosses half the screen and
    // pauses exactly when the video fills the screen — the moment a reader
    // would most expect it to keep running.
    expect(card).toContain('const mediaTop = top + mediaY;');
    expect(card).toMatch(/style=\{styles\.mediaPad\}[\s\S]*?setMediaY\(nativeEvent\.layout\.y\)/);
    expect(card).toContain('top={mediaTop}');
    // The raw card top must no longer be what reaches the media band.
    expect(card).not.toMatch(/<PostMedia[\s\S]*?top=\{top\}/);
  });
});

describe('only the visible pager page can hold the coordinator slot', () => {
  const postMedia = read('PostMedia.tsx');
  const video = read('PostVideo.tsx');

  it('the pager hands PostVideo its current page', () => {
    expect(postMedia).toContain('current={page === index}');
  });

  it('an off-screen page registers nothing', () => {
    // Two pages of one post carry the same post id, so the later registration
    // would clobber the earlier one and the coordinator would end up holding a
    // target whose owner believes it is still registered.
    const guard = video.indexOf('if (!current) return undefined;');
    const register = video.indexOf('registerVideo({');
    expect(guard).toBeGreaterThan(-1);
    expect(register).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(register);
  });

  it('an off-screen page is paused even though nothing unmounted', () => {
    // Swiping the pager does not unmount the page left behind; without this its
    // player keeps running while the newly visible page starts — two videos of
    // one post playing at once. The body pauses directly rather than through
    // `deactivate()`, whose setState would trip react-hooks/set-state-in-effect.
    expect(video).toContain('if (current) return;');
    expect(video).toMatch(
      /if \(current\) return;\s*\n\s*wanted\.current = false;\s*\n\s*playerApi\.current\?\.pause\(\);/,
    );
  });

  it('a hidden page never reports itself as playing', () => {
    expect(video).toContain('getActiveVideoId() === postId && current && !pausedByHand.current');
  });
});
