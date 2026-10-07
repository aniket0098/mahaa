/**
 * Publishing, end to end: what the screen does after the server answers 201.
 *
 * **Structural, like `video.test.ts` and `homeCreatePost.test.ts`.** `add-post.tsx`
 * imports `react-native` and `expo-router`, so it cannot be rendered in this
 * Node-only runner. What is worth protecting here is the *wiring*, because the
 * two properties below are exactly what break silently:
 *
 * 1. **The author's own device shows the post immediately.** The author's socket
 *    never receives their own `post.created` (they caused it, and the screen is
 *    closed by then), so if the screen relied only on the socket the feed would
 *    lag behind a refetch it never asked for.
 * 2. **The inserted copy is the server's.** Inserting a locally built post would
 *    render a card with a made-up author or zeroed counts that differ from what
 *    every other member reads.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const screen = readFileSync(
  fileURLToPath(new URL('../../app/(candidate)/add-post.tsx', import.meta.url)),
  'utf8',
);

describe('publishing a post', () => {
  it('renders the post the server returned, not one built on the client', () => {
    // `createPost` already maps the stored `WirePost`. Anything else would show
    // a card whose author, media or engagement counts were guessed locally.
    expect(screen).toContain('const created = await createPost(');
    expect(screen).toContain('[created, ...current]');
    expect(screen).not.toMatch(/mapDraftToPost|buildLocalPost/);
  });

  it('de-duplicates by id, so a refetch cannot show the post twice', () => {
    // Without this, `setQueryData` + `invalidateQueries` racing would put the
    // same post at the top of the feed a second time when the refetch lands.
    expect(screen).toContain('current.some((post) => post.id === created.id)');
  });

  it('still invalidates, so the cache is reconciled with the server', () => {
    // The insert is for immediacy, not authority: `['posts']` also covers
    // `['posts','mine']`, which the profile's own list reads.
    expect(screen).toContain(
      'await queryClient.invalidateQueries({ queryKey: queryKeys.posts });',
    );
  });

  it('never inserts when the publish failed', () => {
    // The insert sits after the awaited 201. If it moved above it, a failed
    // request would leave a post in the feed that does not exist on the server.
    const createdAt = screen.indexOf('const created = await createPost(');
    const insertedAt = screen.indexOf('queryClient.setQueryData<FeedPost[]>');
    expect(createdAt).toBeGreaterThan(-1);
    expect(insertedAt).toBeGreaterThan(createdAt);
  });

  it('clears the draft only after the server accepted it', () => {
    // Cleared earlier, a failed publish would lose the user's work — the one
    // rule the composer has never been allowed to break.
    const createdAt = screen.indexOf('const created = await createPost(');
    const clearedAt = screen.indexOf('await clearDraft(userId);');
    expect(clearedAt).toBeGreaterThan(createdAt);
  });
});

describe('publishing a story', () => {
  const storyScreen = readFileSync(
    fileURLToPath(new URL('../../app/(candidate)/add-story.tsx', import.meta.url)),
    'utf8',
  );

  it('uses the same upload, not a second one', () => {
    // Duplicating the upload would duplicate its magic-byte sniffing, its size
    // ceiling and its platform branch — three places to keep in step.
    expect(storyScreen).toContain("from '@/api/media'");
    expect(storyScreen).toContain('uploadPickedMedia(');
  });

  it('distinguishes an upload failure from a publish failure', () => {
    // Phase 19: "Something went wrong" is not an acceptable answer when the two
    // failures need different actions — retry the file, or retry the post.
    expect(storyScreen).toContain('did not upload');
    expect(storyScreen).toContain('was not published');
    // ...and it never deletes media that already succeeded.
    expect(storyScreen).not.toContain('deleteMedia');
  });

  it('guards a same-frame double tap with a ref, not with state', () => {
    // `phase` is state, so two taps in one frame both read the old value and two
    // stories are created. The ref is written synchronously.
    expect(storyScreen).toContain('const publishing = useRef(false);');
    expect(storyScreen).toContain('if (!submittable || publishing.current) return;');
    // Released in `finally`, so a *failed* attempt can be retried.
    expect(storyScreen).toContain('publishing.current = false;');
  });

  it('refreshes the tray with the existing story query key', () => {
    expect(storyScreen).toContain(
      'await queryClient.invalidateQueries({ queryKey: queryKeys.stories });',
    );
    // The author's own socket never receives their story, so this is not optional.
    expect(storyScreen).not.toContain("from '@/api/queryKeys';\nimport { queryKeys");
  });

  it('never invents content locally on failure', () => {
    // No optimistic story: the tray renders only what the server stored. Matched
    // against *code*, not the whole file — the screen's own docstring says
    // "nothing is rendered optimistically", and a prose match would fail on the
    // sentence documenting the rule it is checking.
    expect(storyScreen).not.toMatch(/setQueryData|optimisticStory|placeholderStory/);
  });

  it('offers an explicit Upload button for the chosen media', () => {
    // The user must be able to send the file and see real progress before
    // publishing — not only through the header Publish path.
    expect(storyScreen).toContain('testID="create-story-upload"');
    expect(storyScreen).toContain('accessibilityLabel="Upload the chosen media"');
    expect(storyScreen).toContain('void uploadNow()');
    // The button clears the 44px inline-secondary touch minimum.
    expect(storyScreen).toContain('minHeight: 44');
  });

  it('keys the uploaded id to the file it came from and reuses it in Publish', () => {
    // A bare id would attach the previous file's media to a story whose caption
    // describes the new one; a stale key fails to match and simply re-uploads.
    expect(storyScreen).toContain('uploaded.localUri === draft.media.localUri');
    // Any attachment change drops the id — one place that could forget.
    expect(storyScreen).toContain("if ('media' in patch) setUploaded(null);");
    // After a successful explicit upload the button becomes a status line.
    expect(storyScreen).toContain('testID="create-story-media-uploaded"');
  });

  it('guards the upload button with a ref, like Publish', () => {
    // Same same-frame reason as `publishing`: two taps in one frame would send
    // the same bytes twice.
    expect(storyScreen).toContain('const uploading = useRef(false);');
    expect(storyScreen).toContain('if (!media || uploading.current || phase !== \'editing\') return;');
    expect(storyScreen).toContain('uploading.current = false;');
  });
});