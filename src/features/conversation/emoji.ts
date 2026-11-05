/**
 * The conversation composer's emoji picker — a small, self-contained set and the
 * one rule that matters: **insert at the cursor, never append blindly.**
 *
 * No third-party emoji library is pulled in. The set below is a curated, static
 * list of common emoji (faces, gestures, hearts, celebration, work) rendered by
 * the platform font, so there is nothing to download, no native module, and no
 * network. The list is deliberately small: a person-picker-sized grid that opens
 * fast and stays readable, not the full Unicode catalogue.
 *
 * The insertion rule is a pure function so it can be unit-tested without a
 * TextInput: given the current text and the current selection, an emoji is
 * spliced in at the cursor and the cursor is advanced past it, so tapping several
 * emoji in a row lands them where the reader expects rather than at the end.
 */

/**
 * The emoji the picker offers, grouped for display. Each group is a labelled
 * section; the labels double as accessible headings in the picker.
 */
export interface EmojiGroup {
  /** A short accessible label for the group, e.g. "Smileys". */
  label: string;
  emoji: readonly string[];
}

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  {
    label: 'Smileys',
    emoji: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '😘', '😋', '😜', '🤪', '🤔', '🤗', '🤩'],
  },
  {
    label: 'Gestures',
    emoji: ['👍', '👎', '👌', '✌️', '🤞', '🤟', '🤙', '👏', '🙌', '🙏', '💪', '🫶', '👋', '🤝'],
  },
  {
    label: 'Hearts',
    emoji: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💖', '💗', '💓', '💞', '💕', '💯'],
  },
  {
    label: 'Celebration',
    emoji: ['🎉', '🎊', '🎈', '🎁', '🎂', '🥳', '✨', '🔥', '⭐', '🌟', '💫', '🏆', '🥇'],
  },
  {
    label: 'Work',
    emoji: ['💼', '📈', '📊', '🚀', '💡', '🧠', '📌', '📎', '🗓️', '✅', '☑️', '📝', '💬', '📧'],
  },
];

/** A stable, deduplicated, display-ordered flat list of every emoji offered. */
export const ALL_EMOJI: readonly string[] = EMOJI_GROUPS.flatMap((group) => group.emoji);

/** The cursor position within a text field: an inclusive ``start``/``end`` range. */
export interface Selection {
  start: number;
  end: number;
}

/**
 * Insert ``emoji`` into ``text`` at ``selection``.
 *
 * The emoji is spliced in at the selection's start, replacing any selected range
 * (so inserting over a highlighted word replaces it, as a normal editor does),
 * and the returned selection points just after the inserted emoji so the next
 * tap continues from there. Out-of-range or missing selection degrades to an
 * append — the safest behaviour when a TextInput has not yet reported a cursor.
 *
 * Pure and allocation-light: it never mutates its inputs and never touches the
 * DOM, so the same function drives the screen and the unit test.
 */
export function insertEmojiAtSelection(
  text: string,
  selection: Selection | null | undefined,
  emoji: string,
): { text: string; selection: Selection } {
  const length = text.length;
  // A selection the input has not reported yet, or one whose bounds have drifted
  // past the text (a delete landed between renders), is treated as "at the end".
  const at =
    selection && selection.start >= 0 && selection.end <= length && selection.start <= selection.end
      ? selection
      : { start: length, end: length };

  const next = text.slice(0, at.start) + emoji + text.slice(at.end);
  const cursor = at.start + emoji.length;
  return { text: next, selection: { start: cursor, end: cursor } };
}
