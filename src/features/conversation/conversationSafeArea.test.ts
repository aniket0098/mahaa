/**
 * Composers keep typed text visible and Send beside the input.
 *
 * Source-level (the `composerSafeArea.test.ts` approach): the composers import
 * react-native, which this runner is not. What is guarded here is narrow and
 * device-measured — the three JS-level traps that hid typed text or pushed
 * Send off-screen on the physical Android device:
 *
 * 1. The message field must not be a controlled `selection` prop on every
 *    keystroke. A state update per cursor move rerenders the composer and hands
 *    a stale selection back to the IME, which resets the cursor, drops the
 *    keystroke, or hides the text behind the keyboard. The cursor lives in a
 *    ref; `selection` is only set for the single render after an emoji insert.
 * 2. The comment sheet is a `Modal` — a separate native window that
 *    `windowSoftInputMode="adjustResize"` never reaches. `behavior="padding"`
 *    is the lift that moves the list AND the composer above the keyboard
 *    together (with a zero vertical offset, so no gap lingers after dismiss).
 * 3. Both composer rows reserve `minWidth: 0` on the row and the input and
 *    `flexShrink: 0` on the send button, so a long draft shrinks the input
 *    instead of pushing Send off-screen.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const conversation = read('../../app/(candidate)/conversation/[id].tsx');
const callScreen = read('../../app/(candidate)/call/[id].tsx');
const sheet = read('../feed/CommentsSheet.tsx');
const feedStyles = read('../feed/feedStyles.ts');

describe('message composer keeps typing visible', () => {
  it('tracks the cursor in a ref, never in per-keystroke state', () => {
    expect(conversation).toContain('const selectionRef = useRef<Selection | null>(null)');
    expect(conversation).toContain('selectionRef.current = event.nativeEvent.selection');
    expect(conversation).not.toMatch(/const \[selection, setSelection\] = useState/);
  });

  it('controls selection only for the single emoji-placement frame', () => {
    expect(conversation).toContain('selection={pendingSelection ?? undefined}');
    expect(conversation).toContain('setPendingSelection(next.selection)');
  });

  it('returns to uncontrolled on the next keystroke or cursor report', () => {
    expect(conversation).toContain('if (pendingSelection) setPendingSelection(null)');
  });

  it('the row keeps input and send side by side on long drafts', () => {
    expect(conversation).toMatch(/composerRow: \{[\s\S]*?minWidth: 0/);
    expect(conversation).toMatch(/composerInput: \{[\s\S]*?minWidth: 0/);
    expect(conversation).toMatch(/sendButton: \{[\s\S]*?flexShrink: 0/);
  });

  it('multiline caps at a sensible height, then scrolls inside', () => {
    expect(conversation).toMatch(/composerInput: \{[\s\S]*?maxHeight: 120/);
  });
});

describe('comment sheet lifts input and send together', () => {
  it('lifts with padding inside the modal window', () => {
    // A Modal is a separate native window: adjustResize never reaches it, so
    // `undefined` here leaves the composer behind the keyboard.
    expect(sheet).toContain('behavior="padding"');
    expect(sheet).not.toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
  });

  it('leaves no stale offset after the keyboard dismisses', () => {
    expect(sheet).toContain('keyboardVerticalOffset={0}');
  });

  it('the wrapper has measurable height so padding can lift it', () => {
    expect(feedStyles).toMatch(/sheetKeyboard: \{[^}]*flex: 1/);
  });

  it('the row keeps input and send side by side on long drafts', () => {
    expect(feedStyles).toMatch(/commentComposer: \{[\s\S]*?minWidth: 0/);
    expect(feedStyles).toMatch(/commentInput: \{[\s\S]*?minWidth: 0/);
    expect(feedStyles).toMatch(/commentSend: \{[\s\S]*?flexShrink: 0/);
  });

  it('multiline caps at a sensible height, then scrolls inside', () => {
    expect(feedStyles).toMatch(/commentInput: \{[\s\S]*?maxHeight: 120/);
    expect(sheet).toContain('scrollEnabled');
  });
});

describe('the header starts below the Android status bar', () => {
  it('the shell applies the real top inset exactly once, for every exit', () => {
    // ConversationShell wraps both the conversation body and the missing-id
    // notice, so one inset covers both — no render path lands under the status
    // bar, and there is no second top padding to double it.
    expect(conversation).toMatch(/function ConversationShell[\s\S]{0,500}?paddingTop: insets\.top/);
  });

  it('no fixed screen offset appears anywhere on the screen', () => {
    // A literal would drift on every device; the inset is the only correct
    // value, and the status bar stays visible in every theme.
    expect(conversation).not.toMatch(/paddingTop:\s*\d/);
    expect(conversation).not.toContain('<StatusBar');
    expect(conversation).not.toContain('setStatusBarHidden');
  });

  it('the call screen reached from the header clears the status bar too', () => {
    expect(callScreen).toMatch(/function CallShell[\s\S]{0,400}?paddingTop: insets\.top/);
    expect(callScreen).not.toMatch(/paddingTop:\s*\d/);
  });
});

describe('the composer clears the bottom tab bar and gesture strip', () => {
  it("pads by the tab bar's own height formula, once", () => {
    // CandidateTabBar renders `height: layout.bottomNavHeight + insets.bottom`;
    // the composer reuses the identical sum so its input row always lands
    // directly above the bar — the exact overlap the device dump measured.
    expect(conversation).toContain('{ paddingBottom: layout.bottomNavHeight + insets.bottom + spacing.md }');
    // The bar's height must not also be padded into the shell (double inset).
    expect(conversation).not.toMatch(/shell,[\s\S]{0,120}?insets\.bottom/);
  });

  it('the keyboard-avoiding shell stays in place', () => {
    expect(conversation).toContain("behavior={Platform.OS === 'ios' ? 'padding' : undefined}");
  });
});

describe('a failed read is never an empty conversation', () => {
  it('the zero-message branch requires both reads to have succeeded', () => {
    expect(conversation).toContain('!history.isError && !conversation.isError && thread.length === 0');
  });

  it('the error banner names which read failed and carries the server message', () => {
    expect(conversation).toContain("\"Couldn't load this conversation\"");
    expect(conversation).toContain("\"Couldn't load these messages\"");
    expect(conversation).toContain('loadFailure instanceof ApiError');
    expect(conversation).toContain('onRetry={refreshThread}');
  });
});