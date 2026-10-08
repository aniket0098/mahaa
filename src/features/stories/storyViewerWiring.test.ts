/**
 * The wiring that keeps the story viewer from crashing the app.
 *
 * `storyGroups.test.ts` proves the grouping/advancement arithmetic; this file
 * pins the *connections* that arithmetic depends on at runtime — the record-once
 * view effect, the single `goToNextStory` path, the guarded advance, the one
 * player per visible story, and the player-owned completion events. Each of
 * these has produced a device-only failure (the production loop died on a
 * render cycle no unit test could see), so they are asserted at the source
 * level the way `feedAutoplayWiring.test.ts` pins the feed's coordinator chain.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the record-view loop cannot recur', () => {
  const viewer = read('StoryViewer.tsx');
  const screen = read('../../app/(candidate)/story/[id].tsx');

  it('the viewer records each story id exactly once — the effect depends on the id, not the object', () => {
    // `useStoryList` rebuilds every story object each render; keying on
    // `currentStory` (or on an unstable callback) re-fired the POST, whose
    // `onSuccess` invalidated the query and looped until "Maximum update depth
    // exceeded" killed the process ~1s after the caption appeared.
    expect(viewer).toContain('recordedRef.current.has(storyId)');
    expect(viewer).toMatch(/\}, \[storyId\]\);/);
    // The callback rides a ref so its identity may churn without re-firing.
    expect(viewer).toContain('onStoryViewedRef.current?.(story)');
  });

  it('the screen’s record-view callback is built from react-query’s stable mutate, never the mutation object', () => {
    expect(screen).toContain('const mutateRecordView = recordViewMutation.mutate;');
    expect(screen).toContain('[mutateRecordView]');
    // The old dependency — a fresh object every render — must never return.
    expect(screen).not.toContain('[recordViewMutation]');
  });

  it('a view POST still refreshes the rings it marks as viewed', () => {
    expect(screen).toMatch(/invalidateQueries\(\{ queryKey: queryKeys\.stories \}\)/);
  });
});

describe('one advancement rule, guarded against duplicates', () => {
  const viewer = read('StoryViewer.tsx');

  it('there is one forward path — goToNextStory — driven by the pure nextStoryPosition rule', () => {
    expect(viewer).toMatch(/const goToNextStory = useCallback\(\(\) => \{/);
    expect(viewer).toContain('nextStoryPosition(groupsRef.current, positionRef.current)');
    // Competing forward paths would fight over position.
    expect(viewer.match(/setPosition\(/g)?.length).toBe(3);
  });

  it('a duplicated completion event advances exactly once', () => {
    expect(viewer).toContain('if (advancingRef.current) return;');
    // The guard releases only after the new position has committed.
    expect(viewer).toMatch(
      /useEffect\(\(\) => \{\s*advancingRef\.current = false;\s*\}, \[position, generation\]\);/,
    );
    // Manual next supersedes an in-flight advance rather than queuing behind it.
    // (Line endings differ across checkouts, so this matches whitespace, not bytes.)
    expect(viewer).toMatch(/advancingRef\.current = false;\s+goToNextStory\(\);/);
  });

  it('going back restarts the first story instead of exiting the viewer', () => {
    expect(viewer).toContain('going back must never close the viewer');
    expect(viewer).toContain('setGeneration((current) => current + 1);');
  });

  it('the viewer carries no timer of its own — timing lives in the media layer', () => {
    expect(viewer).not.toContain('setTimeout(');
    expect(viewer).not.toContain('setInterval(');
  });
});

describe('exactly one player for the one visible story', () => {
  const viewer = read('StoryViewer.tsx');
  const layer = read('StoryMediaLayer.tsx');

  it('the layer remounts per story (and per restart), so the old player releases before the next mounts', () => {
    expect(viewer).toContain('key={`${currentStory.id}:${generation}`}');
  });

  it('the layer picks a real video surface only for video stories, event-driven — never a 5s timer', () => {
    expect(layer).toContain("if (media?.kind === 'video')");
    expect(layer).toContain("player.addListener('playToEnd'");
    expect(layer).not.toContain('STORY_AUTO_ADVANCE_DURATION_MS');
  });

  it('the bytes are downloaded through the authenticated client first — the player gets a local copy', () => {
    // A native video request cannot attach a bearer token, so the URL is
    // fetched with the token before the player ever sees it (§8).
    expect(layer).toContain('loadPlayableVideoUri(mediaUri)');
    expect(layer).toContain('contentFit="cover"');
  });

  it('any failure — download, decode, or image — lands on the same retry surface, never a crash', () => {
    expect(layer).toContain("message=\"Unable to play this story\"");
    expect(layer).toContain('>Tap to retry</Text>');
  });

  it('backgrounding pauses the player, so playback cannot advance out of sight', () => {
    expect(viewer).toContain("AppState.addEventListener('change'");
    expect(layer).toContain('player.pause()');
  });

  it('images carry the authenticated header too, and cover without stretching', () => {
    expect(layer).toContain('authenticatedImageSource(absoluteMediaUri(media.uri))');
    expect(layer).toContain("if (media?.kind === 'image')");
  });
});

describe('the home row renders one circle per person, with the right ring', () => {
  const row = read('../home/OpportunityStories.tsx');
  const bubble = read('StoryBubble.tsx');
  const screen = read('../../app/(candidate)/story/[id].tsx');

  it('the row groups by author and keys circles by person, not by story', () => {
    expect(row).toContain('groupStoriesByAuthor(stories)');
    expect(row).toContain('key={group.authorPublicId}');
    expect(row).not.toMatch(/key=\{story\.id\}/);
  });

  it('the bubble reads its ring from the group (gold for job/internship, blue otherwise)', () => {
    expect(bubble).toContain('storyGroupRing(group)');
    expect(bubble).toContain('ringPremium');
  });

  it('tapping a circle hands the viewer the group the id belongs to', () => {
    expect(screen).toContain('positionForStoryId(groups, id)');
    expect(screen).toContain('groupStoriesByAuthor(storyItems)');
  });
});

describe('See details appears only where it applies', () => {
  const viewer = read('StoryViewer.tsx');

  it('the control is gated on the story type — never on the publisher kind or anything else', () => {
    expect(viewer).toContain('shouldShowStoryDetails(detailType)');
  });

  it('an unlinked opportunity gets an honest inline notice, not a fake destination', () => {
    expect(viewer).toContain('testID="story-details-notice"');
    expect(viewer).toContain('onOpenOpportunity');
  });
});

