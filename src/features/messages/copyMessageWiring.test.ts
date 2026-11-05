/**
 * Copy-to-clipboard on a conversation bubble.
 *
 * The rules this file pins, all against the real screen source:
 *  - Copy is offered on *every* live bubble, incoming ones included —
 *    reading somebody else's message is not a privileged action — while
 *    Edit and Delete render only where the sender-only predicate holds,
 *    because the server 404s anybody else.
 *  - A tombstone is never pressable and `copyMessage` refuses a null body,
 *    so "This message was deleted" can never land on the clipboard.
 *  - The clipboard write goes through `expo-clipboard`'s `setStringAsync`
 *    (the Expo-documented API), the success line is transient, and a
 *    failure is a persistent banner with a retry — never a toast.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const screen = read('../../app/(candidate)/conversation/[id].tsx');

describe('the conversation screen copies through expo-clipboard', () => {
  it('imports the documented API and writes the message body', () => {
    expect(screen).toContain("import * as Clipboard from 'expo-clipboard';");
    expect(screen).toContain('await Clipboard.setStringAsync(message.body);');
  });

  it('refuses a tombstone before touching the clipboard', () => {
    // The server nulls the body of a deleted row; there is nothing to copy.
    expect(screen).toContain('if (message.body === null) return;');
  });

  it('offers Copy from the same long-press sheet as Edit and Delete', () => {
    expect(screen).toContain('accessibilityLabel="Copy message text"');
    // Copy closes the sheet first, then runs the write.
    expect(screen).toMatch(
      /accessibilityLabel="Copy message text"[\s\S]{0,320}setMenuTarget\(null\);[\s\S]{0,160}void copyMessage\(target\);/,
    );
  });
});

describe('the sheet never offers a doomed action', () => {
  it('Edit and Delete render only where the sender-only predicate holds', () => {
    expect(screen).toContain('const menuEditable = menuTarget !== null && canEdit(menuTarget, selfUserId);');
    expect(screen).toMatch(/\{menuEditable \? \(\s*<Pressable\s+accessibilityRole="button"\s+accessibilityLabel="Edit message"/);
    expect(screen).toMatch(/\{menuEditable \? \(\s*<Pressable\s+accessibilityRole="button"\s+accessibilityLabel="Delete message"/);
  });

  it('a tombstone bubble is not pressable at all', () => {
    // `{!deleted ? (` wraps the long-pressable — incoming rows included,
    // deleted rows never.
    expect(screen).toContain('{!deleted ? (');
    expect(screen).not.toContain('{editable ? (\n          <Pressable');
  });
});

describe('copy feedback follows the project’s error rule', () => {
  it('the success line is transient and announced politely', () => {
    expect(screen).toContain('accessibilityLiveRegion="polite"');
    expect(screen).toContain('setCopied(false), 2500');
    expect(screen).toContain('Copied to clipboard');
  });

  it('a failure is a persistent banner that can retry the same message', () => {
    expect(screen).toContain("setCopyError('The message could not be copied.');");
    expect(screen).toContain('title="Copy failed"');
    expect(screen).toContain('onRetry={');
    // The banner holds the message that failed so the retry re-runs it.
    expect(screen).toContain('setCopyFailedTarget(message);');
  });
});
