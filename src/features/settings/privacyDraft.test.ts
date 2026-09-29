import { describe, expect, it } from 'vitest';

import {
  draftFromPrivacy,
  shouldReseedDraft,
} from '@/features/settings/privacyDraft';
import type { PrivacyRead } from '@/types/profile';

function privacy(overrides: Partial<PrivacyRead> = {}): PrivacyRead {
  return {
    profile_visibility: 'employers',
    discoverable: true,
    allow_messages: true,
    show_email: false,
    show_phone: false,
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('draftFromPrivacy', () => {
  it('copies every writable field from the server read', () => {
    const source = privacy({
      profile_visibility: 'public',
      discoverable: false,
      allow_messages: false,
      show_email: true,
      show_phone: true,
    });
    expect(draftFromPrivacy(source)).toEqual({
      profile_visibility: 'public',
      discoverable: false,
      allow_messages: false,
      show_email: true,
      show_phone: true,
    });
  });

  it('drops updated_at, which the write model forbids', () => {
    // `PUT /profile/privacy` sets extra="forbid"; sending updated_at is a 422.
    const draft = draftFromPrivacy(privacy());
    expect(draft).not.toHaveProperty('updated_at');
    expect(Object.keys(draft).sort()).toEqual([
      'allow_messages',
      'discoverable',
      'profile_visibility',
      'show_email',
      'show_phone',
    ]);
  });

  it('returns a new object, so editing it cannot mutate the cached read', () => {
    const source = privacy();
    const draft = draftFromPrivacy(source);
    expect(draft).not.toBe(source);
    draft.discoverable = false;
    expect(source.discoverable).toBe(true);
  });
});

describe('shouldReseedDraft', () => {
  it('does not seed before the server has answered', () => {
    // Nothing to seed from, and the form stays inert so a PUT is never sent
    // with a guessed default.
    expect(shouldReseedDraft(undefined, undefined)).toBe(false);
  });

  it('seeds the first time real data arrives', () => {
    expect(shouldReseedDraft(undefined, privacy())).toBe(true);
  });

  it('does not re-seed on a re-render carrying the same source', () => {
    // This is the case the effect got wrong in spirit: an ordinary re-render
    // must never throw away what the user has typed or toggled.
    const source = privacy();
    expect(shouldReseedDraft(source, source)).toBe(false);
  });

  it('re-seeds when the server value changes', () => {
    expect(shouldReseedDraft(privacy(), privacy({ discoverable: false }))).toBe(true);
  });

  it('re-seeds after a refetch, so Save settles on the server state', () => {
    // A successful save invalidates the query and refetches, which returns a
    // fresh object. Treating that as a new source of truth is what makes the
    // form show the saved values rather than the pre-save ones.
    const beforeSave = privacy({ discoverable: true });
    const afterSave = privacy({ discoverable: false });
    expect(beforeSave).not.toBe(afterSave);
    expect(shouldReseedDraft(beforeSave, afterSave)).toBe(true);
  });

  it('settles after one seed, so repeated renders cannot loop', () => {
    // Simulates the render loop: seed, record the source, then re-check. The
    // guard must be false on the next pass or the component would spin.
    const source = privacy();
    let previous: PrivacyRead | undefined = undefined;

    let seeds = 0;
    for (let render = 0; render < 5; render += 1) {
      if (shouldReseedDraft(previous, source)) {
        previous = source;
        draftFromPrivacy(source);
        seeds += 1;
      }
    }
    expect(seeds).toBe(1);
  });

  it('never resurrects a draft from an undefined source', () => {
    // A refetch that clears the cache must not wipe or invent settings.
    expect(shouldReseedDraft(privacy(), undefined)).toBe(false);
  });

  it('narrows the source for the caller, so no cast is needed', () => {
    // This is a compile-time guarantee, asserted here so a future refactor that
    // drops the predicate fails the suite rather than the build.
    const previous: PrivacyRead | undefined = undefined;
    const current: PrivacyRead | undefined = privacy();

    if (shouldReseedDraft(previous, current)) {
      // Narrowed to PrivacyRead inside the branch: no `!` and no cast.
      const draft = draftFromPrivacy(current);
      expect(draft.discoverable).toBe(true);
    } else {
      throw new Error('expected the first resolved value to re-seed');
    }
  });
});
