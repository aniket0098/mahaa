/**
 * Profile header photo-edit coverage.
 *
 * **Structural, for the same reason `homeComposer.test.ts` is.** `ProfileHeader`
 * imports `react-native`, so it cannot be rendered by this Node-only runner. The
 * guarantees worth protecting here are about *wiring* — and each one is something
 * a later edit could break while the screen still looked right at a glance:
 *
 *  - two hit areas on **one** handler. A second handler is how the circle and the
 *    pencil drift apart, and how only one of them ends up carrying the busy
 *    disable and the accessible name.
 *  - one upload implementation: the shared `useProfilePhotoChange`, never a
 *    second pick → upload → reconcile path copied into the header.
 *  - the picture still goes through `Avatar`, which is the only path that signs
 *    the `GET /media/{id}` request. A bare `<Image>` gets a 401 and silently falls
 *    back to initials — the bug that made a saved photo render nowhere.
 *  - a failed change keeps the current picture and states the problem in a
 *    persistent banner with a retry.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Occurrences of `needle`; several guarantees below are about a count, not a match. */
const count = (haystack: string, needle: string) => haystack.split(needle).length - 1;

const header = read('./ProfileHeader.tsx');
const hook = read('./useProfilePhotoChange.ts');
const styles = read('./profileStyles.ts');
const photoStep = read('../onboarding/PhotoStep.tsx');
const homeHeader = read('../home/DashboardHeader.tsx');
const avatarSync = read('../../api/avatarSync.ts');

describe('the circle and the pencil are one control', () => {
  it('owns no picker, no upload call, and no cache edit', () => {
    // The header is a view. Everything that talks to the network is behind the
    // hook, so there is exactly one photo-write path to keep correct.
    expect(header).not.toContain("from '@/api/");
    expect(header).not.toContain('uploadProfilePhoto');
    expect(header).not.toContain('expo-image-picker');
    expect(header).not.toContain('queryClient');
    expect(count(header, 'useProfilePhotoChange()')).toBe(1);
  });

  it('routes both hit areas through the same function reference', () => {
    // Not two handlers that happen to contain the same calls — one reference.
    expect(count(header, 'const changePhoto =')).toBe(1);
    expect(count(header, 'onPress={changePhoto}')).toBe(2);
  });

  it('disables both while a change is in flight', () => {
    // Double-tapping the pencil used to be able to open two pickers; the hook
    // guards the work, and these guards keep the UI from inviting it.
    expect(count(header, 'disabled={photo.isBusy}')).toBe(2);
  });

  it('gives both hit areas the same accessible name', () => {
    expect(count(header, 'accessibilityLabel={CHANGE_PHOTO_LABEL}')).toBe(2);
    expect(header).toContain("const CHANGE_PHOTO_LABEL = 'Change profile photo'");
    // A screen reader must also hear that the control is busy, not just that it
    // exists — the spinner alone is invisible to it.
    expect(count(header, 'accessibilityState={{ busy: photo.isUploading, disabled: photo.isBusy }}')).toBe(2);
  });
});

