/**
 * Session-resolution gate.
 *
 * `(app)/_layout.tsx` redirects here while the session is still resolving, so
 * protected content never flashes and no redirect is guessed before the server
 * has answered. This screen then resolves the session itself: without that
 * second step, `/boot` would be a dead end — the guard only runs while the
 * `(app)` group is the active route, so nothing would move the user onwards.
 *
 * The destination is the **server's** answer about onboarding, not a local flag.
 * That matters most here of all: this is the screen an app relaunch or a refresh
 * lands on, so it is the one that has to honour half-finished onboarding instead
 * of dropping the person straight onto their dashboard. A person who quit
 * mid-wizard gets their unfinished flow back; a person who finished gets their
 * own home.
 */

import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/auth/AuthContext';
import { resolveEntryPath } from '@/auth/entryPath';
import { spacing } from '@/theme/tokens';

export default function BootScreen() {
  const { status, principal } = useAuth();
  const queryClient = useQueryClient();
  // Null until the server has been asked. Rendering a redirect before that would
  // flash the wrong screen, which is the exact thing this screen exists to avoid.
  const [destination, setDestination] = useState<string | null>(null);

  useEffect(() => {
    if (status !== 'authenticated' || !principal) return;
    let cancelled = false;
    void resolveEntryPath(queryClient, principal.role).then((path) => {
      if (!cancelled) setDestination(path);
    });
    return () => {
      cancelled = true;
    };
  }, [status, principal, queryClient]);

  if (status === 'loading' || (status === 'authenticated' && destination === null)) {
    return (
      <Screen testID="boot-screen">
        <Skeleton height={28} width="55%" />
        <Skeleton height={14} width="80%" />
        <View style={styles.gap} />
        <SkeletonCard lines={3} />
        <SkeletonCard lines={2} />
      </Screen>
    );
  }

  if (status === 'authenticated' && destination) {
    return <Redirect href={destination as never} />;
  }

  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  gap: {
    height: spacing.lg,
  },
});

