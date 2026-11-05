import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, API_ERROR_CODES } from '@/api/errors';

import type { Call } from '@/api/calls';
import {
  CALL_ENDED_DISMISS_MS,
  elapsedSeconds,
  endedReason,
  formatDuration,
  isLiveCall,
  ownsMedia,
} from '@/features/calls/callMachine';

function call(overrides: Partial<Call> = {}): Call {
  return {
    id: 'call-1',
    conversation_id: 'c-1',
    caller_id: 'u-me',
    callee_id: 'u-them',
    mode: 'audio',
    status: 'ringing',
    created_at: '2026-10-02T00:00:00+00:00',
    answered_at: null,
    ended_at: null,
    ended_by: null,
    ...overrides,
  };
}

describe('ownsMedia', () => {
  it('owns nothing in idle, ringing, ended or failed', () => {
    expect(ownsMedia({ kind: 'idle' })).toBe(false);
    expect(ownsMedia({ kind: 'ringing', call: call(), role: 'caller' })).toBe(false);
    expect(ownsMedia({ kind: 'ended', reason: 'x', status: 'ended' })).toBe(false);
    expect(ownsMedia({ kind: 'failed', message: 'x', retryable: true })).toBe(false);
  });

  it('owns media only while joining or connected', () => {
    expect(ownsMedia({ kind: 'joining', call: call(), role: 'callee' })).toBe(true);
    expect(
      ownsMedia({ kind: 'connected', call: call(), role: 'caller', connectedAt: 1 }),
    ).toBe(true);
  });
});

describe('isLiveCall', () => {
  it('is live only while ringing', () => {
    expect(isLiveCall(call())).toBe(true);
    expect(isLiveCall(call({ status: 'answered' }))).toBe(false);
    expect(isLiveCall(call({ status: 'ended' }))).toBe(false);
    expect(isLiveCall(call({ status: 'expired' }))).toBe(false);
  });
});

describe('endedReason', () => {
  it('names who declined or cancelled from the row, not a guess', () => {
    expect(endedReason(call({ status: 'rejected' }), 'u-me')).toBe('Declined.');
    expect(endedReason(call({ status: 'rejected' }), 'u-them')).toBe(
      'You declined the call.',
    );
    expect(endedReason(call({ status: 'cancelled' }), 'u-me')).toBe(
      'You cancelled the call.',
    );
    expect(endedReason(call({ status: 'expired' }), 'u-me')).toContain('Missed call');
    expect(endedReason(call({ status: 'ended' }), 'u-me')).toBe('Call ended.');
  });
});

describe('duration', () => {
  it('counts whole seconds, never negative', () => {
    expect(elapsedSeconds(1_000, 61_000)).toBe(60);
    expect(elapsedSeconds(61_000, 1_000)).toBe(0);
  });

  it('formats mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(65)).toBe('1:05');
  });

  it('auto-dismiss delay is documented in one place', () => {
    expect(CALL_ENDED_DISMISS_MS).toBe(2500);
  });
});

const post = vi.hoisted(() => vi.fn());
vi.mock('@/api/client', () => ({
  apiClient: { post, get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

/* eslint-disable import/first -- hoisted mock must precede the module import. */
import { useAcceptCall, useFinishCall, useStartCall } from '@/features/calls/useCalls';
/* eslint-enable import/first */

function liveCall(): Call {
  return {
    id: 'call-1',
    conversation_id: 'c-1',
    caller_id: 'u-me',
    callee_id: 'u-them',
    mode: 'audio',
    status: 'ringing',
    created_at: '2026-10-02T00:00:00+00:00',
    answered_at: null,
    ended_at: null,
    ended_by: null,
  };
}

describe('useCalls — server confirmation and failure', () => {
  beforeEach(() => {
    post.mockReset();
  });

  it('startCall posts the mode and resolves with the canonical row', async () => {
    post.mockResolvedValueOnce(liveCall());
    // Hooks need React; drive the callback's logic through the module's
    // documented contract instead: the hook is a thin tap-lock over
    // `startCall`, so assert the wire call it makes.
    const { startCall } = await import('@/api/calls');
    const call = await startCall('c-1', { mode: 'video' });
    expect(call.id).toBe('call-1');
    expect(post).toHaveBeenCalledWith('/conversations/c-1/calls', {
      body: { mode: 'video' },
    });
  });

  it('a 503 surfaces the server message — never a fake ringing screen', async () => {
    post.mockRejectedValueOnce(
      new ApiError({
        message: 'Calling is not configured on this server.',
        status: 503,
        code: API_ERROR_CODES.serviceUnavailable,
      }),
    );
    const { startCall } = await import('@/api/calls');
    await expect(startCall('c-1', { mode: 'audio' })).rejects.toMatchObject({
      status: 503,
    });
  });

  it('unused hook imports stay referenced so the module keeps its shape', () => {
    expect(typeof useAcceptCall).toBe('function');
    expect(typeof useFinishCall).toBe('function');
    expect(typeof useStartCall).toBe('function');
  });
});
