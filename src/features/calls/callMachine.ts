import type { Call } from '@/api/calls';

/**
 * The product states a call screen can be in. Kept deliberately coarse:
 *
 * - `idle` — no call. The only state that owns nothing.
 * - `starting` — the caller asked the server for an invitation and is waiting
 *   for the row. Not `ringing` yet: ringing is a server fact, and the request
 *   may still fail.
 * - `ringing` — a live invitation exists the other member has not answered. On
 *   the caller side this follows `start` (201/200) or `call.accepted` landing
 *   on a stale row; on the callee side it follows `call.incoming`.
 * - `joining` — answered and fetching a token / connecting to the room. Media
 *   is not established here yet, so no duration is shown.
 * - `connected` — the only state that owns media. Duration counts from entry.
 * - `ended` — terminal, with the server's `status` (`ended`, `rejected`,
 *   `cancelled`, `expired`) and a human reason. Auto-dismisses.
 * - `failed` — terminal with an actionable message and a retry path. A 503
 *   lands here with "calling unavailable"; it is never rendered as ringing.
 *
 * What is *not* here: `reconnecting` as a separate state (the media layer
 * reports connecting/connected; the screen shows "reconnecting" as a banner
 * over `connected`), and `busy` (the server answers 409 with the live call and
 * the screen shows that row instead).
 */
export type CallScreenState =
  | { kind: 'idle' }
  | { kind: 'starting'; mode: 'audio' | 'video' }
  | { kind: 'ringing'; call: Call; role: 'caller' | 'callee' }
  | { kind: 'joining'; call: Call; role: 'caller' | 'callee' }
  | { kind: 'connected'; call: Call; role: 'caller' | 'callee'; connectedAt: number }
  | { kind: 'ended'; reason: string; status: string }
  | { kind: 'failed'; message: string; retryable: boolean };

export const CALL_ENDED_DISMISS_MS = 2500;

/** True when this state owns a LiveKit room and must release it on exit. */
export function ownsMedia(state: CallScreenState): boolean {
  return state.kind === 'joining' || state.kind === 'connected';
}

/** True when the call row is live (ringing) rather than decided. */
export function isLiveCall(call: Call): boolean {
  return call.status === 'ringing';
}

/**
 * Human reason for a terminal status. Reads the server's `status`, never a
 * local guess: the client has one response to every terminal outcome (dismiss),
 * and the specific reason only changes the copy.
 */
export function endedReason(call: Call, selfUserId: string | null): string {
  switch (call.status) {
    case 'rejected':
      return call.caller_id === selfUserId ? 'Declined.' : 'You declined the call.';
    case 'cancelled':
      return call.caller_id === selfUserId
        ? 'You cancelled the call.'
        : 'The caller cancelled.';
    case 'expired':
      return 'Missed call — nobody answered in time.';
    case 'ended':
      return 'Call ended.';
    default:
      return 'The call is over.';
  }
}

/** Elapsed whole seconds since connection — shown only in `connected`. */
export function elapsedSeconds(connectedAt: number, now: number = Date.now()): number {
  return Math.max(0, Math.floor((now - connectedAt) / 1000));
}

/** `mm:ss` for the connected duration. Never shown while ringing. */
export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
