/**
 * Push notifications — permission, token, registration, and tap handling.
 *
 * This module is the *only* place `expo-notifications` is imported. Screens never
 * touch it: they consume state from {@link usePushRegistration} and navigate with
 * {@link notificationRoute}, which keeps the foreground/background rules in one
 * testable file instead of spread across every screen that happens to be open.
 *
 * **The split this exists to enforce.** A WebSocket only reaches a running app.
 * Foreground, the socket is authoritative and Phase 3's `notification.created`
 * invalidates the query cache; background or killed, the socket is gone and the
 * system tray is the only delivery path. So:
 *
 * - the notification handler returns every `shouldShow*` as false — a push that
 *   arrives while the app is foregrounded must NOT raise a second banner on top
 *   of what the socket-driven UI already produced. That is the duplicate this
 *   configuration prevents;
 * - `_contentAvailable` in the payload makes iOS wake the app to fetch, and the
 *   data carries only identifiers (§13.5), so the app invalidates queries and
 *   re-reads over authenticated REST rather than rendering from the payload.
 *
 * **Nothing here logs the push token.** It is a credential (§20.3), so failures
 * are reported as a sentence and never as a value.
 *
 * **Every entry point is fail-safe.** A denied permission, a missing project id,
 * a failed network call, or an unreachable provider must leave the app fully
 * usable — notifications enhance the product, they are never a precondition.
 * Every function therefore returns a value instead of throwing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

import { ApiError } from '@/api/errors';
import {
  type PushDevice,
  type PushPlatform,
  registerDevice,
  removeDevice,
} from '@/api/pushDevices';
import { tokenStorage } from '@/auth/tokenStorage';
import { pushDeviceStore } from '@/notifications/deviceStore';

/** The single Android channel. §13.6 asks for one general channel, not a set. */
export const ANDROID_CHANNEL_ID = 'default';

/**
 * Where a tapped notification opens.
 *
 * **V1 sends every tap to the notifications screen.** The conversation and message
 * screens are `StageScreen` placeholders (§7.1), so deep-linking to a real
 * conversation would navigate to a route that does not exist. The payload's
 * `targetId` is already carried — when those screens become real, this function
 * is the single place that grows the mapping.
 */
export const NOTIFICATIONS_ROUTE = '/(candidate)/notifications';

export function notificationRoute(_payload: PushPayload | null): string {
  return NOTIFICATIONS_ROUTE;
}

/**
 * The payload §13.5 permits: four identifiers, nothing else.
 *
 * `notificationId` is the handle a screen would fetch with. Every field is
 * optional because a malformed payload must be *survivable* — a tap is the one
 * moment where an exception is both easy to hit and hardest to diagnose from a
 * user's report.
 */
export interface PushPayload {
  notificationId?: string;
  type?: string;
  targetType?: string | null;
  targetId?: string | null;
}

export type PushPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export interface PushRegistrationState {
  status: PushPermissionStatus;
  /** True once a token has been registered with the backend. */
  registered: boolean;
  /** Last failure as a human-readable sentence. Never a token. */
  error: string | null;
}

function platformFor(): PushPlatform {
  return Platform.OS === 'ios' ? 'ios' : 'android';
}

/**
 * A stable, non-identifying label for the device row. The model name alone is not
 * personal, and an owner with a phone and a tablet needs to tell the rows apart.
 */
function deviceNameFor(): string {
  return `${Device.manufacturer ?? 'unknown'} ${Device.modelName ?? 'device'}`.trim();
}

/**
 * Silence foreground banners (§13.6).
 *
 * Must run before the app renders. Returns the configured handler so a test can
 * assert the behaviour without reaching into module-level state.
 */
export function configureForegroundBehaviour(): Notifications.NotificationBehavior {
  const behavior: Notifications.NotificationBehavior = {
    // All false is the duplicate suppression: the socket already updated the UI,
    // so a banner here would show the same event twice.
    shouldShowBanner: false,
    shouldShowList: false,
    shouldPlaySound: false,
    shouldSetBadge: false,
  };
  Notifications.setNotificationHandler({ handleNotification: async () => behavior });
  return behavior;
}

