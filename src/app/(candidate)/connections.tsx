/**
 * Connections - the real connection-request surface.
 *
 * Reached from the Messages screen's Connections tab and from Home. This is
 * **connection requests** (main backend `/connections`) - deliberately *not*
 * message requests, which live in the Messages screen's Requests tab and are
 * owned by the separate `message-docker-service`. Accepting a connection here
 * never touches a message request, and vice versa.
 *
 * One `GET /connections` call is partitioned by `partitionConnections` into the
 * three groups the screen renders:
 *
 *   1. **Incoming requests** - Accept / Decline, offered only because the
 *      server's `is_outgoing` says the caller is the addressee. Only the
 *      intended recipient can resolve a request; the server enforces it.
 *   2. **Sent requests** - Cancel, offered only for rows the caller sent.
 *   3. **Connections** - accepted relationships, each linking to the person's
 *      public profile by immutable public id.
 *
 * Every mutation invalidates the connections cache, so a row leaves a list only
 * after the server confirms and the refetch lands. A failure keeps the row and
 * shows the server's message inline - never a false success. A 409 (stale state)
 * is surfaced the same way and the refetch reconciles to the real server state.
 */

import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import {
  acceptConnection,
  cancelConnection,
  declineConnection,
  listConnections,
} from '@/api/connections';
import { ApiError } from '@/api/errors';
import { openConversation } from '@/api/messages';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { partitionConnections } from '@/features/connection/connectionList';
import { formatRequestTime } from '@/features/messages/messageSections';
import { spacing } from '@/theme/tokens';
import type { Connection } from '@/types/onboarding';

/** One row's action error, so a failure never wipes the whole list. */
type RowError = { id: string; message: string } | null;

