/**
 * Candidate Messages â€” the Message section.
 *
 * Three internal tabs live *inside* this screen (All / Unread / Requests) below
 * the search field; the global bottom navigation is untouched. The screen is
 * about **conversations**: the All pane reads the real conversation list from
 * the main backend's `/conversations` router, Unread narrows the same list to
 * threads with a server-reported `unread_count`, and Requests lists the
 * pending **message requests** from the independent message service.
 *
 * **No connection-request surface lives here.** Incoming connection requests are
 * handled through Home â†’ the notification bell â†’ `/notifications`, and the full
 * request surface (including a link into the person's profile) stays in
 * `/connections`. A message request is permission to message â€” a different
 * table, a different service, a different resolution â€” and accepting one here
 * never touches a connection, and vice versa.
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';

import { ApiError } from '@/api/errors';
import { listConversations, type Conversation } from '@/api/messages';
import { useAuth } from '@/auth/AuthContext';
import { AppText } from '@/components/ui/AppText';
import { AppIcon } from '@/components/ui/AppIcon';
import { Avatar } from '@/components/ui/Avatar';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { otherParticipant } from '@/features/conversation/conversationModel';
import { RequestCard } from '@/features/messages/RequestCard';
import { MessageSearchField } from '@/features/messages/MessageSearchField';
import { MessageSectionTabs } from '@/features/messages/MessageSectionTabs';
import {
  conversationPreview,
  filterConversations,
  filterRequests,
  formatRequestTime,
  isConversationUnread,
  type MessageSectionId,
} from '@/features/messages/messageSections';
import { useMessageRequests } from '@/features/messages/useMessageRequests';
import { messagingQueryKeys } from '@/realtime/queryBridge';
import { colors, radius, spacing } from '@/theme/tokens';

export default function CandidateMessagesScreen() {
  const router = useRouter();
  const [active, setActive] = useState<MessageSectionId>('all');
  const [search, setSearch] = useState('');

  const requests = useMessageRequests();

  /*
   * The thread list itself: one `GET /conversations` page, shared by the All
   * and Unread panes and by the tab bar's unread dot. It lives at the screen
   * level rather than inside a pane so switching tabs never refetches and two
   * panes can never disagree about what "unread" means â€” both read the same
   * server `unread_count`.
   */
  const conversations = useQuery({
    queryKey: messagingQueryKeys.conversations,
    queryFn: () => listConversations(),
    // The realtime bridge invalidates this key on a socket event, and the
    // focus refetch corrects it when the reader returns to the Messages tab.
    refetchOnWindowFocus: true,
  });

  const loaded = useMemo(() => conversations.data?.items ?? [], [conversations.data]);
  const unreadThreadCount = useMemo(
    () => loaded.filter((row) => isConversationUnread(row)).length,
    [loaded],
  );

  // Local filters over the rows the user already holds â€” never a claim to
  // search every server-side conversation.
  const visibleConversations = useMemo(
    () => filterConversations(loaded, search),
    [loaded, search],
  );
  const visibleUnread = useMemo(
    () => visibleConversations.filter((row) => isConversationUnread(row)),
    [visibleConversations],
  );

  const visibleRequests = useMemo(
    () => filterRequests(requests.requests, search),
    [requests.requests, search],
  );

  // Every press is a pane switch now: the Connections/Companies destinations
  // left this screen with the connection-request surface, and there is nothing
  // to navigate to from the tab bar itself.
  const handleSelect = (id: MessageSectionId) => setActive(id);

  return (
    <Screen testID="messages-screen">
      <View style={styles.stack}>
        <View style={styles.header}>
          <AppText variant="h1" accessibilityRole="header">
            Messages
          </AppText>
          <View style={styles.headerActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New message"
              accessibilityHint="Opens your connections to start a conversation"
              hitSlop={8}
              onPress={() => router.push('/connections' as never)}
              style={styles.iconButton}>
              <AppIcon name={{ ios: 'square.and.pencil', android: 'edit' }} size={22} />
            </Pressable>
          </View>
        </View>

        <MessageSearchField value={search} onChangeText={setSearch} />

        <MessageSectionTabs
          active={active}
          pendingCount={requests.pendingCount}
          unreadThreadCount={unreadThreadCount}
          onSelect={handleSelect}
        />

        <View style={styles.body}>
          {active === 'all' ? (
            <ConversationsPane
              conversations={visibleConversations}
              search={search}
              isLoading={conversations.isPending}
              errorMessage={conversations.isError ? conversationErrorMessage(conversations.error) : null}
              onRetry={() => void conversations.refetch()}
              emptyTitle="No conversations yet"
              emptyDescription="Connect with somebody and start a conversation â€” it will appear here."
            />
          ) : null}
          {active === 'unread' ? (
            <ConversationsPane
              conversations={visibleUnread}
              search={search}
              isLoading={conversations.isPending}
              errorMessage={conversations.isError ? conversationErrorMessage(conversations.error) : null}
              onRetry={() => void conversations.refetch()}
              emptyTitle="No unread messages"
              emptyDescription="You're all caught up. New messages will show up here."
            />
          ) : null}
          {active === 'requests' ? (
            <RequestsTab view={requests} visible={visibleRequests} />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
  },
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  headerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
    minWidth: 48,
  },
  body: {
    gap: spacing.md,
  },
  list: {
    gap: spacing.md,
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowIdentity: {
    flex: 1,
    gap: 2,
  },
  rowMeta: {
    alignItems: 'flex-end',
    gap: spacing.xs,
  },
  rowPressed: {
    opacity: 0.85,
  },
  unreadBadge: {
    alignItems: 'center',
    backgroundColor: colors.colorPrimary,
    borderRadius: radius.full,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
});

/** The server's own message when the inbox failed, else a generic transport line. */
function conversationErrorMessage(error: unknown): string {
  return error instanceof ApiError
    ? error.message
    : 'The API did not answer. Check your connection and try again.';
}

/**
 * The thread list, shared by the All and Unread panes.
 *
 * Loading, error and empty are all honest: the skeletons are real latency, the
 * error names the server's message with a retry, and each empty state says which
 * pane you are in rather than pretending the account has no threads at all. No
 * fabricated threads, no client-computed unread counts â€” members, previews and
 * `unread_count` come straight from the server.
 */
function ConversationsPane({
  conversations: visible,
  search,
  isLoading,
  errorMessage,
  onRetry,
  emptyTitle,
  emptyDescription,
}: {
  conversations: Conversation[];
  search: string;
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  emptyTitle: string;
  emptyDescription: string;
}) {
  if (isLoading) {
    return (
      <View style={styles.list}>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </View>
    );
  }

  if (errorMessage) {
    return <StatusBanner title="Could not load your conversations" description={errorMessage} onRetry={onRetry} />;
  }

  if (visible.length === 0) {
    return (
      <StatusBanner
        tone="info"
        title={search.trim().length > 0 ? 'No conversations match your search' : emptyTitle}
        description={
          search.trim().length > 0 ? 'Try a different name or word.' : emptyDescription
        }
      />
    );
  }

  return (
    <View style={styles.list} testID="conversations-list">
      {visible.map((conversation) => (
        <ConversationRow key={conversation.id} conversation={conversation} />
      ))}
    </View>
  );
}

/**
 * One thread in the list â€” tapping it opens the one-to-one conversation screen
 * for that conversation id. The name/avatar are the *other* member: the caller
 * is in `members` too, and "you" beside every preview would be noise.
 *
 * Unread is the server's count, shown as a count badge (not just bold text), and
 * the row states it in its accessibility label so a screen reader reads the same
 * fact the badge shows.
 */
function ConversationRow({ conversation }: { conversation: Conversation }) {
  const router = useRouter();
  const { principal } = useAuth();
  // The avatar/name are the *other* member: the caller is in members too,
  // resolved by internal user id so the caller's own photo is never shown.
  const selfUserId = principal?.id ?? null;
  const primary = otherParticipant(conversation.members, selfUserId);
  const preview = conversationPreview(conversation);
  const time = conversation.last_message_at ? formatRequestTime(conversation.last_message_at) : '';
  const unread = conversation.unread_count;

  const open = () => router.push(`/conversation/${conversation.id}` as never);

  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel={`Conversation with ${primary?.name ?? 'a connection'}${
        unread > 0 ? `, ${unread} unread` : ''
      }`}
      accessibilityHint="Opens the conversation"
      testID={`conversation-${conversation.id}`}
      style={({ pressed }) => [pressed ? styles.rowPressed : null]}>
      <Card>
        <View style={styles.rowHeader}>
          <Avatar
            name={primary?.name ?? 'Conversation'}
            src={primary?.avatar_url ?? null}
            size={40}
          />
          <View style={styles.rowIdentity}>
            <AppText variant="body" weight={unread > 0 ? 'bold' : 'semibold'} numberOfLines={1}>
              {primary?.name ?? 'Conversation'}
            </AppText>
            {preview ? (
              <AppText variant="small" tone="secondary" numberOfLines={1}>
                {preview}
              </AppText>
            ) : null}
          </View>
          <View style={styles.rowMeta}>
            {time ? (
              <AppText variant="caption" tone="tertiary">
                {time}
              </AppText>
            ) : null}
            {unread > 0 ? (
              <View style={styles.unreadBadge}>
                <AppText variant="caption" weight="bold" tone="onPrimary">
                  {unread > 99 ? '99+' : unread}
                </AppText>
              </View>
            ) : null}
          </View>
        </View>
      </Card>
    </Pressable>
  );
}

function RequestsTab({
  view,
  visible,
}: {
  view: ReturnType<typeof useMessageRequests>;
  visible: ReturnType<typeof filterRequests>;
}) {
  if (view.isLoading) {
    return (
      <View style={styles.list}>
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </View>
    );
  }

  if (view.loadError) {
    return (
      <StatusBanner
        title="Could not load your requests"
        description={view.loadError}
        onRetry={view.retryLoad}
      />
    );
  }

  if (view.requests.length === 0) {
    return (
      <StatusBanner
        tone="info"
        title="No message requests"
        description="When someone asks to message you, their request will appear here for you to accept or reject."
      />
    );
  }

  if (visible.length === 0) {
    return (
      <StatusBanner
        tone="info"
        title="No requests match your search"
        description="Try a different name or detail."
      />
    );
  }

  return (
    <View style={styles.list} testID="requests-list">
      {visible.map((request) => {
        const busy = view.busyId === request.id;
        const cardError = view.actionErrorId === request.id ? view.actionError : null;
        return (
          <RequestCard
            key={request.id}
            request={request}
            busy={busy}
            error={cardError}
            onAccept={() => view.accept(request.id)}
            onReject={() => view.reject(request.id)}
          />
        );
      })}
    </View>
  );
}







