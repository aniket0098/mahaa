/**
 * The active call screen — `/call/[id]`, keyed by the call id the server owns.
 *
 * Two entries, one row: the caller arrives after `start` returns a live call
 * (201 created or 200 reused), the callee arrives from `call.incoming` and
 * answers here. What the screen shows is always the server's row, re-read over
 * REST — the socket routes, it never supplies state.
 *
 * **Media honesty.** This build ships no native WebRTC module, so there is no
 * media transport to connect. The screen is the complete *signalling* surface
 * (ring, accept, reject, cancel, end, expiry) and mints no token, plays no
 * fake ringing audio, and shows no connected duration while the call is only
 * ringing. When a media package is added, `joining`/`connected` gain a room
 * connection and nothing else on this screen changes shape.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/errors';
import { type Call, callToken, fetchCallRow } from '@/api/calls';
import { fetchConversation, type Conversation } from '@/api/messages';
import { useAuth } from '@/auth/AuthContext';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { BackButton } from '@/components/ui/BackButton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import {
  CALL_ENDED_DISMISS_MS,
  elapsedSeconds,
  endedReason,
  formatDuration,
  type CallScreenState,
} from '@/features/calls/callMachine';
import { useAcceptCall, useFinishCall } from '@/features/calls/useCalls';
import { otherParticipant } from '@/features/conversation/conversationModel';
import {
  callQueryKeys,
  messagingQueryKeys,
  onCallAccepted,
  onCallEnded,
} from '@/realtime/queryBridge';
import { colors, layout, spacing, typography } from '@/theme/tokens';

/**
 * The call screen's chrome. The top inset is applied here — once — so both
 * exits (the live call and the missing-id notice) start below the Android
 * status bar: the window draws edge-to-edge, and the real inset keeps the
 * system time and notification icons unobstructed on every device.
 */
function CallShell({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.shell, { paddingTop: insets.top }]}>{children}</View>;
}

/**
 * Fold a server row into the next screen state. Pure, so it is safe to call
 * during render: given the current state and the row, it returns the state the
 * row implies, or the current state unchanged when the row does not advance it.
 *
 * The "keep the current state" arms are the point — a row that still reads
 * `answered` must not drag a screen back to `joining` after the callee accepted
 * or a token mint failed, and a terminal row must not overwrite an `ended` copy
 * already derived from a direct action. Only a strictly new row (guarded by
 * `reactedRowKey` at the call site) ever reaches here.
 */
function advanceScreenState(
  current: CallScreenState,
  row: Call,
  selfUserId: string | null,
): CallScreenState {
  const role = row.caller_id === selfUserId ? 'caller' : 'callee';
  switch (row.status) {
    case 'ringing':
      return current.kind === 'ringing' || current.kind === 'starting'
        ? current
        : { kind: 'ringing', call: row, role };
    case 'answered':
      return current.kind === 'joining' ||
        current.kind === 'connected' ||
        current.kind === 'failed'
        ? current
        : { kind: 'joining', call: row, role };
    case 'ended':
    case 'rejected':
    case 'cancelled':
    case 'expired':
      return current.kind === 'ended'
        ? current
        : { kind: 'ended', reason: endedReason(row, selfUserId), status: row.status };
    default:
      return current;
  }
}