export default function ConnectionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<RowError>(null);

  const rows = useQuery({
    queryKey: queryKeys.connections(),
    queryFn: () => listConnections(),
  });

  const invalidate = useCallback(
    () => void queryClient.invalidateQueries({ queryKey: queryKeys.connectionsRoot }),
    [queryClient],
  );

  const onMutationError = useCallback(
    (id: string, error: unknown) => {
      setRowError({
        id,
        message:
          error instanceof ApiError
            ? error.message
            : "Couldn't update the request. Check your connection and try again.",
      });
      // A conflict (409) or any failure means the cache may be stale: reconcile
      // with the server so the list shows the real state rather than a lie.
      invalidate();
    },
    [invalidate],
  );

  // `busyId` disables every row's buttons while one action is on the wire, so a
  // double submit or an interleaved action is impossible.
  const acceptMutation = useMutation({
    mutationFn: (id: string) => acceptConnection(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: () => {
      setRowError(null);
      invalidate();
    },
    onError: (error, id) => onMutationError(id, error),
    onSettled: () => setBusyId(null),
  });

  const declineMutation = useMutation({
    mutationFn: (id: string) => declineConnection(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: () => {
      setRowError(null);
      invalidate();
    },
    onError: (error, id) => onMutationError(id, error),
    onSettled: () => setBusyId(null),
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelConnection(id),
    onMutate: (id) => setBusyId(id),
    onSuccess: () => {
      setRowError(null);
      invalidate();
    },
    onError: (error, id) => onMutationError(id, error),
    onSettled: () => setBusyId(null),
  });

  const openProfile = useCallback(
    (publicId: string) => {
      router.push(`/user/${encodeURIComponent(publicId)}` as never);
    },
    [router],
  );

  const lists = partitionConnections(rows.data);

  if (rows.isPending) {
    return (
      <Screen testID="connections-screen">
        <BackButton />
        <AppText variant="h2" weight="bold" style={styles.title}>
          Connections
        </AppText>
        <View style={styles.stack}>
          <SkeletonCard lines={3} />
          <SkeletonCard lines={3} />
        </View>
      </Screen>
    );
  }

  if (rows.isError) {
    return (
      <Screen testID="connections-screen">
        <BackButton />
        <AppText variant="h2" weight="bold" style={styles.title}>
          Connections
        </AppText>
        <StatusBanner
          title="Couldn't load your connections"
          description={rows.error instanceof Error ? rows.error.message : 'Please try again.'}
          onRetry={() => void rows.refetch()}
        />
      </Screen>
    );
  }
  return (
    <Screen testID="connections-screen">
      <BackButton />

      <AppText variant="h2" weight="bold" style={styles.title}>
        Connections
      </AppText>

      {/* 1. Incoming connection requests - the recipient's action surface. */}
      <SectionHeader
        title="Incoming requests"
        empty={lists.incoming.length === 0}
        emptyText="No pending requests right now."
      />
      {lists.incoming.map((connection) => (
        <Card key={connection.id} style={styles.card}>
          <RowIdentity connection={connection} onOpenProfile={openProfile} />
          {rowError?.id === connection.id ? (
            <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {rowError.message}
            </AppText>
          ) : null}
          <View style={styles.actions}>
            <Button
              label="Accept"
              style={styles.action}
              disabled={busyId !== null}
              loading={busyId === connection.id && acceptMutation.isPending}
              onPress={() => acceptMutation.mutate(connection.id)}
            />
            <Button
              label="Decline"
              variant="secondary"
              style={styles.action}
              disabled={busyId !== null}
              onPress={() => declineMutation.mutate(connection.id)}
            />
          </View>
        </Card>
      ))}

      {/* 2. Requests the caller sent - Cancel only. */}
      <SectionHeader
        title="Sent requests"
        empty={lists.outgoing.length === 0}
        emptyText="You have no requests waiting for an answer."
      />
      {lists.outgoing.map((connection) => (
        <Card key={connection.id} style={styles.card}>
          <RowIdentity connection={connection} onOpenProfile={openProfile} />
          {rowError?.id === connection.id ? (
            <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {rowError.message}
            </AppText>
          ) : null}
          <Button
            label="Cancel request"
            variant="ghost"
            fullWidth
            disabled={busyId !== null}
            loading={busyId === connection.id && cancelMutation.isPending}
            onPress={() => cancelMutation.mutate(connection.id)}
          />
        </Card>
      ))}

      {/* 3. Established connections. */}
      <SectionHeader
        title="Your connections"
        empty={lists.accepted.length === 0}
        emptyText="No connections yet. Send a request from Home or a profile."
      />
      {lists.accepted.map((connection) => (
        <Card key={connection.id} style={styles.card}>
          <RowIdentity connection={connection} onOpenProfile={openProfile} />
          <MessageConnectionButton connection={connection} />
        </Card>
      ))}
    </Screen>
  );
}

/**
 * The supported start-conversation flow, one row at a time.
 *
 * `POST /conversations {user_id}` is the server's own contract - it opens a
 * thread or hands back the one that already exists (201 or 200 respectively),
 * and refuses with **403** when the pair is not connected or the other person
 * has messaging off. The client never creates a conversation record itself, and
 * never bulk-creates empty threads: a thread is opened exactly when a reader
 * asks for one.
 *
 * A failure stays inline on the button with the server's message; nothing
 * navigates until the server has answered with a conversation id.
 */
function MessageConnectionButton({ connection }: { connection: Connection }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const open = useMutation({
    mutationFn: () => openConversation(connection.user.user_id),
    onSuccess: (conversation) => {
      setError(null);
      router.push(`/conversation/${conversation.id}` as never);
    },
    onError: (err: unknown) => {
      setError(
        err instanceof ApiError ? err.message : "Couldn't open a conversation. Try again.",
      );
    },
  });

  return (
    <View style={styles.messageAction}>
      <Button
        label="Message"
        variant="secondary"
        fullWidth
        loading={open.isPending}
        disabled={open.isPending}
        accessibilityHint={`Opens a conversation with ${connection.user.name}`}
        onPress={() => {
          if (!open.isPending) open.mutate();
        }}
      />
      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

/** Avatar + name + @username + relative time; the name opens the profile. */
function RowIdentity({
  connection,
  onOpenProfile,
}: {
  connection: Connection;
  onOpenProfile: (publicId: string) => void;
}) {
  const person = connection.user;
  return (
    <View style={styles.identityRow}>
      <Avatar name={person.name} src={person.avatar_url} size={56} />
      <View style={styles.identityText}>
        <AppText
          variant="body"
          weight="semibold"
          numberOfLines={1}
          accessibilityRole="button"
          onPress={() => onOpenProfile(person.public_id)}>
          {person.name}
        </AppText>
        <AppText variant="caption" tone="tertiary" numberOfLines={1}>
          {`@${person.username}`}
        </AppText>
        <AppText variant="caption" tone="tertiary">
          {formatRequestTime(connection.created_at)}
        </AppText>
      </View>
    </View>
  );
}

/** A section heading that always renders, with an honest empty line under it. */
function SectionHeader({
  title,
  empty,
  emptyText,
}: {
  title: string;
  empty: boolean;
  emptyText: string;
}) {
  return (
    <View style={styles.section}>
      <AppText variant="label" uppercase tone="tertiary">
        {title}
      </AppText>
      {empty ? (
        <AppText variant="small" tone="secondary">
          {emptyText}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  stack: {
    gap: spacing.md,
  },
  section: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
    marginTop: spacing.lg,
  },
  card: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  identityRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
  },
  identityText: {
    flex: 1,
    gap: 2,
  },
  messageAction: {
    gap: spacing.sm,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  action: {
    flex: 1,
  },
});
