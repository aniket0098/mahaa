/**
 * Session-resolution gate.
 *
 * `(app)/_layout.tsx` redirects here while the session is still resolving, so
 * protected content never flashes and no redirect is guessed before the server
 * has answered. This screen then resolves the session itself: without that
 * second step, `/boot` would be a dead end — the guard only runs while the
 * `(app)` group is the active route, so nothing would move the user onwards.
 */

import { Redirect } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';
import { Screen } from '@/components/ui/Screen';
import { useAuth } from '@/auth/AuthContext';
import { homePathForRole } from '@/auth/roleHome';
import { spacing } from '@/theme/tokens';

export default function BootScreen() {
  const { status, principal } = useAuth();

  if (status === 'loading') {
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

  // Each role enters its own tree, so the session never lands someone in a
  // navigation set that does not belong to them.
  if (status === 'authenticated' && principal) {
    return <Redirect href={homePathForRole(principal.role) as never} />;
  }

  return <Redirect href="/login" />;
}

const styles = StyleSheet.create({
  gap: {
    height: spacing.lg,
  },
});