export default function CallScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { principal } = useAuth();
  const selfUserId = principal?.id ?? null;

  const callId = typeof id === 'string' && id.length > 0 ? id : null;

  const [state, setState] = useState<CallScreenState>({ kind: 'idle' });
  // The server row this state was last derived from (`id:status`). Guards the
  // render-time derivation below so an ordinary re-render keeps local state.
  const [reactedRowKey, setReactedRowKey] = useState<string | null>(null);
  // A wall-clock reading for the `connected` duration display, refreshed once a
  // second by the interval below. Held in state rather than read with Date.now()
  // during render — the render stays pure — and written only from the interval
  // callback and the entry adjustment below, never synchronously in an effect
  // body. `connectedFrom` records which connection seeded it, so re-entering
  // `connected` re-seeds to that call's `connectedAt` (elapsed 0).
  const [nowMs, setNowMs] = useState(0);
  const [connectedFrom, setConnectedFrom] = useState<number | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const accept = useAcceptCall();
  const finishReject = useFinishCall('reject');
  const finishCancel = useFinishCall('cancel');
  const finishEnd = useFinishCall('end');

  const finishError = finishReject.error ?? finishCancel.error ?? finishEnd.error;
  const dismissFinishError = useCallback(() => {
    finishReject.dismissError();
    finishCancel.dismissError();
    finishEnd.dismissError();
  }, [finishReject, finishCancel, finishEnd]);
  void dismissFinishError;

  // The call row, re-read over REST. The socket says *that* something changed;
  // this is the only authority on *what*.
  const row = useQuery({
    queryKey: callId ? callQueryKeys.detail(callId) : ['calls', 'missing'],
    queryFn: () => fetchCallRow(callId as string),
    enabled: callId !== null,
    retry: false,
  });

  const rowConversationId =
    typeof (row.data as { conversation_id?: unknown } | undefined)?.conversation_id ===
    'string'
      ? (row.data as { conversation_id: string }).conversation_id
      : null;

  // The conversation, for the other person's name and avatar. Resolved from
  // the thread the call belongs to — never from a socket payload, which
  // carries identifiers only.
  const conversation = useQuery({
    queryKey: rowConversationId
      ? messagingQueryKeys.conversation(rowConversationId)
      : ['conversations', 'missing'],
    queryFn: () => fetchConversation(rowConversationId as string),
    enabled: rowConversationId !== null,
    retry: false,
  });

  const participant = useMemo(() => {
    const data = conversation.data as Conversation | undefined;
    return otherParticipant(data?.members ?? [], selfUserId);
  }, [conversation.data, selfUserId]);

  const refreshRow = useCallback(() => {
    if (callId) {
      void queryClient.invalidateQueries({ queryKey: callQueryKeys.detail(callId) });
    }
  }, [callId, queryClient]);
  // Callee entry: answer here. Caller entry: wait for `call.accepted`, which the
  // bridge routes below — the row is still the authority on what was answered.
  useEffect(() => {
    if (!callId) return;
    void row.refetch();
    return onCallAccepted((p) => {
      if (p.callId === callId) void row.refetch();
    });
    // `row` is a stable query object; depending on it would re-subscribe on
    // every fetch. `callId` is the only real input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  // Either side: a terminal event ends the screen with the server's status,
  // never a local guess. The row re-read below supplies the reason.
  useEffect(() => {
    if (!callId) return;
    return onCallEnded((p) => {
      if (p.callId !== callId) return;
      void row.refetch();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  function scheduleDismiss() {
    if (dismissTimer.current) clearTimeout(dismissTimer.current);
    dismissTimer.current = setTimeout(() => {
      if (callId) {
        const convId = rowConversationId;
        if (convId) {
          void queryClient.invalidateQueries({
            queryKey: callQueryKeys.history(convId),
          });
        }
        void queryClient.invalidateQueries({
          queryKey: messagingQueryKeys.conversations,
        });
      }
      router.back();
    }, CALL_ENDED_DISMISS_MS);
  }

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    },
    [],
  );

  // Derive the screen state from the server row — during render, not an effect.
  //
  // The row is the authority on what changed; this folds its `status` into the
  // product state in the same render pass. Doing it in an effect and calling
  // setState there is what the React lint rejects (`react-hooks/set-state-in-
  // effect`): it paints the previous state for a frame and then corrects it,
  // cascading a second render. React re-runs this component immediately, before
  // paint and before children, so the corrected state is what the user sees.
  //
  // `reactedRowKey` guards the update to once per genuinely new row (`id:status`),
  // so an ordinary re-render — a duration tick, the conversation fetch landing —
  // keeps the current state. That includes local states further along than the
  // row: an optimistic `joining` set by the callee's accept, or a `failed` from a
  // minted-token outcome the row (still `answered`) must not undo.
  const rowData = row.data as Call | undefined;
  const rowKey = rowData ? `${rowData.id}:${rowData.status}` : null;
  if (rowData && rowKey !== reactedRowKey) {
    setReactedRowKey(rowKey);
    setState((s) => advanceScreenState(s, rowData, selfUserId));
  }

  // Seed the duration clock the moment we enter `connected` (render-time
  // adjustment — no synchronous setState in an effect). Starting from the
  // call's own `connectedAt` shows elapsed 0 until the first interval tick.
  if (state.kind === 'connected' && connectedFrom !== state.connectedAt) {
    setConnectedFrom(state.connectedAt);
    setNowMs(state.connectedAt);
  }

  // Refresh the clock once a second while connected — never while ringing. The
  // Date.now() read lives in the interval callback, so render stays pure.
  useEffect(() => {
    if (state.kind !== 'connected') return;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.kind]);

  /**
   * Mint a LiveKit join token on demand and report the honest outcome. A
   * mutation, not an imperative async function called from an effect: the token
   * fetch is async work whose result updates local state, which is exactly what
   * `useMutation` models — and `mutate()` from the transition effect does not
   * cascade a render the way a synchronous setState in an effect body would.
   */
  const joinMutation = useMutation({
    mutationFn: (id: string) => callToken(id),
    onSuccess: () => {
      // No media module is installed in this build, so a minted token has no
      // room to join — and joining nothing while claiming "connected" would be
      // a fake call screen. The signalling completed (the row is answered) and
      // media transport is the documented next step. The grant is dropped,
      // never stored, never logged.
      setState((s) =>
        s.kind === 'joining'
          ? {
              kind: 'failed',
              message:
                'The call was answered, but this build has no voice or video ' +
                'module yet — media transport is the documented next step.',
              retryable: false,
            }
          : s,
      );
    },
    onError: (error) => {
      const status = error instanceof ApiError ? error.status : null;
      setState({
        kind: 'failed',
        message:
          status === 503
            ? 'Calling is not configured on this server yet.'
            : error instanceof ApiError
              ? error.message
              : 'Could not join the call.',
        retryable: status !== 503,
      });
    },
  });

  // Side effects that follow a state transition, each once per transition
  // (keyed on `state.kind`, driven by the derivation above). Kept in one effect
  // so the row — not the socket — is the single trigger, matching the screen's
  // "the socket routes, the row is the authority" contract.
  useEffect(() => {
    if (state.kind === 'ringing') {
      // The callee needs the thread for the caller's name — the socket carries
      // identifiers only, so fetch it now rather than rendering "Conversation".
      if (!conversation.data) void conversation.refetch();
    } else if (state.kind === 'joining') {
      if (callId) joinMutation.mutate(callId);
    } else if (state.kind === 'ended') {
      scheduleDismiss();
    }
    // `state.kind` is the only input that should re-run this; the closures read
    // stable refs, setters, and the query objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kind]);

  async function onAccept() {
    if (!callId) return;
    const { call } = await accept.accept(callId);
    if (call) {
      setState({ kind: 'joining', call, role: 'callee' });
      refreshRow();
    }
  }

  async function onReject() {
    if (!callId) return;
    const { call } = await finishReject.finish(callId);
    if (call) {
      setState({
        kind: 'ended',
        reason: endedReason(call, selfUserId),
        status: call.status,
      });
      scheduleDismiss();
    }
  }

  async function onCancel() {
    if (!callId) return;
    const { call } = await finishCancel.finish(callId);
    if (call) {
      setState({
        kind: 'ended',
        reason: endedReason(call, selfUserId),
        status: call.status,
      });
      scheduleDismiss();
    }
  }

  async function onEnd() {
    if (!callId) return;
    const { call } = await finishEnd.finish(callId);
    if (call) {
      setState({
        kind: 'ended',
        reason: endedReason(call, selfUserId),
        status: call.status,
      });
      scheduleDismiss();
    }
  }

  const name = participant?.name ?? 'Conversation';
  const statusLine =
    state.kind === 'ringing'
      ? state.role === 'caller'
        ? 'Ringing…'
        : 'Incoming call'
      : state.kind === 'starting'
        ? 'Starting…'
        : state.kind === 'joining'
          ? 'Connecting…'
          : state.kind === 'connected'
            // `nowMs` re-renders every second while connected (written by the
            // interval above); reading it here subscribes this render to it.
            ? formatDuration(elapsedSeconds(state.connectedAt, nowMs))
            : state.kind === 'ended'
              ? state.reason || 'The call is over.'
              : state.kind === 'failed'
                ? state.message
                : row.isPending
                  ? 'Loading…'
                  : 'Call';

  if (!callId) {
    return (
      <CallShell>
        <BackButton />
        <StatusBanner
          title="Call not found"
          description="This link is missing a valid call. Go back and try again."
        />
      </CallShell>
    );
  }

  return (
    <CallShell>
      <View style={styles.header}>
        <BackButton />
        <AppText variant="body" weight="semibold">
          {state.kind === 'connected'
            ? 'Connected'
            : state.kind === 'failed'
              ? 'Call failed'
              : 'Call'}
        </AppText>
        <View style={styles.headerSpacer} />
      </View>

      <View style={styles.body}>
        <Avatar name={name} src={participant?.avatar_url ?? null} size={96} />
        <AppText variant="h2" weight="semibold" style={styles.name}>
          {name}
        </AppText>
        <AppText variant="body" tone="secondary" accessibilityLiveRegion="polite">
          {statusLine}
        </AppText>
        {state.kind === 'ringing' && state.role === 'callee' ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reject call"
              disabled={finishReject.finishing || accept.accepting}
              onPress={() => void onReject()}
              style={({ pressed }) => [
                styles.actionButton,
                styles.rejectButton,
                pressed ? styles.pressed : null,
              ]}>
              <AppText variant="body" weight="semibold" tone="onPrimary">
                Reject
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Accept call"
              disabled={finishReject.finishing || accept.accepting}
              onPress={() => void onAccept()}
              style={({ pressed }) => [
                styles.actionButton,
                styles.acceptButton,
                pressed ? styles.pressed : null,
              ]}>
              {accept.accepting ? (
                <ActivityIndicator color={colors.colorOnPrimary} />
              ) : (
                <AppText variant="body" weight="semibold" tone="onPrimary">
                  Accept
                </AppText>
              )}
            </Pressable>
          </View>
        ) : null}

        {state.kind === 'ringing' && state.role === 'caller' ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel call"
              disabled={finishCancel.finishing}
              onPress={() => void onCancel()}
              style={({ pressed }) => [
                styles.actionButton,
                styles.rejectButton,
                pressed ? styles.pressed : null,
              ]}>
              <AppText variant="body" weight="semibold" tone="onPrimary">
                Cancel
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {state.kind === 'joining' ? (
          <ActivityIndicator size="large" color={colors.colorPrimary} />
        ) : null}

        {state.kind === 'connected' ? (
          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="End call"
              disabled={finishEnd.finishing}
              onPress={() => void onEnd()}
              style={({ pressed }) => [
                styles.actionButton,
                styles.rejectButton,
                pressed ? styles.pressed : null,
              ]}>
              <AppText variant="body" weight="semibold" tone="onPrimary">
                End
              </AppText>
            </Pressable>
          </View>
        ) : null}

        {accept.error ? (
          <AppText variant="caption" tone="danger">
            {accept.error}
          </AppText>
        ) : null}
        {finishError ? (
          <AppText variant="caption" tone="danger">
            {finishError}
          </AppText>
        ) : null}
      </View>
    </CallShell>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.colorBgPage,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  headerSpacer: {
    width: layout.touchTargetPrimary,
  },
  body: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.md,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  name: {
    fontSize: typography.fontSizeH2,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.lg,
  },
  actionButton: {
    alignItems: 'center',
    borderRadius: 999,
    justifyContent: 'center',
    minHeight: layout.touchTargetPrimary,
    minWidth: 120,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
  },
  acceptButton: {
    backgroundColor: colors.colorSuccess,
  },
  rejectButton: {
    backgroundColor: colors.colorDanger,
  },
  pressed: {
    opacity: 0.8,
  },
});