describe('the pencil reads as a control on the cover', () => {
  it('anchors it to the circle, not to the page column', () => {
    // Without the relative wrapper the badge resolves against whatever ancestor
    // happens to be positioned — that is the drift, not a hypothetical one.
    expect(header).toContain('styles.avatarBlock');
    expect(styles).toMatch(/avatarBlock: \{[\s\S]*?position: 'relative'/);
    expect(styles).toMatch(/avatarEdit: \{[\s\S]*?position: 'absolute'/);
    expect(styles).toMatch(/avatarEdit: \{[\s\S]*?right: 0/);
  });

  it('declares the pencil after the circle so it wins the overlap', () => {
    // Where the two overlap, the later sibling is the one that receives the touch.
    expect(header.indexOf('styles.avatarEdit')).toBeGreaterThan(header.indexOf('styles.avatarRing'));
  });

  it('keeps the visible disc small but the touch target at the 48px floor', () => {
    // 32 is the disc; `hitSlop` is what makes it comfortable (`layout.hitSlop`
    // takes it to 48). A bare 32px target would fail the touch-target rule.
    expect(styles).toMatch(/avatarEdit: \{[\s\S]*?width: 32/);
    expect(header).toContain('hitSlop={layout.hitSlop}');
  });

  it('uses tokens for its surface and glyph, like every other surface', () => {
    expect(styles).toMatch(/avatarEdit: \{[\s\S]*?backgroundColor: colors\.colorBgSurface/);
    expect(header).toContain('name={PENCIL_ICON} size={16} color={colors.colorPrimary}');
    // The two symbols the platform sets know — not a glyph shipped as an image.
    expect(header).toContain("const PENCIL_ICON = { ios: 'pencil', android: 'edit' }");
  });
});

describe('the picture itself still uses the authenticated path', () => {
  it('renders the shared Avatar, which signs its own request', () => {
    // `Avatar` resolves `served_at` onto the base and fetches with the bearer
    // token. Anything else here would render 401-restricted media unsigned.
    expect(header).toContain('<Avatar');
    expect(header).toContain('src={identity.avatar_url}');
    expect(header).not.toContain("from 'expo-image'");
    expect(header).not.toContain('<Image');
    expect(header).not.toContain('apiBaseUrl');
  });
});

describe('a failed change leaves the current photo alone', () => {
  it('scrims the circle instead of replacing it with the local file', () => {
    // The scrim is a sibling *after* the avatar, so the previous face stays
    // mounted for the whole upload. The picked file is deliberately not shown as
    // the identity until the server has it.
    expect(header.indexOf('styles.avatarBusy')).toBeGreaterThan(header.indexOf('<Avatar'));
    expect(styles).toMatch(/avatarBusy: \{[\s\S]*?position: 'absolute'/);
    expect(styles).toMatch(/avatarBusy: \{[\s\S]*?backgroundColor: colors\.colorOverlay/);
    expect(header).not.toContain('previewUri');
  });

  it('reports the failure in a banner with a working retry', () => {
    // A toast would be gone before a distracted person looked up; the photo did
    // not change, and that has to still be on screen.
    expect(header).toContain('<StatusBanner');
    expect(header).toContain('title="Could not change your profile photo"');
    expect(header).toContain('description={photo.problem}');
    expect(header).toContain('onRetry={changePhoto}');
  });

  it('passes the server message through, with a plain fallback', () => {
    expect(hook).toContain('instanceof ApiError');
    expect(hook).toContain('The photo could not be saved. Check your connection and try again.');
    // No transport internals are shown to a person: the hook is the single place
    // a message is produced, and the header invents none of its own.
    expect(header).not.toMatch(/HTTP \d{3}/);
  });

  it('clears the previous problem before the picker reopens', () => {
    // Ordering, not just presence: a stale "could not save" left up while a new
    // attempt runs reads as a second failure. Matched on the *call site* — the
    // module's import line also contains the name.
    expect(hook.indexOf('setProblem(null)')).toBeLessThan(hook.indexOf('await pickPhotoFromLibrary()'));
  });
});

describe('the same write is what onboarding and Home see', () => {
  it('shares one upload sequence with the wizard photo step', () => {
    expect(photoStep).toContain('useProfilePhotoChange()');
    expect(photoStep).not.toContain('uploadProfilePhoto');
    expect(photoStep).toContain('changePhoto');
  });

  it('leaves Home reading the query that the save invalidates', () => {
    // The Home avatar is the *same* cached aggregate, so one invalidation covers
    // both screens and no restart is needed to see the new face.
    expect(homeHeader).toContain('queryKeys.profile');
    expect(homeHeader).toContain('identity.avatar_url');
    expect(avatarSync).toContain('queryKeys.profile');
  });
});