/** Android needs the channel to exist before a tray notification can appear. */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Notifications',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

function normalise(status: Notifications.PermissionStatus): PushPermissionStatus {
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/** Current permission without prompting. Never throws. */
export async function currentPermissionStatus(): Promise<PushPermissionStatus> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    return normalise(existing.status);
  } catch {
    return 'unavailable';
  }
}

/**
 * Ask for permission, at most once per call.
 *
 * **A denial is a supported end state**, not an error: the app is fully usable
 * without notifications, and a later explicit retry — the next authenticated
 * start — is what re-asks. The `canAskAgain` guard is what stops a permission
 * dialog appearing on every render, which is the classic way an app trains users
 * to dismiss it.
 */
export async function requestPermission(): Promise<PushPermissionStatus> {
  try {
    const existing = await Notifications.getPermissionsAsync();
    if (existing.status === 'granted') return 'granted';
    // The OS will no longer show a dialog; report the standing answer instead of
    // calling anyway, which on Android silently returns the same denial.
    if (existing.canAskAgain === false) return normalise(existing.status);
    const asked = await Notifications.requestPermissionsAsync();
    return normalise(asked.status);
  } catch {
    return 'unavailable';
  }
}

/** The Expo push token, or `null`. Never throws, never logs the value. */
async function tokenFor(): Promise<string | null> {
  try {
    const { data } = await Notifications.getExpoPushTokenAsync();
    return data ?? null;
  } catch {
    // A missing `extra.eas.projectId` is the usual cause, and it is a deployment
    // gap rather than a user-facing fault. See the Phase 4 report.
    return null;
  }
}

/**
 * The full authenticated flow: permission → token → register.
 *
 * Returns the registered device, or `null` for every non-fatal outcome (no
 * permission, no project id, no session, no network). The caller never catches.
 */
export async function registerForPush(
  options: { ask?: boolean } = {},
): Promise<PushDevice | null> {
  const ask = options.ask ?? true;
  const status = ask ? await requestPermission() : await currentPermissionStatus();
  if (status !== 'granted') return null;

  // Registration is for an authenticated account only. A token registered with no
  // session would be owned by nobody and delivered to nobody.
  if (!(await tokenStorage.get())) return null;

  await ensureAndroidChannel();
  const pushToken = await tokenFor();
  if (!pushToken) return null;

  try {
    const device = await registerDevice({
      push_token: pushToken,
      platform: platformFor(),
      device_name: deviceNameFor(),
    });
    // Remembered so logout can unregister. The *id*, never the token (§13.6).
    await pushDeviceStore.set(device.id);
    return device;
  } catch {
    // Retryable: the next authenticated start tries again, and the server side
    // is idempotent, so repeated attempts cannot create duplicate rows.
    return null;
  }
}

/**
 * Unregister before logout, and never let it block the logout.
 *
 * Two deliberate decisions:
 *
 * - **A 404 counts as success.** The row may already be gone, and the outcome the
 *   caller wants — this device receives nothing further — is already true.
 * - **Other failures are swallowed.** The session is being torn down regardless,
 *   and no user should be left watching a spinner because a network call did not
 *   answer. A surviving registration expires on its own, and the next login
 *   re-registers idempotently.
 */
export async function unregisterForPush(deviceId: string | null): Promise<boolean> {
  if (!deviceId) return false;
  try {
    await removeDevice(deviceId);
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return true;
    return false;
  }
}

/**
 * Parse an Expo notification into the four fields §13.5 allows.
 *
 * Anything missing becomes `undefined` rather than an error, so a malformed
 * payload still resolves to a usable destination. Nothing else from the payload
 * is returned, which is what stops a future server change from widening what the
 * app trusts.
 */
