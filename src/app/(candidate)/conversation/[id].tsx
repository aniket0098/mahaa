/**
 * One-to-one conversation — `/conversation/[id]`.
 *
 * Reached from a Messages row or from the supported start-conversation flow, and
 * keyed by the conversation id the server owns. Everything this screen shows is
 * an authorized read of that conversation; a non-member gets 404 from the
 * server, and this screen has no code path that could evade that — it never
 * renders another conversation's rows.
 *
 * The data flow is deliberately boring:
 *
 *  - **Open** reads the detail (`members`, `last_message`, `unread_count`), so
 *    the header is the other person and the read pointer moves to the latest
 *    message on open.
 *  - **History** pages the thread oldest-to-newest. Opening shows the most
 *    recent page; "Load older" walks one cursor back; the screen refetches on
 *    focus and the realtime bridge invalidates on a socket event, so an active
 *    thread corrects itself without a poll that pretends to be realtime.
 *  - **Send** posts the body with a stable `client_message_id`, and the row
 *    appears only when the server's answer lands — never as an optimistic
 *    placeholder that could lie about delivery. The draft survives a failure;
 *    only a confirmed send clears it.
 *
 * The header carries **no voice or video affordance**: those capabilities do not
 * exist on this backend, and a visual-only call button would imply calling is
 * functional. Presence is likewise absent — so there is no online dot.
 */

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import {
  launchImageLibraryAsync,
  requestMediaLibraryPermissionsAsync,
} from 'expo-image-picker';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApiError } from '@/api/errors';
import {
  absoluteMediaUri,
  authenticatedImageSource,
  getMediaAuthVersion,
  loadPlayableVideoUri,
  subscribeMediaAuth,
  uploadPickedMedia,
  type PickedMedia,
} from '@/api/media';
import {
  fetchConversation,
  listMessages,
  markConversationRead,
  sendMessage,
  deleteMessage,
  editMessage,
  type MessageAttachment,
  type ThreadMessage,
} from '@/api/messages';
import { useAuth } from '@/auth/AuthContext';
import { AppIcon } from '@/components/ui/AppIcon';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { BackButton } from '@/components/ui/BackButton';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { MediaViewer } from '@/features/feed/MediaViewer';
import { type FeedMedia } from '@/features/feed/feedModel';
import {
  attachmentLabel,
  bubbleText,
  buildConversationRows,
  canEdit,
  canSend,
  isDeleted,
  isEdited,
  otherParticipant,
  type ConversationRow,
} from '@/features/conversation/conversationModel';
import {
  EMOJI_GROUPS,
  insertEmojiAtSelection,
  type Selection,
} from '@/features/conversation/emoji';
import { useKeyboardVisible } from '@/features/conversation/useKeyboardVisible';
import { useStartCall } from '@/features/calls/useCalls';
import { measureLocalFileSize } from '@/lib/localMedia';
import { messagingQueryKeys } from '@/realtime/queryBridge';
import { colors, layout, radius, spacing, typography } from '@/theme/tokens';

/** One history page; the server's default is the same, asked for once. */
const MESSAGE_PAGE_LIMIT = 30;

/**
 * The conversation header: back, the other person, and the two call actions.
 *
 * A separate component so the main screen stays readable — and so the call
 * state (starting spinner, 503 notice) lives next to the buttons that caused
 * it rather than in the message thread's state.
 *
 * Voice and video are real: each starts a server invitation (`POST
 * /conversations/{id}/calls`) and navigates to the call screen only when the
 * server returns a live row. A 503 (calling not configured) renders as an
 * honest notice, never as a fake ringing screen. Double-tap is safe: the hook
 * locks while starting, and the server reuses a live call (200) instead of
 * inserting a second row.
 */
function ConversationHeader({
  headerName,
  headerPublicId,
  participantAvatar,
  conversationId,
}: {
  headerName: string;
  headerPublicId: string | null;
  participantAvatar: string | null;
  conversationId: string;
}) {
  const router = useRouter();
  const starter = useStartCall();

  async function onCall(mode: 'audio' | 'video') {
    const { call } = await starter.start(conversationId, mode);
    if (call) {
      router.push(`/call/${encodeURIComponent(call.id)}` as never);
    }
  }

  return (
    <View style={styles.header}>
      <BackButton />
      <Pressable
        onPress={() => {
          if (headerPublicId)
            router.push(`/user/${encodeURIComponent(headerPublicId)}` as never);
        }}
        disabled={!headerPublicId}
        accessibilityRole="button"
        accessibilityLabel={`Open ${headerName}'s profile`}
        accessibilityHint="Opens their public profile"
        style={({ pressed }) => [styles.headerIdentity, pressed ? styles.pressed : null]}>
        <Avatar name={headerName} src={participantAvatar} size={40} />
        <View style={styles.headerText}>
          <AppText variant="body" weight="semibold" numberOfLines={1}>
            {headerName}
          </AppText>
          {/*
            No headline or presence line: `UserSummary` carries neither, and
            the server has no presence feed to supply one. A second line here
            would have to be invented.
          */}
        </View>
      </Pressable>
      <View style={styles.headerCalls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Start a voice call with ${headerName}`}
          accessibilityHint="Rings the other person; they can accept or decline"
          disabled={starter.starting}
          onPress={() => void onCall('audio')}
          style={({ pressed }) => [
            styles.callButton,
            starter.starting ? styles.callButtonDisabled : null,
            pressed ? styles.pressed : null,
          ]}>
          <AppIcon name={{ ios: 'phone.fill', android: 'call' }} size={22} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Start a video call with ${headerName}`}
          accessibilityHint="Rings the other person with video; they can accept or decline"
          disabled={starter.starting}
          onPress={() => void onCall('video')}
          style={({ pressed }) => [
            styles.callButton,
            starter.starting ? styles.callButtonDisabled : null,
            pressed ? styles.pressed : null,
          ]}>
          <AppIcon name={{ ios: 'video.fill', android: 'videocam' }} size={22} />
        </Pressable>
      </View>
      {starter.error ? (
        <AppText variant="caption" tone="danger">
          {starter.error}
        </AppText>
      ) : null}
    </View>
  );
}

/**
 * Mirrors the backend's `MESSAGE_BODY_MAX = 4000` (`schemas/messaging.py`).
 *
 * The server is the authority — it rejects an over-long body with a 422 — but
 * capping the input here means the composer stops at the same limit rather than
 * letting someone type a paragraph that can only fail on submit. Kept identical
 * on purpose; if the server's cap ever moves, this constant moves with it.
 */
const MESSAGE_BODY_MAX = 4000;

/**
 * A stable idempotency key per send attempt.
 *
 * Reused across a retry of the *same* attempt, so a tap that timed out and a
 * retry of it cannot append the message twice — the server answers 200 with the
 * same record. A new key is minted per new attempt: never one per screen mount,
 * which would collapse two genuinely different messages into one if the first
 * one's answer arrived late.
 */
function newClientMessageId(): string {
  return `cmi-${Date.now().toString(36)}-${Math.floor(Math.random() * 0xffffffff).toString(36)}`;
}

