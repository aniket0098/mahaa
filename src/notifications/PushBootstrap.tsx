/**
 * Wires push into the app tree. Mounted once, in the root layout.
 *
 * This exists as a component rather than as a block of effects in `_layout.tsx`
 * for one reason: the layout is a *route* file, so a hook there would be untestable
 * without a router, and the tap-destination rule is exactly the kind of thing that
 * should be unit-tested rather than eyeballed.
 *
 * Three jobs, in order:
 *
 * 1. **Configure the foreground handler before first paint.** Duplicate suppression
 *    has to be in place before a push can arrive, which means at module import
 *    time — a `useEffect` would be too late.
 * 2. **Register the device when authenticated.** Via `usePushRegistration`, bound to
 *    the auth status, so a signed-out app never registers a token.
 * 3. **Route taps.** A tap that arrives while the app is killed is drained here via
 *    `consumeInitialNotification`; later taps come through the listener. Both paths
 *    land on the same route.
 */

import { useEffect } from 'react';
import { router } from 'expo-router';

import { useAuth } from '@/auth/AuthContext';
import {
  configureForegroundBehaviour,
  consumeInitialNotification,
  notificationRoute,
  observeNotificationTaps,
  usePushRegistration,
} from '@/notifications/push';

// Must run at import time, not in an effect: a push can arrive before the first
// frame, and an unconfigured handler would raise a visible banner for an event the
// socket is about to deliver as well.
configureForegroundBehaviour();

export function PushBootstrap() {
  const { status } = useAuth();
  usePushRegistration(status === 'authenticated');

  useEffect(() => {
    // A tap that launched the app from a killed state. No socket exists yet here,
    // which is exactly why the payload carries only identifiers and the screen is
    // re-read over REST once it mounts.
    let cancelled = false;
    void consumeInitialNotification().then((payload) => {
      if (payload && !cancelled) router.push(notificationRoute(payload) as never);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(
    () => observeNotificationTaps((payload) => {
      router.push(notificationRoute(payload) as never);
    }),
    [],
  );

  return null;
}