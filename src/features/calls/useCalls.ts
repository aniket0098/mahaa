import { useCallback, useRef, useState } from 'react';

import {
  acceptCall,
  cancelCall,
  endCall,
  rejectCall,
  startCall,
  type Call,
} from '@/api/calls';
import { ApiError } from '@/api/errors';

/**
 * The result of one call-screen action: the canonical row the server returned,
 * or nothing when the server refused and the error state already carries it.
 */
export type CallActionResult = { call: Call | null };

function messageOf(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

/**
 * Start a call — the caller's entry point.
 *
 * 201 and 200 both mean "show this call": re-ringing a conversation that
 * already has a live call returns that row (200), so double-tapping the call
 * button reuses rather than duplicates. The caller owns the error: a 403 (not
 * a member / not connected) or a 503 (calling not configured) lands here with
 * the server's message, never as a fake ringing screen.
 */
export function useStartCall() {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startingRef = useRef(false);

  const start = useCallback(
    async (conversationId: string, mode: 'audio' | 'video'): Promise<CallActionResult> => {
      // The ref (not the state) is the double-tap guard: state updates flush
      // after the tap handler returns, so two taps in one frame would both see
      // `starting === false` and fire two invitations. The ref flips
      // synchronously inside the same tick.
      if (startingRef.current) return { call: null };
      startingRef.current = true;
      setStarting(true);
      setError(null);
      try {
        const call = await startCall(conversationId, { mode });
        return { call };
      } catch (err) {
        setError(messageOf(err, 'Could not start the call.'));
        return { call: null };
      } finally {
        startingRef.current = false;
        setStarting(false);
      }
    },
    [],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { start, starting, error, dismissError };
}

/**
 * Answer an incoming call — callee only, one tap.
 *
 * The tap is locked while the request is in flight, so a double-tap cannot
 * send two accepts; the server decides the single outcome atomically anyway.
 * The caller navigates on the returned row, not on the socket event — the row
 * is the authority on what was answered.
 */
export function useAcceptCall() {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const acceptingRef = useRef(false);

  const accept = useCallback(
    async (callId: string): Promise<CallActionResult> => {
      // Same synchronous guard as `useStartCall`: two taps in one frame must
      // not send two accepts, and the server decides the single outcome
      // atomically anyway.
      if (acceptingRef.current) return { call: null };
      acceptingRef.current = true;
      setAccepting(true);
      setError(null);
      try {
        const call = await acceptCall(callId);
        return { call };
      } catch (err) {
        setError(messageOf(err, 'Could not answer the call.'));
        return { call: null };
      } finally {
        acceptingRef.current = false;
        setAccepting(false);
      }
    },
    [],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { accept, accepting, error, dismissError };
}

/**
 * Reject, cancel, or end — the three ways a call reaches a terminal state.
 *
 * One hook because the three share everything: terminal POST, tap lock,
 * server message on failure, and the state machine's `ended` copy derived from
 * the returned row. The caller passes which verb to use; the hook never
 * guesses — reject is callee-only, cancel is caller-only, end is either.
 */
export function useFinishCall(kind: 'reject' | 'cancel' | 'end') {
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const finishingRef = useRef(false);

  const finish = useCallback(
    async (callId: string): Promise<CallActionResult> => {
      // Same synchronous guard: a terminal verb sent twice is at best a 409
      // and at worst a confusing error on a screen that is already leaving.
      if (finishingRef.current) return { call: null };
      finishingRef.current = true;
      setFinishing(true);
      setError(null);
      try {
        const call =
          kind === 'reject'
            ? await rejectCall(callId)
            : kind === 'cancel'
              ? await cancelCall(callId)
              : await endCall(callId);
        return { call };
      } catch (err) {
        setError(messageOf(err, 'Could not finish the call.'));
        return { call: null };
      } finally {
        finishingRef.current = false;
        setFinishing(false);
      }
    },
    [kind],
  );

  const dismissError = useCallback(() => setError(null), []);

  return { finish, finishing, error, dismissError };
}