export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const { principal } = useAuth();
  const listRef = useRef<FlatList>(null);

  const conversationId = typeof id === 'string' && id.length > 0 ? id : null;
  // The caller's internal user id — what every sender row is compared against.
  const selfUserId = principal?.id ?? null;

  // The thread's older half. Kept as accumulated pages rather than one infinite
  // query, because `cursor` walks backwards through history and the opened page
  // is already the newest one — the only direction to walk is up.
  const [olderItems, setOlderItems] = useState<ThreadMessage[]>([]);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [olderLoaded, setOlderLoaded] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  const conversation = useQuery({
    queryKey: messagingQueryKeys.conversation(conversationId ?? ''),
    queryFn: () => fetchConversation(conversationId as string),
    enabled: conversationId !== null,
    retry: false,
  });

  const history = useQuery({
    queryKey: messagingQueryKeys.messages(conversationId ?? ''),
    queryFn: () => listMessages(conversationId as string, { limit: MESSAGE_PAGE_LIMIT }),
    enabled: conversationId !== null,
    retry: false,
    // While this screen is mounted the history is read on focus, so a reply
    // sent from another session lands when the reader comes back — and the
    // realtime bridge already invalidates on a socket event. No timer is set: a
    // poll would be a claim to realtime the transport does not make.
    refetchOnWindowFocus: true,
  });

  // The full thread in server order: older pages first, newest page last.
  const thread: ThreadMessage[] = useMemo(() => {
    const newest = history.data?.items ?? [];
    return [...olderItems, ...newest];
  }, [olderItems, history.data]);

  const participant = useMemo(
    () => otherParticipant(conversation.data?.members ?? [], selfUserId),
    [conversation.data, selfUserId],
  );

  const rows: ConversationRow[] = useMemo(
    () => buildConversationRows(thread, selfUserId),
    [thread, selfUserId],
  );

  // Move the read pointer to the newest row whenever it grows. Debounced, and
  // fire-and-forget after the timer fires: a thread that displays the message
  // has displayed it — the badge is corrected by the server's next count, not
  // by this call's success.
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!conversationId || thread.length === 0) return;
    const latest = thread[thread.length - 1];
    if (!latest) return;
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => {
      void markConversationRead(conversationId, latest.id).catch(() => undefined);
    }, 500);
    return () => {
      if (readTimer.current) clearTimeout(readTimer.current);
    };
  }, [conversationId, thread]);

  // Keep the newest message visible when the thread grows or a send lands. Not
  // animated: an animated scroll on every socket event would fight the reader.
  useEffect(() => {
    if (rows.length === 0) return;
    const handle = setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 60);
    return () => clearTimeout(handle);
  }, [rows.length, history.dataUpdatedAt]);

  const refreshThread = () => {
    void queryClient.invalidateQueries({
      queryKey: messagingQueryKeys.messages(conversationId ?? ''),
    });
    void queryClient.invalidateQueries({ queryKey: messagingQueryKeys.conversations });
    void queryClient.invalidateQueries({
      queryKey: messagingQueryKeys.conversation(conversationId ?? ''),
    });
  };

  const loadOlder = () => {
    if (!conversationId || loadingOlder) return;
    const cursor = olderLoaded ? olderCursor : (history.data?.next_cursor ?? null);
    if (!cursor) return;
    setLoadingOlder(true);
    setOlderError(null);
    listMessages(conversationId, { cursor, limit: MESSAGE_PAGE_LIMIT })
      .then((page) => {
        // Prepend: an older page belongs ahead of everything held so far.
        setOlderItems((held) => [...page.items, ...held]);
        setOlderCursor(page.next_cursor);
        setOlderLoaded(true);
      })
      .catch((error: unknown) => {
        setOlderError(
          error instanceof ApiError ? error.message : 'Older messages could not be loaded.',
        );
      })
      .finally(() => setLoadingOlder(false));
  };

  const newestHasMore = history.data?.has_more === true;
  const oldestCursor = olderLoaded ? olderCursor : (history.data?.next_cursor ?? null);
  const canLoadOlder =
    Boolean(conversationId) &&
    !history.isPending &&
    !history.isError &&
    (newestHasMore || oldestCursor !== null);

  const send = useSendMessage(conversationId, refreshThread);
  const remove = useDeleteMessage(refreshThread);
  const edit = useEditMessage(refreshThread);
  const [confirmTarget, setConfirmTarget] = useState<ThreadMessage | null>(null);
  // The message whose long-press action sheet is open, and the one currently
  // loaded into the composer for editing. Separate: the sheet is transient
  // chrome; the edit target is what the composer is working on, and survives
  // the sheet closing.
  const [menuTarget, setMenuTarget] = useState<ThreadMessage | null>(null);
  const [editTarget, setEditTarget] = useState<ThreadMessage | null>(null);

  // The full-screen viewer for a tapped image attachment. One message carries
  // at most one attachment, so the list handed to the shared `MediaViewer` is
  // always a single element opened at index 0 — the viewer's props are shaped
  // for the feed's multi-image posts and are not widened here.
  const [viewerMedia, setViewerMedia] = useState<readonly FeedMedia[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  const openAttachment = (message: ThreadMessage) => {
    const media = message.media;
    // Only a live image opens the viewer: a tombstone reveals neither its text
    // nor its attachment, and a video plays inline in the bubble instead.
    if (!media || isDeleted(message) || media.kind !== 'image') return;
    setViewerMedia([
      {
        id: media.id,
        kind: media.kind,
        uri: absoluteMediaUri(media.served_at),
        // 0 means the server did not derive a size, which the viewer falls
        // back to a contained box for — never NaN.
        width: media.width ?? 0,
        height: media.height ?? 0,
        alt: 'Photo sent in this conversation',
      },
    ]);
    setViewerIndex(0);
  };

  // Copy-to-clipboard feedback. The success line is transient — it is a
  // confirmation, and the project rule reserves persistence for failures —
  // while a failure renders as a banner that stays until it is retried or a
  // later copy succeeds. `copyFailedTarget` is what the banner's retry re-runs
  // (state, not a ref: it is read during render to decide whether to offer
  // the retry at all).
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [copyFailedTarget, setCopyFailedTarget] = useState<ThreadMessage | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    };
  }, []);

  const copyMessage = async (message: ThreadMessage): Promise<void> => {
    // A tombstone has no body — the server nulls it — so there is nothing to
    // copy and the menu never offers it. The guard keeps that true even if a
    // stale row ever slipped through.
    if (message.body === null) return;
    try {
      await Clipboard.setStringAsync(message.body);
      setCopyFailedTarget(null);
      setCopyError(null);
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyFailedTarget(message);
      setCopyError('The message could not be copied.');
    }
  };

  // A missing id is a broken link, not a loading state.
  if (!conversationId) {
    return (
      <ConversationShell>
        <BackButton />
        <StatusBanner
          title="Conversation not found"
          description="This link is missing a valid conversation. Go back and try again."
        />
      </ConversationShell>
    );
  }

  const headerName = participant?.name ?? 'Conversation';
  const headerPublicId = participant?.public_id ?? null;
  // What the open action sheet may offer beyond Copy. Edit and Delete are
  // sender-only on the server too, so they are hidden — not disabled — on an
  // incoming row rather than inviting a tap that can only 404.
  const menuEditable = menuTarget !== null && canEdit(menuTarget, selfUserId);

  // Whichever read actually failed, carrying the server's own message. A 401,
  // 403, 404, 429, 5xx and a network failure each say something different, and
  // collapsing them into one invented sentence would tell the reader less than
  // the server already told us. A non-Api failure (unexpected shape, thrown
  // value) falls back to honest generic copy rather than a fabricated reason.
  const loadFailure = conversation.isError
    ? conversation.error
    : history.isError
      ? history.error
      : null;

  return (
    <ConversationShell>
      {/* Header: back, the other person, and the call actions. The buttons are
          real: voice starts an audio call, video starts a video call, both
          through the server's invitation flow — never a fake ringing screen. */}
      <ConversationHeader
        headerName={headerName}
        headerPublicId={headerPublicId}
        participantAvatar={participant?.avatar_url ?? null}
        conversationId={conversationId}
      />

      {history.isPending || conversation.isPending ? (
        <View style={styles.body}>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={2} />
        </View>
      ) : null}

      {!history.isPending && (history.isError || conversation.isError) ? (
        <View style={styles.body}>
          <StatusBanner
            title={
              conversation.isError
                ? "Couldn't load this conversation"
                : "Couldn't load these messages"
            }
            description={
              loadFailure instanceof ApiError
                ? loadFailure.message
                : 'The thread could not be loaded. Check your connection and retry.'
            }
            onRetry={refreshThread}
          />
        </View>
      ) : null}

      {!history.isPending && !history.isError && !conversation.isError && thread.length === 0 ? (
        <View style={styles.body}>
          <StatusBanner
            tone="info"
            title="No messages yet"
            description={`Say hello to ${headerName} — your message will appear here once the server confirms it.`}
          />
        </View>
      ) : null}

      {!history.isPending && !history.isError && thread.length > 0 ? (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row, index) =>
            row.kind === 'separator' ? `day-${row.day}` : `msg-${row.entry.message.id}-${index}`
          }
          style={styles.list}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            canLoadOlder ? (
              <View style={styles.olderWrap}>
                {loadingOlder ? (
                  <ActivityIndicator size="small" color={colors.colorPrimary} />
                ) : (
                  <AppText
                    variant="small"
                    weight="semibold"
                    tone="accent"
                    accessibilityRole="button"
                    accessibilityLabel="Load older messages"
                    onPress={loadOlder}
                    style={styles.olderButton}>
                    Load older messages
                  </AppText>
                )}
                {olderError ? (
                  <AppText variant="caption" tone="danger">
                    {olderError}
                  </AppText>
                ) : null}
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            if (item.kind === 'separator') {
              return (
                <View style={styles.separator} accessibilityRole="header">
                  <View style={styles.separatorLine} />
                  <AppText variant="caption" tone="tertiary" style={styles.separatorText}>
                    {item.label}
                  </AppText>
                  <View style={styles.separatorLine} />
                </View>
              );
            }
            return (
              <MessageBubble
                row={item}
                editable={canEdit(item.entry.message, selfUserId)}
                deleting={remove.deletingId === item.entry.message.id}
                editing={edit.savingId === item.entry.message.id}
                onMenuRequest={() => setMenuTarget(item.entry.message)}
                onOpenMedia={() => openAttachment(item.entry.message)}
              />
            );
          }}
        />
      ) : null}

      {/* Copy feedback: the success line is transient (a non-critical
          confirmation), the failure is a persistent banner with a retry —
          never a toast, per the project's error rule. */}
      {copyError ? (
        <StatusBanner
          title="Copy failed"
          description={copyError}
          onRetry={
            copyFailedTarget
              ? () => {
                  void copyMessage(copyFailedTarget);
                }
              : undefined
          }
        />
      ) : null}
      {copied ? (
        <AppText
          variant="caption"
          tone="secondary"
          accessibilityLiveRegion="polite"
          style={styles.copyNotice}
          testID="copy-success">
          Copied to clipboard
        </AppText>
      ) : null}

      <Composer
        disabled={history.isPending || history.isError}
        sending={send.sending}
        error={send.error}
        onSend={(text, mediaId) => send.send(text, mediaId)}
        onDismissError={send.dismissError}
        editing={editTarget}
        saving={edit.busy}
        editError={edit.error}
        onSaveEdit={(message, text) => {
          /*
           * `edit.save` rethrows on failure so the composer keeps the draft; the
           * error is already in `edit.error` and rendered above. On success the
           * hook refetches (canonical row + honest Edited marker) and we drop
           * out of edit mode. The `.catch` here only stops an unhandled
           * rejection — it is not the failure handler.
           */
          void edit
            .save(message, text)
            .then(() => setEditTarget(null))
            .catch(() => undefined);
        }}
        onCancelEdit={() => {
          edit.dismissError();
          setEditTarget(null);
        }}
        onDismissEditError={edit.dismissError}
      />

      {/*
       * Destructive-action confirmation. It names the real scope — the server
       * deletes for *both* sides as a tombstone, so the copy says so instead of
       * implying the other person still has the message.
       */}
      {confirmTarget ? (
        <View style={styles.confirmScrim}>
          <View style={styles.confirmCard}>
            <AppText variant="h3" tone="primary">
              Delete message?
            </AppText>
            <AppText variant="body" tone="secondary" style={styles.confirmBody}>
              This removes the message for both of you. It stays in place as
              &ldquo;This message was deleted&rdquo; — it cannot be restored.
            </AppText>
            {remove.error ? (
              <StatusBanner title="Delete failed" description={remove.error} />
            ) : null}
            <View style={styles.confirmActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Keep message"
                disabled={remove.busy}
                onPress={() => {
                  remove.dismissError();
                  setConfirmTarget(null);
                }}
                style={({ pressed }) => [
                  styles.confirmButton,
                  styles.confirmCancel,
                  remove.busy ? styles.confirmDisabled : null,
                  pressed ? styles.pressed : null,
                ]}>
                <AppText variant="body" weight="semibold" tone="secondary">
                  Keep
                </AppText>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete message for both of you"
                disabled={remove.busy}
                onPress={() => {
                  /*
                   * `remove` rethrows so the dialog stays open on failure. The
                   * error is already in `remove.error` and rendered above, so it
                   * is swallowed here — this catch only stops an unhandled
                   * rejection, it is not the failure handler.
                   */
                  void remove
                    .remove(confirmTarget)
                    .then(() => setConfirmTarget(null))
                    .catch(() => undefined);
                }}
                style={({ pressed }) => [
                  styles.confirmButton,
                  remove.busy ? styles.confirmDisabled : null,
                  pressed ? styles.pressed : null,
                ]}>
                <AppText variant="body" weight="semibold" tone="danger">
                  {remove.busy ? 'Deleting…' : 'Delete'}
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}

      {/*
        The long-press action sheet. Long-pressing any live bubble (incoming
        included) sets `menuTarget`; this is the menu that consumes it. Copy
        is offered on every row with a body — reading somebody else's message
        is not a privileged action. Edit and Delete are sender-only (the
        server 404s anybody else), so they render only where `menuEditable`
        is true; a tombstone never opens this sheet at all. Copy closes the
        sheet immediately and runs the clipboard write; Edit loads the
        message into the composer; Delete hands off to the destructive
        confirm dialog (which names the real both-sides scope). Tapping the
        scrim or Cancel just dismisses.
      */}
      {menuTarget ? (
        <View style={styles.menuScrim}>
          <Pressable
            style={styles.menuScrimFill}
            accessibilityRole="button"
            accessibilityLabel="Dismiss message actions"
            onPress={() => setMenuTarget(null)}
          />
          <View style={styles.menuCard}>
            <AppText variant="caption" tone="tertiary" style={styles.menuTitle} numberOfLines={1}>
              {menuTarget.body ??
                (attachmentLabel(menuTarget) ?? 'This message was deleted')}
            </AppText>
            {menuTarget.body !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Copy message text"
                onPress={() => {
                  const target = menuTarget;
                  setMenuTarget(null);
                  void copyMessage(target);
                }}
                style={({ pressed }) => [styles.menuItem, pressed ? styles.pressed : null]}>
                <AppText variant="body" weight="semibold" tone="primary">
                  Copy
                </AppText>
              </Pressable>
            ) : null}
            {menuEditable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit message"
                disabled={edit.busy || remove.busy}
                onPress={() => {
                  const target = menuTarget;
                  setMenuTarget(null);
                  edit.dismissError();
                  setEditTarget(target);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  edit.busy || remove.busy ? styles.confirmDisabled : null,
                  pressed ? styles.pressed : null,
                ]}>
                <AppText variant="body" weight="semibold" tone="primary">
                  Edit
                </AppText>
              </Pressable>
            ) : null}
            {menuEditable ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Delete message"
                disabled={edit.busy || remove.busy}
                onPress={() => {
                  const target = menuTarget;
                  setMenuTarget(null);
                  remove.dismissError();
                  setConfirmTarget(target);
                }}
                style={({ pressed }) => [
                  styles.menuItem,
                  styles.menuItemDanger,
                  edit.busy || remove.busy ? styles.confirmDisabled : null,
                  pressed ? styles.pressed : null,
                ]}>
                <AppText variant="body" weight="semibold" tone="danger">
                  Delete
                </AppText>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              onPress={() => setMenuTarget(null)}
              style={({ pressed }) => [styles.menuItem, pressed ? styles.pressed : null]}>
              <AppText variant="body" weight="semibold" tone="secondary">
                Cancel
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/*
        The full-screen viewer for a tapped photo attachment — the same
        `MediaViewer` the feed uses, so pinch-zoom and the close affordance
        behave identically everywhere in the app. It renders nothing when
        `visible` is false, so this line is unconditional rather than
        conditionally mounted (a remount would reset its zoom mid-open).
      */}
      <MediaViewer
        media={viewerMedia ?? []}
        index={viewerIndex}
        visible={viewerMedia !== null}
        onClose={() => setViewerMedia(null)}
        onIndexChange={setViewerIndex}
      />
    </ConversationShell>
  );
}