export function parsePayload(data: unknown): PushPayload {
  if (typeof data !== 'object' || data === null) return {};
  const raw = data as Record<string, unknown>;
  const str = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;
  return {
    notificationId: str(raw.notification_id),
    type: str(raw.type),
    targetType: str(raw.target_type) ?? null,
    targetId: str(raw.target_id) ?? null,
  };
}

/**
 * Run `onTap` whenever a notification is opened, from any app state.
 *
 * The listener covers the foreground and background cases; a *cold* start from the
 * killed state arrives once as a "last response" instead, which
 * {@link consumeInitialNotification} drains so a tap that launched the app is not
 * lost. Returns a cleanup function so this is usable straight from an effect.
 */
export function observeNotificationTaps(
  onTap: (payload: PushPayload) => void,
): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    onTap(parsePayload(response.notification.request.content.data));
  });
  return () => subscription.remove();
}

/**
 * Drain a notification that launched the app from a killed state.
 *
 * Returns the payload when there was one, so the caller can navigate, and `null`
 * on an ordinary cold start. Safe to call repeatedly.
 */
export async function consumeInitialNotification(): Promise<PushPayload | null> {
  try {
    const response = await Notifications.getLastNotificationResponseAsync();
    if (!response) return null;
    return parsePayload(response.notification.request.content.data);
  } catch {
    return null;
  }
}

/**
 * Register this device once the session is authenticated, and keep it registered.
 *
 * Mount this in the authenticated layout with `enabled` bound to the auth status.
 *
 * **Why it re-runs on foreground.** The `attempted` ref stops the effect from
 * firing on every render, but an Expo token can change — after a reinstall, an
 * OS-level token refresh, or a switch to a different account on the same device.
 * Re-registering on return to the foreground is what keeps delivery working, and
 * the server side is idempotent so it costs one request.
 *
 * **Why `ask` is passed only on the first attempt.** A user who declined should
 * not be re-prompted every time they unlock their phone. The first run of an
 * authenticated session asks once; every later foreground return only *checks*,
 * which still picks up a user who has since enabled notifications in Settings.
 */
/**
 * What the hook reports before it is enabled, and while it is not.
 *
 * A module-level constant rather than a fresh literal, so returning it on every
 * disabled render does not hand consumers a new object identity each time.
 */
const IDLE_REGISTRATION_STATE: PushRegistrationState = Object.freeze({
  status: 'undetermined',
  registered: false,
  error: null,
});

export function usePushRegistration(enabled: boolean): PushRegistrationState {
  const [state, setState] = useState<PushRegistrationState>(IDLE_REGISTRATION_STATE);
  const attempted = useRef(false);

  const attempt = useCallback(async (ask: boolean) => {
    const status = await currentPermissionStatus();
    if (status === 'unavailable') {
      setState({ status, registered: false, error: null });
      return;
    }
    if (status === 'denied' && !ask) {
      // A standing denial is reported, never re-prompted.
      setState({ status, registered: false, error: null });
      return;
    }
    const device = await registerForPush({ ask });
    setState({
      // A successful registration implies the permission is now granted, even if
      // the status read happened before the prompt.
      status: device ? 'granted' : status,
      registered: device !== null,
      error: null,
    });
  }, []);

  useEffect(() => {
    if (!enabled) {
      // Signed out. Only the ref is reset here, so the next sign-in asks afresh
      // rather than inheriting this session's "already asked" state. The visible
      // state is *derived* below rather than assigned, because calling setState
      // in an effect body forces a second render pass on every sign-out.
      attempted.current = false;
      return;
    }
    if (attempted.current) return;
    attempted.current = true;
    void attempt(true);
  }, [enabled, attempt]);

  useEffect(() => {
    if (!enabled) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void attempt(false);
    });
    return () => subscription.remove();
  }, [enabled, attempt]);

  // Derived, not stored: while signed out there is nothing to report, and a
  // caller must never see a stale `registered: true` belonging to a previous
  // account. Returning the constant keeps the identity stable across renders, so
  // this does not defeat a consumer's `useMemo`.
  return enabled ? state : IDLE_REGISTRATION_STATE;
}