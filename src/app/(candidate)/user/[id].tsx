/**
 * Public person profile — `/user/[id]`.
 *
 * Reached from a Home people-search suggestion. It is **not** `/profile`: that
 * route always loads the signed-in caller's own aggregate (`GET /profile`) and
 * carries edit affordances, so reusing it here would show the wrong person and
 * the wrong controls. This screen instead reads the other account through the
 * privacy-filtered public endpoint `GET /users/{public_id}` (see
 * `api/users.ts`), keyed by the **immutable public id** the lookup returned —
 * never a display-name lookup, which would be ambiguous and unsafe.
 *
 * The response is deliberately sparse: fields the owner withheld are *absent*
 * rather than null, so nothing private (email, phone, hidden sections) can leak
 * here. Only public fields are rendered.
 *
 * The connection action is the **same** `usePersonConnection` hook and the same
 * `/connections` API a Home suggestion uses, so the two surfaces can never
 * disagree about one relationship. States are the server's own:
 *   Connect | Requested (cancel) | Respond (accept/decline) | Connected.
 *
 * The caller's own public id is checked, so opening your own link renders an
 * honest "This is you" instead of a self-Connect button.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { listConnections } from '@/api/connections';
import { openConversation } from '@/api/messages';
import { queryKeys } from '@/api/queryKeys';
import { fetchPublicProfile } from '@/api/users';
import { useAuth } from '@/auth/AuthContext';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { PersonConnectionAction } from '@/features/people/PersonConnectionAction';
import { spacing } from '@/theme/tokens';

export default function PublicProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { principal } = useAuth();
  const selfPublicId = principal?.public_id ?? null;
  const publicId = typeof id === 'string' && id.length > 0 ? id : null;

  const profile = useQuery({
    queryKey: queryKeys.publicProfile(publicId ?? ''),
    queryFn: () => fetchPublicProfile(publicId as string),
    enabled: publicId !== null,
    retry: false,
  });

  // The caller's connection rows decide whether messaging is possible. Read at
  // the screen level so the message action and the connect action share one
  // server truth — a conversation can only be opened between two connected
  // people (`POST /conversations` 403s otherwise).
  const connections = useQuery({
    queryKey: queryKeys.connections(),
    queryFn: () => listConnections(),
    enabled: publicId !== null && publicId !== selfPublicId,
    retry: false,
  });

  const connected =
    (connections.data ?? []).some(
      (row) => row.user?.public_id === publicId && row.status === 'accepted',
    );

  // A missing id is a broken link, not a loading state.
  if (!publicId) {
    return (
      <Screen testID="public-profile-screen">
        <BackButton />
        <StatusBanner
          title="Profile not found"
          description="This link is missing a valid person. Go back and try again."
        />
      </Screen>
    );
  }

  return (
    <Screen testID="public-profile-screen">
      <BackButton />

      {profile.isPending ? (
        <View style={styles.stack}>
          <Card style={styles.card}>
            <Skeleton height={96} width={96} radius={48} />
            <Skeleton height={22} width="60%" />
            <Skeleton height={16} width="40%" />
          </Card>
          <SkeletonCard lines={3} />
        </View>
      ) : null}

      {profile.isError ? (
        <StatusBanner
          title="Couldn't load this profile"
          description={
            profile.error instanceof Error ? profile.error.message : 'This person is unavailable.'
          }
          onRetry={() => void profile.refetch()}
        />
      ) : null}

      {profile.data ? (
        <View style={styles.stack}>
          <Card style={styles.card}>
            <Avatar name={profile.data.name} src={profile.data.avatar_url} size={96} />
            <AppText variant="h3" weight="bold" style={styles.centered}>
              {profile.data.name}
            </AppText>
            <AppText variant="small" tone="tertiary" style={styles.centered}>
              {`@${profile.data.username}`}
            </AppText>
            {profile.data.designation ? (
              <AppText variant="small" tone="secondary" style={styles.centered}>
                {profile.data.designation}
              </AppText>
            ) : null}
            {profile.data.headline ? (
              <AppText variant="body" tone="secondary" style={styles.centered}>
                {profile.data.headline}
              </AppText>
            ) : null}
            {profile.data.location ? (
              <AppText variant="caption" tone="tertiary" style={styles.centered}>
                {profile.data.location}
              </AppText>
            ) : null}

            {/* One shared action for this relationship — identical to Home's. */}
            <PersonConnectionAction publicId={publicId} selfPublicId={selfPublicId} />

            {/*
              Message this person. Shown only when the relationship allows one:
              a conversation can only be opened between two connected people, so
              a non-connected viewer gets connect-first guidance instead of a
              button that would 403. The server's conversation id is the only
              thing navigated to — never this person's user id.
            */}
            {profile.data && !profile.data.is_owner ? (
              <ProfileMessageAction
                profileUserId={profile.data.user_id}
                profileName={profile.data.name}
                connected={connected}
              />
            ) : null}
          </Card>

          {profile.data.summary ? (
            <Card style={styles.card}>
              <AppText variant="label" uppercase tone="tertiary">
                About
              </AppText>
              <AppText variant="body" tone="secondary">
                {profile.data.summary}
              </AppText>
            </Card>
          ) : null}

          {profile.data.skill_count && profile.data.skill_count > 0 ? (
            <Card style={styles.card}>
              <AppText variant="label" uppercase tone="tertiary">
                Skills
              </AppText>
              <AppText variant="body" tone="secondary">
                {`${profile.data.skill_count} skill${profile.data.skill_count === 1 ? '' : 's'}`}
              </AppText>
            </Card>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

/**
 * Message this person — the supported start-conversation flow from a profile.
 *
 * `POST /conversations {user_id}` opens the thread or hands back the one that
 * already exists (201/200); it refuses with 403 when the pair is not
 * connected, so a non-connected viewer gets connect-first guidance instead of
 * a button that can only fail. Navigation uses only the server's conversation
 * id — never this person's user id.
 */
function ProfileMessageAction({
  profileUserId,
  profileName,
  connected,
}: {
  profileUserId: string;
  profileName: string;
  connected: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  const open = useMutation({
    mutationFn: () => openConversation(profileUserId),
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

  if (!connected) {
    return (
      <AppText variant="caption" tone="tertiary" style={styles.centered}>
        Connect with {profileName} to start messaging.
      </AppText>
    );
  }

  return (
    <View style={styles.messageAction}>
      <Button
        label="Message"
        variant="secondary"
        fullWidth
        loading={open.isPending}
        disabled={open.isPending}
        accessibilityHint={`Opens a conversation with ${profileName}`}
        onPress={() => {
          if (!open.isPending) open.mutate();
        }}
      />
      {error ? (
        <StatusBanner title="Couldn't open this conversation" description={error} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.lg,
    marginTop: spacing.md,
  },
  card: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  centered: {
    textAlign: 'center',
  },
  messageAction: {
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
});