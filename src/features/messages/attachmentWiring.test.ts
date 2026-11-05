/**
 * Photo & video attachments on a conversation — the wiring, pinned against the
 * real screen source.
 *
 * The rules this file holds, each against the file that must keep them:
 *  - The picker is asked for **images and videos**, single-select, and gated on
 *    the media-library permission — a denial says so instead of opening an
 *    empty library.
 *  - The upload goes through `uploadPickedMedia` (the one transport, with real
 *    byte progress), and the send payload carries `media_id` only — the id the
 *    server answered with, never a local uri or a client-invented key.
 *  - The send gate refuses while the upload is unfinished (`attachmentPending`),
 *    so a message can never reference bytes the server does not have.
 *  - A bubble renders its attachment only when the message is live: the delete
 *    stamp wins, the tombstone never shows media.
 *  - Images load through `authenticatedImageSource(absoluteMediaUri(...))` —
 *    the media route has no unsigned variant — and open the shared full-screen
 *    `MediaViewer`; videos go through `loadPlayableVideoUri` before `expo-video`
 *    mounts, because no player source accepts the Authorization header.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const screen = read('../../app/(candidate)/conversation/[id].tsx');

describe('the composer attaches photos and videos honestly', () => {
  it('asks the picker for both kinds, single-select, behind the permission', () => {
    expect(screen).toContain('requestMediaLibraryPermissionsAsync()');
    expect(screen).toContain("mediaTypes: ['images', 'videos']");
    expect(screen).toContain('allowsMultipleSelection: false');
    // A denial is a persistent message the user can act on, not a silent no-op.
    expect(screen).toContain('Photo access is off.');
  });

  it('uploads through the shared transport with byte progress', () => {
    expect(screen).toContain('uploadPickedMedia(media, (progress) =>');
    expect(screen).toContain('setUploadFraction(progress.fraction)');
    // Progress is a real percentage of bytes, never an invented animation.
    expect(screen).toMatch(/Uploading… \$\{Math\.round\(uploadFraction \* 100\)\}%/);
  });

  it('sends media_id — the server id, keyed to the file still on screen', () => {
    // The gate: uploaded AND uploaded from the currently staged file.
    expect(screen).toContain(
      'const mediaId = picked && uploaded && uploaded.localUri === picked.localUri ? uploaded.id : null;',
    );
    // The payload carries media_id and a null body for media-only sends.
    expect(screen).toContain('media_id: input.mediaId');
    expect(screen).toMatch(/body: input\.text\.trim\(\)\.length > 0 \? input\.text\.trim\(\) : null/);
    // And the send button cannot fire while the upload is unfinished.
    expect(screen).toContain('canSend(draft, sending || attachmentPending, mediaId !== null)');
  });

  it('a staged attachment can be removed, and remove is held during the flight', () => {
    expect(screen).toContain('testID="composer-attachment-remove"');
    expect(screen).toContain('accessibilityLabel="Remove attachment"');
    expect(screen).toMatch(/onPress=\{removeAttachment\}\s+disabled=\{uploadFraction !== null\}/);
  });
});

describe('the bubble renders media only where the server says it lives', () => {
  it('the delete stamp wins — a tombstone never renders an attachment', () => {
    // `media` is derived through `!deleted`, so a stale row that still carried
    // an attachment after a delete cannot draw it.
    expect(screen).toContain('const media = !deleted ? message.media : null;');
    // And the model agrees: a row with neither body nor media is a tombstone.
    const model = read('../../features/conversation/conversationModel.ts');
    expect(model).toContain('if (message.deleted_at !== null) return true;');
    expect(model).toContain('return message.body === null && message.media === null;');
  });

  it('images use the authenticated source and open the shared viewer', () => {
    expect(screen).toContain('authenticatedImageSource(absoluteMediaUri(media.served_at))');
    // The load-bearing auth subscription, same as PostMedia.
    expect(screen).toContain('useSyncExternalStore(subscribeMediaAuth, getMediaAuthVersion');
    expect(screen).toContain('<MediaViewer');
    expect(screen).toContain('onOpenMedia={() => openAttachment(item.entry.message)}');
  });

  it('videos download first, then mount expo-video — no headerless player source', () => {
    expect(screen).toContain('loadPlayableVideoUri(servedAt)');
    expect(screen).toContain('useVideoPlayer({ uri: playable }');
    // Failure and loading are both stated, never a blank rectangle.
    expect(screen).toContain('message-video-failed');
    expect(screen).toContain('message-video-loading');
  });

  it('the action sheet names a media-only message instead of calling it deleted', () => {
    // `menuTarget.body` is null on a photo with no caption; without
    // attachmentLabel the sheet would title it "This message was deleted".
    expect(screen).toContain('attachmentLabel(menuTarget) ?? \'This message was deleted\'');
  });
});