/**
 * One bubble. Incoming on the left, outgoing on the right; the text wraps and
 * the list resizes with the keyboard rather than under it (see the
 * `KeyboardAvoidingView` below). Deleted rows are tombstones, not empty space.
 */
function MessageBubble({
  row,
  editable,
  deleting,
  editing,
  onMenuRequest,
  onOpenMedia,
}: {
  row: Extract<ConversationRow, { kind: 'message' }>;
  editable: boolean;
  deleting: boolean;
  editing: boolean;
  onMenuRequest: () => void;
  onOpenMedia: () => void;
}) {
  const { message, side } = row.entry;
  const outgoing = side === 'outgoing';
  const deleted = isDeleted(message);
  // A tombstone reveals neither its text nor its attachment: the delete stamp
  // wins over anything a stale row still happens to carry.
  const media = !deleted ? message.media : null;
  const text = bubbleText(message);

  const bubble = (
    <View
      style={[
        styles.bubble,
        outgoing ? styles.bubbleOutgoing : styles.bubbleIncoming,
        deleted ? styles.bubbleDeleted : null,
      ]}
      testID={`message-${message.id}`}>
      {media ? <MessageMedia media={media} onOpenImage={onOpenMedia} /> : null}
      {text.length > 0 ? (
        <AppText
          variant="body"
          tone={outgoing && !deleted ? 'onPrimary' : deleted ? 'tertiary' : 'primary'}
          style={styles.bubbleText}>
          {text}
        </AppText>
      ) : null}
      <View style={styles.bubbleMeta}>
        <AppText
          variant="caption"
          tone={outgoing && !deleted ? 'onPrimary' : 'tertiary'}>
          {messageTime(message.created_at)}
        </AppText>
        {/*
          The "Edited" marker is the server's `edited_at`, not a local guess:
          it appears only after `PATCH /messages/{id}` has confirmed, and never
          on a tombstone (the server nulls the body, so there is nothing to
          describe). Announce it rather than just drawing it, so a screen-reader
          user hears the same fact a sighted one reads.
        */}
        {isEdited(message) ? (
          <AppText
            variant="caption"
            tone={outgoing ? 'onPrimary' : 'tertiary'}
            accessibilityLabel="Edited">
            · Edited
          </AppText>
        ) : null}
      </View>
    </View>
  );

  return (
    <View style={[styles.bubbleRow, outgoing ? styles.bubbleRowOutgoing : styles.bubbleRowIncoming]}>
      {/*
        One long-press opens one menu that lists every action the caller may
        take — Copy on any live bubble, plus the sender-only Edit and Delete
        where they apply — rather than long-press meaning one fixed thing.
        Every bubble with a body is pressable (reading somebody else's
        message and copying it is not privileged); a tombstone has nothing to
        copy and no actions, so it stays a plain bubble.
      */}
      {!deleted ? (
        <Pressable
          onLongPress={onMenuRequest}
          delayLongPress={350}
          accessibilityRole="button"
          accessibilityLabel="Message options"
          accessibilityHint={
            editable
              ? 'Press and hold to copy, edit or delete this message'
              : 'Press and hold to copy this message'
          }
          style={({ pressed }) => [pressed ? styles.pressed : null]}>
          {bubble}
          {deleting || editing ? (
            <View style={styles.bubbleBusy}>
              <ActivityIndicator size="small" color={colors.colorPrimary} />
            </View>
          ) : null}
        </Pressable>
      ) : (
        bubble
      )}
    </View>
  );
}

