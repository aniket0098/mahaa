/**
 * Home create-post entry coverage.
 *
 * **Structural, for the same reason `demoIsolation.test.ts` is.** The components
 * import `react-native`, so they cannot be rendered in this Node-only runner; the
 * guarantees worth protecting here are about *wiring* — that the old "What are you
 * working on?" composer card is really gone with nothing dead left behind it, that
 * the compact blue Create Post button has taken its place, and that publishing
 * still goes through the one `/add-post` screen rather than a second composer.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const home = read('../../app/(candidate)/home.tsx');
const button = read('../home/CreatePostButton.tsx');
const stories = read('../home/OpportunityStories.tsx');
const addPost = read('../../app/(candidate)/add-post.tsx');
const yourStory = read('../stories/YourStoryButton.tsx');

describe('the old Home composer card is gone', () => {
  it('does not mount the composer card or its prompt anywhere', () => {
    expect(home).not.toContain('HomeComposerCard');
    expect(home).not.toContain('What are you working on?');
    expect(home).not.toContain('home-composer-card');
  });

  it('leaves no composer import or dead handler behind', () => {
    expect(home).not.toContain("from '@/features/composer/composerModel'");
    expect(home).not.toContain('openStoryComposer');
    expect(home).not.toContain('openComposer');
  });

  it('places the feed directly after Stories & Opportunities', () => {
    expect(home.indexOf('<OpportunityStories')).toBeLessThan(home.indexOf('<CommunityFeed'));
  });
});

describe('the blue Create Post button replaces it', () => {
  it('renders at the left edge of the stories row, before Your story', () => {
    expect(stories).toContain('<CreatePostButton />');
    expect(stories.indexOf('<CreatePostButton')).toBeLessThan(stories.indexOf('<YourStoryButton'));
  });

  it('is a real, labelled control that opens the one composer', () => {
    expect(button).toContain('accessibilityLabel="Create post"');
    expect(button).toContain("'/add-post'");
    expect(button).toContain('accessibilityRole="button"');
  });

  it('uses a circular blue touch target with a white plus', () => {
    expect(button).toContain('createPostCircle');
    expect(button).toContain('colorTextOnPrimary');
    // The shared container keeps it in the story row's rhythm.
    expect(button).toContain('styles.createContainer');
  });

  it('opens a real composer screen that reads its params', () => {
    expect(addPost).toContain('useLocalSearchParams');
    expect(addPost).toContain('COMPOSER_TYPES.find');
  });
});

describe('no second post-creation path exists on Home', () => {
  it('does not import the posts API from Home or the button', () => {
    expect(home).not.toContain("from '@/api/posts'");
    expect(button).not.toContain("from '@/api/posts'");
  });

  it('routes story creation to the story screen, not the post composer', () => {
    expect(yourStory).toContain("'/add-story'");
    expect(button).not.toContain("'/add-story'");
  });
});