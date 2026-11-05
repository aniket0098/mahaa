/**
 * The emoji picker's one rule, unit-tested: an emoji is inserted at the cursor,
 * not appended, and the cursor advances so a run of taps lands in order. Pure
 * functions, so these need no renderer and no device.
 */

import { describe, expect, it } from 'vitest';

import {
  ALL_EMOJI,
  EMOJI_GROUPS,
  insertEmojiAtSelection,
} from '@/features/conversation/emoji';

describe('emoji palette', () => {
  it('exposes grouped emoji and a flat list built from them', () => {
    expect(EMOJI_GROUPS.length).toBeGreaterThan(0);
    for (const group of EMOJI_GROUPS) {
      expect(group.label.length).toBeGreaterThan(0);
      expect(group.emoji.length).toBeGreaterThan(0);
    }
    const flatFromGroups = EMOJI_GROUPS.flatMap((group) => group.emoji);
    expect(ALL_EMOJI).toEqual(flatFromGroups);
  });

  it('has no duplicate emoji across groups', () => {
    const seen = new Set<string>();
    for (const emoji of ALL_EMOJI) {
      expect(seen.has(emoji), `${emoji} appears twice`).toBe(false);
      seen.add(emoji);
    }
  });
});

describe('insertEmojiAtSelection', () => {
  it('inserts at the cursor, keeping the text before and after', () => {
    const result = insertEmojiAtSelection('hello world', { start: 5, end: 5 }, '🎉');
    expect(result.text).toBe('hello🎉 world');
    // The cursor advances past the inserted glyph.
    expect(result.selection).toEqual({ start: 7, end: 7 });
  });

  it('inserts at the end when the cursor is at the end', () => {
    const result = insertEmojiAtSelection('done', { start: 4, end: 4 }, '👍');
    expect(result.text).toBe('done👍');
    expect(result.selection).toEqual({ start: 6, end: 6 });
  });

  it('replaces the selected range and leaves the cursor after the emoji', () => {
    const result = insertEmojiAtSelection('good morning', { start: 0, end: 4 }, '😀');
    expect(result.text).toBe('😀 morning');
    expect(result.selection).toEqual({ start: 2, end: 2 });
  });

  it('appends when no selection has been reported yet', () => {
    const result = insertEmojiAtSelection('hey', null, '✨');
    expect(result.text).toBe('hey✨');
    expect(result.selection).toEqual({ start: 'hey✨'.length, end: 'hey✨'.length });
  });

  it('appends when the selection has drifted past the text', () => {
    // A delete landed between renders: start/end are beyond the current length.
    const result = insertEmojiAtSelection('hi', { start: 9, end: 9 }, '🔥');
    expect(result.text).toBe('hi🔥');
    // The cursor is the new text length (UTF-16, matching how RN reports it).
    expect(result.selection).toEqual({ start: 'hi🔥'.length, end: 'hi🔥'.length });
  });

  it('chains correctly — a run of taps lands in order', () => {
    let text = '';
    let selection = { start: 0, end: 0 };
    for (const emoji of ['😀', '🎉', '👍']) {
      const next = insertEmojiAtSelection(text, selection, emoji);
      text = next.text;
      selection = next.selection;
    }
    expect(text).toBe('😀🎉👍');
    expect(selection.start).toBe(text.length);
  });

  it('does not mutate its inputs', () => {
    const text = 'abc';
    const selection = { start: 1, end: 1 };
    insertEmojiAtSelection(text, selection, 'x');
    expect(text).toBe('abc');
    expect(selection).toEqual({ start: 1, end: 1 });
  });
});