/**
 * A message's attachment, rendered inside the bubble.
 *
 * Two kinds, two renderers — they are not interchangeable:
 *
 *  - **Photo** → `expo-image` with the authenticated source (the media route
 *    has no unsigned variant, exactly like a post image), capped so one picture
 *    cannot take over the thread, and tap → full-screen `MediaViewer`.
 *  - **Video** → `expo-video`, mounted only once the bytes are local. The
 *    player source takes no headers (see `loadPlayableVideoUri`), so the file
 *    is downloaded first, exactly like the story viewer's video layer. It does
 *    not autoplay with sound: the inline player shows its own controls, and the
 *    first frame is the honest poster.
 *
 * The server derives width/height for images and leaves them null for video
 * (this build does not decode video), so video gets a fixed 16:9 box and images
 * size from their own aspect ratio — never a stretched or cropped picture.
 */
function MessageMedia({
  media,
  onOpenImage,
}: {
  media: MessageAttachment;
  onOpenImage: () => void;
}) {
  /**
   * Re-render when the session token reaches the media cache.
   *
   * The same load-bearing subscription `PostMedia` carries: the source is built
   * during render, but the bearer token is mirrored into the media cache
   * asynchronously — without this, the first render's headerless source would
   * never be rebuilt and the photo would sit blank forever while the same
   * session fetched those bytes fine by hand.
   */
  useSyncExternalStore(subscribeMediaAuth, getMediaAuthVersion, getMediaAuthVersion);

  if (media.kind === 'video') {
    return <MessageVideo servedAt={media.served_at} />;
  }

  const width = Math.min(media.width ?? 240, 240);
  const height = media.width && media.height ? Math.round((media.height / media.width) * width) : 240;

  return (
    <Pressable
      onPress={onOpenImage}
      accessibilityRole="imagebutton"
      accessibilityLabel="Open photo full screen"
      accessibilityHint="Shows the photo at full size"
      style={({ pressed }) => [styles.mediaImageWrap, pressed ? styles.pressed : null]}
      testID={`message-media-${media.id}`}>
      <Image
        source={authenticatedImageSource(absoluteMediaUri(media.served_at))}
        // Clamped to the bubble's content width: the computed box is a cap,
        // not a floor — a 320px-wide phone must not overflow the bubble.
        style={{ width, height, maxWidth: '100%' }}
        contentFit="cover"
        transition={120}
        testID={`message-image-${media.id}`}
      />
    </Pressable>
  );
}

/**
 * A video attachment: download, then play inline.
 *
 * The same lifecycle as `StoryVideoLayer` — a `phase` fed by the download
 * promise, the surface mounted only once real bytes exist (the `useVideoPlayer`
 * hook requires a source), and a failed download that says so and offers a
 * retry rather than a blank rectangle that reads as a broken message.
 */
function MessageVideo({ servedAt }: { servedAt: string }) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [playable, setPlayable] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const completion = { finished: false };
    loadPlayableVideoUri(servedAt)
      .then((local) => {
        if (completion.finished) return;
        setPlayable(local);
        setPhase('ready');
      })
      .catch(() => {
        if (completion.finished) return;
        setPhase('failed');
      });
    return () => {
      completion.finished = true;
    };
  }, [servedAt, attempt]);

  if (phase === 'failed') {
    return (
      <Pressable
        onPress={() => {
          // Flip back to loading *and* bump the attempt: the retry must look
          // like a retry (spinner, not a stale failure) while the fetch runs.
          setPhase('loading');
          setAttempt((current) => current + 1);
        }}
        accessibilityRole="button"
        accessibilityLabel="Retry loading this video"
        style={({ pressed }) => [styles.videoBox, styles.videoNotice, pressed ? styles.pressed : null]}
        testID="message-video-failed">
        <AppIcon name={{ ios: 'exclamationmark.triangle', android: 'warning' }} size={20} />
        <AppText variant="caption" tone="secondary">
          This video could not be loaded. Tap to retry.
        </AppText>
      </Pressable>
    );
  }

  if (phase !== 'ready' || !playable) {
    return (
      <View style={[styles.videoBox, styles.videoNotice]} testID="message-video-loading">
        <ActivityIndicator size="small" color={colors.colorTextSecondary} />
        <AppText variant="caption" tone="secondary">
          Loading video…
        </AppText>
      </View>
    );
  }

  return (
    <MessageVideoSurface
      // Keyed on the resolved source: swapping it unmounts the old player
      // *before* the new one mounts, so exactly one player ever exists.
      key={playable}
      playable={playable}
    />
  );
}

/** The `expo-video` player, mounted only once the bytes are local. */
function MessageVideoSurface({ playable }: { playable: string }) {
  const player = useVideoPlayer({ uri: playable }, (created) => {
    created.loop = true;
  });

  return (
    <VideoView
      player={player}
      style={styles.videoBox}
      contentFit="contain"
      accessibilityLabel="Video message"
      testID="message-video"
    />
  );
}

function messageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Deleting one of the caller's own messages.
 *
 * The dialog closes only on a server confirmation, and the history is refetched
 * so the row comes back as the server's tombstone rather than as a locally
 * assumed deletion. A 404 (somebody else's message) or a network failure keeps
 * the dialog open with the server's message, so a failed delete is never
 * mistaken for a successful one.
 */
function useDeleteMessage(onConfirmed: () => void) {
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const remove = async (message: ThreadMessage) => {
    setDeletingId(message.id);
    setDeleteError(null);
    try {
      await deleteMessage(message.id);
      onConfirmed();
    } catch (error: unknown) {
      setDeleteError(
        error instanceof ApiError ? error.message : 'The message could not be deleted.',
      );
      throw error;
    } finally {
      setDeletingId(null);
    }
  };

  return {
    busy: deletingId !== null,
    deletingId,
    error: deleteError,
    dismissError: () => setDeleteError(null),
    remove,
  };
}

/**
 * Editing one of the caller's own messages.
 *
 * The promise **rejects** on failure, exactly like `useDeleteMessage`, so the
 * caller can decide what to do with the draft. The composer is the only caller
 * and it keeps the text on rejection — an edit that the server refused must not
 * silently eat a half-written message.
 *
 * A confirmed edit does not edit the bubble in place. It invalidates the thread
 * so the row is re-rendered from the server's canonical answer, which is the
 * only thing that can carry a trustworthy `edited_at`. That is also what makes
 * the marker honest: it is drawn from a server field, not from the tap.
 */
function useEditMessage(onConfirmed: () => void) {
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const save = async (message: ThreadMessage, text: string) => {
    setSavingId(message.id);
    setEditError(null);
    try {
      await editMessage(message.id, { body: text.trim() });
      onConfirmed();
    } catch (error: unknown) {
      setEditError(
        error instanceof ApiError ? error.message : 'The message could not be edited.',
      );
      throw error;
    } finally {
      setSavingId(null);
    }
  };

  return {
    busy: savingId !== null,
    savingId,
    error: editError,
    dismissError: () => setEditError(null),
    save,
  };
}

/**
 * The send half of the screen. The draft is *this component's* state — not the
 * screen's, not the cache's — so a refetch or a remount of the list can never
 * eat a half-typed message. Only a confirmed send clears it; a failure leaves
 * the text exactly where it was, with a persistent banner and a retry that
 * sends the *same* attempt (same idempotency key) rather than minting a second.
 */
function useSendMessage(conversationId: string | null, onConfirmed: () => void) {
  const [attemptKey, setAttemptKey] = useState<string>(() => newClientMessageId());
  const [sendError, setSendError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (input: { text: string; mediaId: string | null }) => {
      if (!conversationId) throw new Error('No conversation.');
      return sendMessage(conversationId, {
        // A media-only message sends a null body, never an empty string: the
        // server's validator refuses a present-but-blank body with 422, and
        // "photo, no caption" is a legitimate message shape.
        body: input.text.trim().length > 0 ? input.text.trim() : null,
        media_id: input.mediaId,
        client_message_id: attemptKey,
      });
    },
    onSuccess: () => {
      // A new attempt needs a new key; the old one has served its purpose and
      // must never be reused, or two different messages could collapse into one.
      setAttemptKey(newClientMessageId());
      setSendError(null);
      onConfirmed();
    },
    onError: (error: unknown) => {
      setSendError(
        error instanceof ApiError ? error.message : 'Your message could not be sent. Try again.',
      );
    },
  });

  return {
    sending: mutation.isPending,
    error: sendError,
    send: (text: string, mediaId: string | null = null) => {
      if (!conversationId || mutation.isPending) return;
      // Text and an attachment are each sufficient content on their own — the
      // same rule `canSend` gates on before the tap ever reaches here.
      if (text.trim().length === 0 && mediaId === null) return;
      mutation.mutate({ text, mediaId });
    },
    dismissError: () => setSendError(null),
  };
}

