/**
 * Home integration coverage for the composer entry.
 *
 * **Structural, for the same reason `demoIsolation.test.ts` is.** `HomeComposerCard`
 * imports `react-native`, so it cannot be rendered in this Node-only runner; the
 * guarantees worth protecting here are about *wiring* — that Home mounts the
 * card, that the card derives its vocabulary from the composer's own list rather
 * than a copy, and that publishing still goes through the one composer screen.
 * Those are exactly the things that break silently.
 *
 * **The "one composer" rule is the important one.** A second inline composer would
 * mean a second definition of a publishable draft, and the two would diverge the
 * first time a validation rule changed. So these tests assert the Home entry
 * *navigates* rather than duplicating.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { COMPOSER_TYPES } from '@/features/composer/composerModel';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const home = read('../../app/(candidate)/home.tsx');
const card = read('../home/HomeComposerCard.tsx');
const addPost = read('../../app/(candidate)/add-post.tsx');

describe('Home renders the create-post entry', () => {
  it('mounts the composer card on the Home screen', () => {
    expect(home).toContain('HomeComposerCard');
    // Above the feed, so it is reachable without scrolling past posts.
    expect(home.indexOf('<HomeComposerCard')).toBeLessThan(home.indexOf('<CommunityFeed'));
  });

  it('passes the signed-in candidate identity, not a placeholder', () => {
    expect(home).toContain('data?.identity.name');
    expect(home).toContain('data?.identity.avatar_url');
  });

  it('has a stable test id for the card and its prompt', () => {
    expect(card).toContain('testID="home-composer-card"');
    expect(card).toContain('testID="home-composer-prompt"');
  });

  it('shows the caller a prompt rather than an empty box', () => {
    // The prompt is the same idea as the composer's own, and it is a *label*
    // rather than a fake text field: nothing here types anything.
    expect(card).toContain('What are you working on?');
  });
});

describe('the entry navigates to the one composer', () => {
  it('opens /add-post rather than mounting a second composer', () => {
    // Duplicating the draft/upload logic would give two definitions of what
    // counts as a publishable post.
    expect(home).toContain("'/add-post'");
    expect(card).not.toContain('createPost');
    expect(card).not.toContain('uploadPickedImage');
  });

  it('passes the tapped type, so a chip is not a decoration', () => {
    // The regression this pins: every chip used to open a *blank* composer, so
    // tapping "Project" or "Video" silently produced a text post instead. The
    // type now rides along on the navigation.
    expect(home).toContain('`/add-post?type=${type}`');
    expect(card).toContain('onPress={() => onCompose(type.value)}');
    // ...and the composer reads and validates it, rather than accepting anything.
    expect(addPost).toContain('useLocalSearchParams');
    expect(addPost).toContain('COMPOSER_TYPES.find');
  });

  it('routes stories to the story screen, not to the post composer', () => {
    // A story is a different record with a different endpoint. Folding it into
    // the post composer would mean one screen building two unrelated requests.
    expect(card).toContain('onCreateStory');
    expect(card).toContain('testID="home-composer-type-story"');
    expect(home).toContain("'/add-story'");
    expect(card).not.toContain("'/add-story'");
  });

  it('carries an accessible label and a 48px touch target', () => {
    expect(card).toContain('accessibilityLabel="Create a post"');
    expect(card).toMatch(/minHeight:\s*48/);
  });
});

describe('the entry cannot advertise a type the composer refuses', () => {
  it('derives its chips from COMPOSER_TYPES rather than listing them', () => {
    expect(card).toContain('COMPOSER_TYPES');
    // A hand-written chip row would be a second place to update.
    expect(card).not.toMatch(/value:\s*'(text|image|video|project|achievement)'/);
  });

  it('renders every composer type, so the entry matches the composer exactly', () => {
    // One map over the composer's own list, so a type added there appears here
    // without a second edit. The string below is deliberately a plain literal:
    // it asserts the component *source* builds a per-type test id.
    expect(card).toContain('COMPOSER_TYPES.map');
    expect(card).toContain('home-composer-type-${type.value}');
    expect(COMPOSER_TYPES.length).toBeGreaterThan(0);
  });

  it('offers video now that the whole path exists, and gates honestly', () => {
    // Picker, validation, upload and playback are all real now, so the chip is
    // pressable. It is still not allowed to claim anything untrue.
    expect(COMPOSER_TYPES.find((type) => type.value === 'video')?.enabled).toBe(true);

    expect(card).toContain('type.enabled ? null : styles.typeDisabled');
    expect(card).toContain('disabled={!type.enabled}');
    // The unavailable reason is still wired, so a future honest-unavailable type
    // has somewhere to put its reason.
    expect(card).toContain('type.unavailableReason');
  });
});

describe('no second post-creation path exists on Home', () => {
  it('does not import the posts API from Home or the entry card', () => {
    // Publishing happens in the composer screen; Home must not post directly.
    expect(home).not.toContain("from '@/api/posts'");
    expect(card).not.toContain("from '@/api/posts'");
  });

  it('does not invent a second cache key for the feed', () => {
    // One feed cache, owned by the composer via queryKeys.posts.
    expect(home).not.toMatch(/queryKeys\.\w*[Ff]eed/);
    expect(card).not.toMatch(/queryKeys\./);
  });
});