function Composer({
  disabled,
  sending,
  error,
  onSend,
  onDismissError,
  editing,
  saving,
  editError,
  onSaveEdit,
  onCancelEdit,
  onDismissEditError,
}: {
  disabled: boolean;
  sending: boolean;
  error: string | null;
  onSend: (text: string, mediaId: string | null) => void;
  onDismissError: () => void;
  /** The message being edited, or null when the composer is in send mode. */
  editing: ThreadMessage | null;
  saving: boolean;
  editError: string | null;
  onSaveEdit: (message: ThreadMessage, text: string) => void;
  onCancelEdit: () => void;
  onDismissEditError: () => void;
}) {
  const insets = useSafeAreaInsets();
  // True while the keyboard covers the bottom of the screen; flips in the same
  // frames the shell's KeyboardAvoidingView lift does (same native events).
  const keyboardVisible = useKeyboardVisible();

  /*
   * Two independent drafts, deliberately.

   * `draft` is the send draft; `editDraft` is the copy being edited. They never
   * share state, because cancelling an edit must not discard a message the
   * caller had half-typed before they long-pressed a bubble — and starting an
   * edit must not wipe that same half-typed message. Only a *confirmed* send or
   * save clears its own draft; every failure and every cancel preserves both.
   */
  const [draft, setDraft] = useState('');
  const [editDraft, setEditDraft] = useState('');
  // The cursor within whichever field is active, reported by the TextInput's
  // `onSelectionChange`. Kept in a ref — never in state — so every cursor move
  // does not rerender the composer while the reader types. A state update per
  // keystroke/cursor-move fights the Android IME: the rerender hands a
  // controlled `selection` prop back to the native view, which resets the
  // cursor, drops the keystroke, or hides the text behind the keyboard.
  // `pendingSelection` is the one transient exception: right after an emoji is
  // inserted the cursor is placed just past it (see `insertEmoji`), then the
  // next selection/typing event clears it back to uncontrolled.
  const selectionRef = useRef<Selection | null>(null);
  const [pendingSelection, setPendingSelection] = useState<Selection | null>(null);
  // Whether the emoji picker panel is open. Toggled by the composer's emoji
  // button; only offered in send mode (editing a message has no picker).
  const [emojiOpen, setEmojiOpen] = useState(false);

  /*
   * The staged attachment: a picked file, the server's id once its bytes have
   * landed, the live progress of that upload, and the last upload failure.
   *
   * `picked` is keyed to `uploaded.localUri` — the same rule the story
   * composer uses — so picking a *different* file can never send the previous
   * file's id: a stale key simply fails to match and the send gate stays shut
   * until the new file has actually uploaded. Nothing here is optimistic:
   * `mediaId` (the only thing `onSend` can reference) exists solely after the
   * server has answered `POST /media` with a stored row.
   */
  const [picked, setPicked] = useState<PickedMedia | null>(null);
  const [uploaded, setUploaded] = useState<{ localUri: string; id: string } | null>(null);
  const [uploadFraction, setUploadFraction] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Ref, not state, for the same-frame double tap: the second press must be
  // stopped before it can start a second upload of the same bytes.
  const uploadingRef = useRef(false);

  // Seed the edit copy when the target changes — during render, not an effect.
  // React sanctions adjusting state during render for exactly this "reset a
  // value when a prop changes" case (see
  // https://react.dev/learn/you-might-not-need-an-effect); an effect that called
  // setState synchronously cascaded an extra render on every entry. Re-entering
  // edit mode on the same message re-seeds from the server's current text:
  // leaving edit mode clears the remembered target, so the next entry — even on
  // the same message — reads as fresh. Typing inside one edit session never
  // resets, because the target (id + body) is unchanged while you type.
  const [seededTarget, setSeededTarget] = useState<{
    id: string;
    body: string | null;
  } | null>(null);
  const editTarget = editing ? { id: editing.id, body: editing.body ?? null } : null;
  if (editTarget) {
    if (editTarget.id !== seededTarget?.id || editTarget.body !== seededTarget?.body) {
      setSeededTarget(editTarget);
      setEditDraft(editTarget.body ?? '');
    }
  } else if (seededTarget !== null) {
    setSeededTarget(null);
  }

  const inEditMode = editing !== null;

  // Insert an emoji into whichever draft is active, at the cursor the input last
  // reported. Defined here (after `inEditMode`) rather than with the other state
  // so it reads the final value. The cursor ref advances past the inserted
  // glyph, so a run of taps lands in order; `pendingSelection` hands that one
  // cursor position to the native view, then the next selection/typing event
  // clears it back to uncontrolled so typing never fights a controlled prop.
  const insertEmoji = (emoji: string) => {
    if (inEditMode) {
      const next = insertEmojiAtSelection(editDraft, selectionRef.current, emoji);
      selectionRef.current = next.selection;
      setEditDraft(next.text);
      setPendingSelection(next.selection);
    } else {
      const next = insertEmojiAtSelection(draft, selectionRef.current, emoji);
      selectionRef.current = next.selection;
      setDraft(next.text);
      setPendingSelection(next.selection);
    }
  };

  /**
   * Upload the staged file, for real, with byte progress.
   *
   * Guarded by the ref (same-frame double tap). The result is keyed to the
   * local uri it came from, so a slow response can never attach a removed or
   * replaced file's id.
   */
  const uploadPicked = async (media: PickedMedia) => {
    if (uploadingRef.current) return;
    uploadingRef.current = true;
    setUploadError(null);
    setUploadFraction(0);
    try {
      // The same `uploadPickedMedia` the post composer and story composer use:
      // one request, real progress, and the server's magic-byte sniff as the
      // authority on what the file really is.
      const result = await uploadPickedMedia(media, (progress) => {
        setUploadFraction(progress.fraction);
      });
      setUploaded({ localUri: media.localUri, id: result.id });
    } catch (error: unknown) {
      setUploadError(
        error instanceof ApiError
          ? error.message
          : 'That file could not be uploaded. Try again, or remove it.',
      );
    } finally {
      setUploadFraction(null);
      uploadingRef.current = false;
    }
  };

  /**
   * The attach button: ask for photo access, open the library for one photo or
   * video, then upload it immediately.
   *
   * Uploading right away (rather than on Send) is what makes the `media_id` in
   * the send payload honest: the id exists because the server has the bytes,
   * not because the user is about to send them. A denial sets a persistent
   * notice; a cancel leaves the composer exactly as it was — changing one's
   * mind is not a failure.
   */
  const pickAttachment = async () => {
    if (inEditMode || uploadingRef.current) return;
    setUploadError(null);

    const permission = await requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setUploadError(
        'Photo access is off. Allow access in your device settings to attach a photo or video.',
      );
      return;
    }

    // One file, both kinds: a message carries at most one attachment, so the
    // picker is single-select and the mediaTypes list is what lets the OS
    // gallery offer videos at all (images-only is the default).
    const result = await launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      allowsMultipleSelection: false,
      selectionLimit: 1,
      quality: 1,
    });
    if (result.canceled) return;

    const asset = result.assets[0];
    if (!asset) return;

    const media: PickedMedia = {
      localUri: asset.uri,
      // The picker records the choice; the server decides what the bytes are
      // (it sniffs magic bytes and rejects a mismatch on upload).
      kind: asset.mimeType?.startsWith('video/') === true ? 'video' : 'image',
      fileName: asset.fileName ?? (asset.mimeType?.startsWith('video/') === true ? 'Video' : 'Image'),
      // `fileSize` is optional and often absent; the real size is read from the
      // file rather than treating "unknown" as "empty".
      sizeBytes: asset.fileSize ?? measureLocalFileSize(asset.uri),
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType ?? '',
    };

    // A new pick replaces any previous staged file outright: the send gate is
    // keyed to the local uri, so a stale upload can never satisfy it.
    setPicked(media);
    setUploaded(null);
    void uploadPicked(media);
  };

  /** Drop the staged attachment entirely — the server keeps any uploaded bytes. */
  const removeAttachment = () => {
    if (uploadingRef.current) return;
    setPicked(null);
    setUploaded(null);
    setUploadFraction(null);
    setUploadError(null);
  };

  // The one attachment `onSend` may reference: uploaded, and uploaded *from the
  // file still on screen* — never a previous pick's id.
  const mediaId = picked && uploaded && uploaded.localUri === picked.localUri ? uploaded.id : null;
  // A picked file the server does not have yet (still uploading, or a failed
  // upload still staged): the send gate stays shut until the file has actually
  // landed or been removed, so a message can never reference bytes that are
  // not stored.
  const attachmentPending = picked !== null && mediaId === null;
  // An attachment alone is sendable content; a caption alone is too. Both at
  // once is the "text, attachment, or both" rule the server also enforces.
  const sendable =
    canSend(draft, sending || attachmentPending, mediaId !== null) && !disabled && !inEditMode;
  const savable = canSend(editDraft, saving);

  const submitSend = () => {
    if (!sendable) return;
    onSend(draft, mediaId);
    // The draft clears only if the send left the wire — i.e. never on a
    // failure the hook reports. `sending` flips true synchronously on mutate,
    // so clearing here is safe: the hook, not the composer, owns error state.
    // The staged attachment clears with it, matching the text exactly: the
    // bytes are already on the server either way, and a failed send leaves
    // the persistent banner the hook owns (re-picking the same file simply
    // re-uploads it — the honest path, since there is no orphan sweep).
    setDraft('');
    setPicked(null);
    setUploaded(null);
    setUploadFraction(null);
    setUploadError(null);
    // A sent message empties the field, so the remembered cursor and the open
    // picker no longer apply; reset both so the next message starts clean.
    selectionRef.current = null;
    setPendingSelection(null);
    setEmojiOpen(false);
  };

  const submitEdit = () => {
    if (!editing || !savable) return;
    onSaveEdit(editing, editDraft);
  };

  const banner = inEditMode ? editError : error;
  const dismissBanner = inEditMode ? onDismissEditError : onDismissError;

  return (
    <View
      style={[
        styles.composer,
        // The bottom tab bar floats over the bottom of every tab scene, so with
        // the keyboard closed the composer clears exactly the bar's own height
        // formula — the same `layout.bottomNavHeight + insets.bottom`
        // `CandidateTabBar` renders with — plus the composer's own padding. The
        // input row therefore lands directly above the bar and the gesture
        // strip on every screen size, never underneath either.
        //
        // While the keyboard is open, that clearance would be a tab-bar-sized
        // BLANK GAP: on Android 15+ edge-to-edge the keyboard overlays the
        // window (adjustResize no longer resizes it) and the bar stays behind
        // the keyboard — nothing occupies the space being cleared. The shell's
        // KeyboardAvoidingView `padding` has already lifted the whole composer
        // to the keyboard's top edge, so the row keeps only its own spacing
        // until the keyboard is fully gone.
          keyboardVisible
            ? { paddingBottom: spacing.md }
            : { paddingBottom: layout.bottomNavHeight + insets.bottom + spacing.md },
      ]}>
      {/*
        Edit mode is stated in words above the input, not only by a changed
        button: a caller who long-pressed a bubble three rows up needs to see
        which message they are about to overwrite, and a screen-reader user gets
        the same fact announced.
      */}
      {inEditMode ? (
        <View style={styles.editBar}>
          <AppText variant="caption" tone="accent" accessibilityLiveRegion="polite">
            Editing message
          </AppText>
          <Pressable
            onPress={onCancelEdit}
            disabled={saving}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Cancel editing"
            accessibilityHint="Discards your changes and keeps the original message">
            <AppText variant="caption" weight="semibold" tone="secondary">
              Cancel
            </AppText>
          </Pressable>
        </View>
      ) : null}

      {banner ? (
        <AppText
          variant="caption"
          tone="danger"
          accessibilityLiveRegion="polite"
          accessibilityRole="button"
          accessibilityLabel={`${banner} Tap to dismiss.`}
          onPress={dismissBanner}
          style={styles.composerError}>
          {banner}
        </AppText>
      ) : null}

      {/*
        The staged attachment: a preview of the exact file that will send, its
        live upload progress, and the failure notice if the upload did not
        land. The notice is persistent (not a toast) and the whole strip is
        tappable to retry — the project's error rule — and remove is the way
        out once the upload settles (it is held during the flight, because
        that is the one moment its result would race the removal). Nothing
        here claims success before the server has the bytes: while
        `uploadFraction` is non-null the strip says "Uploading…" and the send
        gate is shut.
      */}
      {picked ? (
        <>
          <View style={styles.attachmentStrip} testID="composer-attachment">
            {picked.kind === 'image' ? (
              <Image
                source={{ uri: picked.localUri }}
                style={styles.attachmentThumb}
                contentFit="cover"
                accessibilityLabel="Attachment preview"
              />
            ) : (
              <View style={styles.attachmentThumb} accessibilityLabel="Video attachment">
                <AppIcon name={{ ios: 'video', android: 'videocam' }} size={20} />
              </View>
            )}
            <View style={styles.attachmentMeta}>
              <AppText variant="caption" weight="semibold" numberOfLines={1}>
                {picked.kind === 'video' ? 'Video' : 'Photo'}
              </AppText>
              {uploadFraction !== null ? (
                <>
                  <AppText variant="caption" tone="secondary" accessibilityLiveRegion="polite">
                    {`Uploading… ${Math.round(uploadFraction * 100)}%`}
                  </AppText>
                  <View style={styles.attachmentTrack} accessibilityRole="progressbar">
                    <View
                      style={[
                        styles.attachmentFill,
                        { width: `${Math.round(uploadFraction * 100)}%` },
                      ]}
                    />
                  </View>
                </>
              ) : uploadError ? null : (
                // Upload succeeded the moment this branch is reachable (the pick
                // and its upload start in the same tick), so the only honest
                // line here is readiness; the error line speaks for itself.
                <AppText variant="caption" tone="secondary" numberOfLines={1}>
                  {mediaId !== null ? 'Ready to send' : 'Preparing…'}
                </AppText>
              )}
            </View>
            <Pressable
              onPress={removeAttachment}
              disabled={uploadFraction !== null}
              hitSlop={layout.hitSlop}
              accessibilityRole="button"
              accessibilityLabel="Remove attachment"
              accessibilityHint="Removes the photo or video from this message"
              testID="composer-attachment-remove"
              style={({ pressed }) => [
                styles.attachmentRemove,
                uploadFraction !== null ? styles.attachmentRemoveDisabled : null,
                pressed ? styles.pressed : null,
              ]}>
              <AppIcon name={{ ios: 'xmark', android: 'close' }} size={18} />
            </Pressable>
          </View>
          {/*
            The failure line sits below the strip, full width: a server message
            is long, and squeezing it into the row would wrap the strip into a
            tower. Persistent (not a toast) and tappable to retry — the
            project's error rule.
          */}
          {uploadError ? (
            <AppText
              variant="caption"
              tone="danger"
              accessibilityLiveRegion="polite"
              accessibilityRole="button"
              accessibilityLabel={`${uploadError} Tap to retry the upload.`}
              onPress={() => void uploadPicked(picked)}
              style={styles.composerError}>
              {`${uploadError} Tap to retry.`}
            </AppText>
          ) : null}
        </>
      ) : null}

      <View style={styles.composerRow}>
        {/*
          The attach button — photo or video, one per message. Send mode only:
          an edit rewrites the text of an existing message and the server's
          PATCH takes only `{ body }`, so offering an attachment here would
          promise a change that can never be saved.
        */}
        {!inEditMode ? (
          <Pressable
            onPress={() => void pickAttachment()}
            disabled={disabled || uploadFraction !== null}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel="Attach a photo or video"
            accessibilityHint="Opens your photo library. The file uploads before you can send it."
            accessibilityState={{ disabled: disabled || uploadFraction !== null }}
            testID="composer-attach"
            style={({ pressed }) => [
              styles.attachButton,
              disabled || uploadFraction !== null ? styles.attachButtonDisabled : null,
              pressed ? styles.pressed : null,
            ]}>
            <AppIcon
              name={{ ios: 'paperclip', android: 'attach_file' }}
              size={22}
              color={colors.colorTextSecondary}
            />
          </Pressable>
        ) : null}
        <TextInput
          value={inEditMode ? editDraft : draft}
          onChangeText={(text) => {
            // New typing takes over cursor ownership: the reader's keystroke is
            // authoritative, so any pending programmatic cursor is dropped and
            // the field returns to uncontrolled — otherwise the next render
            // would hand a stale `selection` back to the IME and the keystroke
            // could vanish or the cursor jump.
            if (pendingSelection) setPendingSelection(null);
            if (inEditMode) setEditDraft(text);
            else setDraft(text);
          }}
          onSelectionChange={(event) => {
            // Track the cursor without rerendering, and release any pending
            // programmatic cursor once the native view reports its own — the
            // handoff that returns the field to uncontrolled after an emoji.
            selectionRef.current = event.nativeEvent.selection;
            if (pendingSelection) setPendingSelection(null);
          }}
          // Only controlled for the single render after an emoji insert, while
          // the cursor must land just past the glyph. Uncontrolled the rest of
          // the time so the IME owns the cursor and typing stays visible.
          selection={pendingSelection ?? undefined}
          placeholder={inEditMode ? 'Edit message…' : 'Message…'}
          placeholderTextColor={colors.colorTextTertiary}
          multiline
          maxLength={MESSAGE_BODY_MAX}
          returnKeyType="send"
          onSubmitEditing={inEditMode ? submitEdit : submitSend}
          editable={inEditMode ? !saving : !disabled}
          accessibilityLabel={inEditMode ? 'Edit message' : 'Message'}
          accessibilityHint={
            inEditMode
              ? 'Type the new text. Save is enabled once there is text.'
              : 'Type a message. Send is enabled once there is text.'
          }
          style={styles.composerInput}
          testID={inEditMode ? 'edit-input' : 'composer-input'}
        />
        {/*
          The emoji toggle. Only in send mode — editing a message has no picker,
          and a decorative emoji button on an edit row would imply one. Pressing
          it opens the panel below the row (never the OS keyboard's own emoji
          drawer, which this app does not own). The button reflects the open
          state so a second tap closes it.
        */}
        {!inEditMode ? (
          <Pressable
            onPress={() => setEmojiOpen((open) => !open)}
            hitSlop={layout.hitSlop}
            accessibilityRole="button"
            accessibilityLabel={emojiOpen ? 'Close emoji picker' : 'Open emoji picker'}
            accessibilityHint="Inserts an emoji at the cursor"
            accessibilityState={{ expanded: emojiOpen }}
            testID="composer-emoji"
            style={({ pressed }) => [
              styles.emojiButton,
              emojiOpen ? styles.emojiButtonActive : null,
              pressed ? styles.pressed : null,
            ]}>
            <AppText variant="body" accessibilityElementsHidden importantForAccessibility="no">
              🙂
            </AppText>
          </Pressable>
        ) : null}
        <Pressable
          onPress={inEditMode ? submitEdit : submitSend}
          disabled={inEditMode ? !savable : !sendable}
          hitSlop={layout.hitSlop}
          accessibilityRole="button"
          accessibilityLabel={inEditMode ? 'Save changes' : 'Send message'}
          accessibilityHint={
            inEditMode
              ? 'Saves the edit once the server confirms it'
              : 'Sends the message once the server confirms it appears above'
          }
          accessibilityState={{ disabled: inEditMode ? !savable : !sendable, busy: saving || sending }}
          testID={inEditMode ? 'edit-save' : 'composer-send'}
          style={({ pressed }) => [
            styles.sendButton,
            (inEditMode ? savable : sendable)
              ? styles.sendButtonEnabled
              : styles.sendButtonDisabled,
            pressed && (inEditMode ? savable : sendable) ? styles.pressed : null,
          ]}>
          {saving || sending ? (
            <ActivityIndicator size="small" color={colors.colorOnPrimary} />
          ) : (
            <AppIcon
              name={{ ios: inEditMode ? 'checkmark' : 'paperplane.fill', android: inEditMode ? 'check' : 'send' }}
              size={20}
              color={colors.colorOnPrimary}
            />
          )}
        </Pressable>
      </View>

      {/*
        The emoji panel. A bounded, scrollable grid of the curated set, grouped
        and labelled, each cell a real touch target. Tapping one inserts it into
        the draft at the cursor and leaves the panel open so several can be added
        in a row; the toggle button or sending closes it. It renders *inside* the
        composer (below the input row) so it sits above the keyboard-aware shell
        rather than floating over the thread.
      */}
      {emojiOpen && !inEditMode ? (
        <View style={styles.emojiPanel} testID="emoji-panel">
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.emojiScroll}>
            {EMOJI_GROUPS.map((group) => (
              <View key={group.label} style={styles.emojiGroup}>
                <AppText variant="caption" uppercase tone="tertiary" style={styles.emojiGroupLabel}>
                  {group.label}
                </AppText>
                <View style={styles.emojiGrid}>
                  {group.emoji.map((emoji) => (
                    <Pressable
                      key={emoji}
                      onPress={() => insertEmoji(emoji)}
                      accessibilityRole="button"
                      accessibilityLabel={`Insert ${emoji}`}
                      style={({ pressed }) => [
                        styles.emojiCell,
                        pressed ? styles.emojiCellPressed : null,
                      ]}>
                      <AppText variant="body">{emoji}</AppText>
                    </Pressable>
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The screen's chrome: a keyboard-avoiding column so the composer is never
 * covered by the keyboard.
 *
 * iOS has no window resize — the keyboard overlays the window — so
 * `behavior="padding"` lifts the whole column (thread + composer) to the
 * keyboard's top edge and pads back to zero on dismiss: no stale offset, no
 * jump.
 *
 * Android keeps `windowSoftInputMode="adjustResize"`: the window shrinks when
 * the keyboard shows and the composer, at the bottom of the column, rides up
 * to sit just above the keyboard. The shell therefore does **not** pad on
 * Android (`behavior` undefined) — padding there would lift the row a second
 * time and leave a gap between the input and the keyboard. While the keyboard
 * is closed the composer still clears the floating tab bar through its own
 * `paddingBottom` (the tab bar's height formula plus the composer's spacing);
 * `useKeyboardVisible` drops that clearance to `spacing.md` while the keyboard
 * is open so nothing sits between the row and the keyboard.
 *
 * Both the thread and the composer live inside this one wrapper, so they move
 * together.
 *
 * The top safe-area inset is applied **here**, once, so every exit of this
 * screen (the conversation itself and the missing-id notice below) starts
 * below the Android status bar: `paddingTop: insets.top` is the real inset,
 * never a fixed offset, and the status bar is never hidden to disguise an
 * overlap. The bottom inset deliberately does **not** live here: only the
 * composer must clear the floating tab bar as well as the gesture strip, and
 * padding the shell on top of that would double it.
 */
function ConversationShell({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={[styles.shell, { paddingTop: insets.top }]}>
      {children}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  shell: {
    backgroundColor: colors.colorBgPage,
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: colors.colorBorder,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  headerIdentity: {
    alignItems: 'center',
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: layout.touchTargetPrimary,
  },
  headerText: {
    flex: 1,
    gap: 0,
  },
  headerCalls: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
  },
  callButton: {
    alignItems: 'center',
    borderRadius: 999,
    height: layout.touchTargetPrimary,
    justifyContent: 'center',
    width: layout.touchTargetPrimary,
  },
  callButtonDisabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.8,
  },
  body: {
    flex: 1,
    gap: spacing.md,
    padding: spacing.pagePadding,
  },
  list: {
    backgroundColor: colors.colorBgPage,
    flex: 1,
  },
  listContent: {
    gap: spacing.xs,
    paddingHorizontal: spacing.pagePadding,
    paddingVertical: spacing.md,
  },
  olderWrap: {
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  olderButton: {
    minHeight: layout.touchTargetSecondary,
    textAlignVertical: 'center',
  },
  separator: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    marginVertical: spacing.sm,
  },
  separatorLine: {
    backgroundColor: colors.colorBorder,
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  separatorText: {
    textAlign: 'center',
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowIncoming: {
    justifyContent: 'flex-start',
  },
  bubbleRowOutgoing: {
    justifyContent: 'flex-end',
  },
  bubble: {
    borderRadius: radius.card,
    maxWidth: '80%',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  bubbleIncoming: {
    backgroundColor: colors.colorBgSurface,
    borderBottomLeftRadius: 4,
    borderColor: colors.colorBorder,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleOutgoing: {
    backgroundColor: colors.colorPrimary,
    borderBottomRightRadius: 4,
  },
  bubbleDeleted: {
    backgroundColor: colors.colorBgMuted,
    borderColor: colors.colorBorder,
    borderWidth: StyleSheet.hairlineWidth,
  },
  bubbleText: {
    flexShrink: 1,
  },
  // The photo/video inside a bubble. The wrap adds the bubble's inner padding
  // rhythm around the raw image; the image itself is sized inline from the
  // attachment's own aspect ratio (capped), never stretched.
  mediaImageWrap: {
    borderRadius: radius.control,
    marginBottom: spacing.xs,
    overflow: 'hidden',
  },
  // A video box: fixed 16:9, because the server does not decode video and so
  // cannot report a size — an honest default beats a zero-height player.
  // Clamped to the bubble's content width so a 320px-wide phone never overflows.
  videoBox: {
    aspectRatio: 16 / 9,
    borderRadius: radius.control,
    marginBottom: spacing.xs,
    maxWidth: '100%',
    width: 240,
  },
  videoNotice: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    gap: spacing.xs,
    justifyContent: 'center',
    paddingHorizontal: spacing.sm,
  },
  bubbleTime: {
    marginTop: 2,
    textAlign: 'right',
  },
  bubbleMeta: {
    alignItems: 'baseline',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'flex-end',
    marginTop: 2,
  },
  // The deleting spinner, centred over the row being removed.
  bubbleBusy: {
    alignItems: 'center',
    backgroundColor: colors.colorOverlay,
    borderRadius: radius.card,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  confirmScrim: {
    alignItems: 'center',
    backgroundColor: colors.colorOverlay,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    padding: spacing.lg,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  confirmCard: {
    backgroundColor: colors.colorBgSurface,
    borderRadius: radius.card,
    gap: spacing.sm,
    padding: spacing.lg,
    width: '100%',
  },
  confirmBody: {
    marginBottom: spacing.xs,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  confirmButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: layout.touchTargetSecondary,
    paddingHorizontal: spacing.lg,
  },
  confirmCancel: {
    borderRadius: radius.control,
  },
  // A dimmed, non-pressable affordance. Applied only while a delete is in
  // flight, so the same dialog cannot be submitted twice.
  confirmDisabled: {
    opacity: 0.45,
  },
  // Long-press action sheet: a bottom-anchored card over a dimmed scrim, so the
  // list stays visible behind it and the target bubble is still in view.
  menuScrim: {
    bottom: 0,
    justifyContent: 'flex-end',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  menuScrimFill: {
    backgroundColor: colors.colorOverlay,
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  menuCard: {
    backgroundColor: colors.colorBgSurface,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  menuTitle: {
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  menuItem: {
    alignItems: 'flex-start',
    justifyContent: 'center',
    minHeight: layout.touchTargetPrimary,
    paddingHorizontal: spacing.lg,
  },
  menuItemDanger: {
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  /** The transient "Copied to clipboard" confirmation above the composer. */
  copyNotice: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  composer: {
    backgroundColor: colors.colorBgSurface,
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.xs,
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  composerError: {
    paddingHorizontal: spacing.xs,
  },
  // The attach button: same 48px circular footprint as the emoji toggle so the
  // composer row keeps one rhythm, and a real touch target like every other
  // primary control.
  attachButton: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderRadius: 24,
    borderColor: colors.colorBorder,
    borderWidth: StyleSheet.hairlineWidth,
    height: layout.touchTargetPrimary,
    justifyContent: 'center',
    width: layout.touchTargetPrimary,
  },
  attachButtonDisabled: {
    opacity: 0.5,
  },
  // The staged-attachment strip above the input row: a thumbnail, the label and
  // progress, and the remove button — so the caller sees exactly the file that
  // will send, not a promise of one.
  attachmentStrip: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.control,
    borderColor: colors.colorBorder,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.sm,
  },
  attachmentThumb: {
    alignItems: 'center',
    backgroundColor: colors.colorBgSurface,
    borderRadius: radius.control,
    height: 44,
    justifyContent: 'center',
    overflow: 'hidden',
    width: 44,
  },
  attachmentMeta: {
    flex: 1,
    gap: 2,
  },
  attachmentTrack: {
    backgroundColor: colors.colorBorder,
    borderRadius: 2,
    height: 4,
    overflow: 'hidden',
    width: '100%',
  },
  attachmentFill: {
    backgroundColor: colors.colorPrimary,
    height: 4,
  },
  attachmentRemove: {
    alignItems: 'center',
    height: layout.touchTargetSecondary,
    justifyContent: 'center',
    width: layout.touchTargetSecondary,
  },
  attachmentRemoveDisabled: {
    opacity: 0.5,
  },
  /**
   * The "Editing message … Cancel" strip above the input in edit mode. It is a
   * strip, not just a changed send button: a caller who long-pressed a bubble
   * three rows up needs to see *which* message they are about to overwrite, and
   * a screen-reader user gets the same fact via the live region.
   */
  editBar: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  composerRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: spacing.sm,
    minWidth: 0,
  },
  composerInput: {
    backgroundColor: colors.colorBgMuted,
    borderRadius: radius.control,
    color: colors.colorTextPrimary,
    flex: 1,
    flexShrink: 1,
    fontSize: typography.fontSizeBody,
    lineHeight: typography.lineHeightBody,
    maxHeight: 120,
    minHeight: layout.inputHeight,
    minWidth: 0,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlignVertical: 'top',
  },
  sendButton: {
    alignItems: 'center',
    borderRadius: 24,
    flexShrink: 0,
    height: layout.touchTargetPrimary,
    justifyContent: 'center',
    width: layout.touchTargetPrimary,
  },
  sendButtonEnabled: {
    backgroundColor: colors.colorPrimary,
  },
  sendButtonDisabled: {
    backgroundColor: colors.colorTextDisabled,
  },
  // The emoji toggle beside the send button. A circular surface matching the
  // send button's footprint so the composer row keeps a consistent rhythm, and a
  // 48px target like every other primary control.
  emojiButton: {
    alignItems: 'center',
    backgroundColor: colors.colorBgMuted,
    borderRadius: 24,
    borderColor: colors.colorBorder,
    borderWidth: StyleSheet.hairlineWidth,
    height: layout.touchTargetPrimary,
    justifyContent: 'center',
    width: layout.touchTargetPrimary,
  },
  emojiButtonActive: {
    backgroundColor: colors.colorPrimarySubtle,
    borderColor: colors.colorPrimary,
  },
  // The picker panel: a bounded strip above the composer's bottom padding so it
  // never grows past a few rows, and the thread and keyboard stay usable.
  emojiPanel: {
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    maxHeight: 180,
    paddingTop: spacing.sm,
  },
  emojiScroll: {
    flexGrow: 0,
  },
  emojiGroup: {
    gap: spacing.xs,
    paddingBottom: spacing.sm,
  },
  emojiGroupLabel: {
    paddingHorizontal: spacing.xs,
  },
  emojiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  emojiCell: {
    alignItems: 'center',
    borderRadius: radius.control,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  emojiCellPressed: {
    backgroundColor: colors.colorBgMuted,
  },
});