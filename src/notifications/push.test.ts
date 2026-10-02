/**
 * Push client tests.
 *
 * `expo-notifications` is fully mocked: these run in Node with no native runtime,
 * no Expo project, and no provider credential — which is the point. Everything
 * asserted here is the app's *own* decision (does it ask, does it register, does it
 * suppress a duplicate banner, where does a tap go), and a real provider could only
 * tell us things we already know.
 *
 * The foreground/background split is the load-bearing assertion. A push that lands
 * on a foregrounded app must not raise a banner, because the WebSocket has already
 * updated the UI through `notification.created`; a suite that only checked
 * "permission granted registers a device" would miss a duplicate banner entirely.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const permission = vi.hoisted(() => ({
  status: 'undetermined' as string,
  canAskAgain: true,
}));

const appState = vi.hoisted(() => ({
  listeners: [] as ((state: string) => void)[],
}));

const listeners = vi.hoisted(() => ({
  tapHandlers: [] as ((response: unknown) => void)[],
  lastResponse: null as unknown,
}));

const notifications = vi.hoisted(() => ({
  // A value the mock can hand back, so `ensureAndroidChannel` reads a real enum
  // rather than throwing on a missing export.
  AndroidImportance: { DEFAULT: 3 },
  setNotificationHandler: vi.fn(),
  setNotificationChannelAsync: vi.fn(async () => undefined),
  getPermissionsAsync: vi.fn(async () => ({
    status: permission.status,
    canAskAgain: permission.canAskAgain,
  })),
  requestPermissionsAsync: vi.fn(async () => ({
    status: permission.status,
    granted: permission.status === 'granted',
  })),
  getExpoPushTokenAsync: vi.fn(async () => ({ data: 'ExponentPushToken[fake]' })),
  getLastNotificationResponseAsync: vi.fn(async () => listeners.lastResponse),
  addNotificationResponseReceivedListener: vi.fn((handler: (r: unknown) => void) => {
    listeners.tapHandlers.push(handler);
    return { remove: vi.fn() };
  }),
}));

vi.mock('expo-notifications', () => notifications);
vi.mock('expo-device', () => ({ manufacturer: 'Google', modelName: 'Pixel 8' }));
vi.mock('react-native', () => ({
  AppState: {
    addEventListener: (_event: string, handler: (state: string) => void) => {
      appState.listeners.push(handler);
      return { remove: () => {} };
    },
  },
  Platform: { OS: 'android' },
}));

const tokenStorage = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string | null>>(async () => 'test-token'),
  set: vi.fn<() => Promise<void>>(async () => {}),
  clear: vi.fn<() => Promise<void>>(async () => {}),
}));
vi.mock('@/auth/tokenStorage', () => ({ tokenStorage }));

const pushDevices = vi.hoisted(() => ({
  registerDevice: vi.fn(async () => ({
    id: 'device-uuid',
    platform: 'android',
    device_name: 'Pixel',
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-01-01T00:00:00Z',
  })),
  removeDevice: vi.fn(async () => undefined),
}));
vi.mock('@/api/pushDevices', () => pushDevices);

const deviceStore = vi.hoisted(() => ({
  get: vi.fn<() => Promise<string | null>>(async () => null),
  set: vi.fn<() => Promise<void>>(async () => {}),
  clear: vi.fn<() => Promise<void>>(async () => {}),
}));
vi.mock('@/notifications/deviceStore', () => ({ pushDeviceStore: deviceStore }));

/* eslint-disable import/first -- vi.mock must precede the imports it replaces. */
import { ApiError } from '@/api/errors';
import {
  ANDROID_CHANNEL_ID,
  NOTIFICATIONS_ROUTE,
  configureForegroundBehaviour,
  consumeInitialNotification,
  currentPermissionStatus,
  ensureAndroidChannel,
  notificationRoute,
  observeNotificationTaps,
  parsePayload,
  registerForPush,
  requestPermission,
  unregisterForPush,
} from '@/notifications/push';

function tapResponse(data: unknown) {
  return { notification: { request: { content: { data } } } };
}

describe('permission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permission.status = 'undetermined';
    permission.canAskAgain = true;
    notifications.getPermissionsAsync.mockImplementation(async () => ({
      status: permission.status,
      canAskAgain: permission.canAskAgain,
    }));
    notifications.requestPermissionsAsync.mockImplementation(async () => ({
      status: permission.status,
      granted: permission.status === 'granted',
    }));
  });

  it('reports granted', async () => {
    permission.status = 'granted';
    expect(await currentPermissionStatus()).toBe('granted');
  });

  it('reports denied', async () => {
    permission.status = 'denied';
    expect(await currentPermissionStatus()).toBe('denied');
  });

  it('reports undetermined before any prompt', async () => {
    expect(await currentPermissionStatus()).toBe('undetermined');
  });

  it('checks the status without prompting', async () => {
    await currentPermissionStatus();
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('does not ask again once granted', async () => {
    permission.status = 'granted';
    expect(await requestPermission()).toBe('granted');
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('reports a standing denial instead of asking when the OS will not ask', async () => {
    permission.status = 'denied';
    permission.canAskAgain = false;
    expect(await requestPermission()).toBe('denied');
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('asks when the OS still allows it', async () => {
    // Undetermined *and* askable is the only state in which a prompt is
    // legitimate; granted returns early and a blocked denial must not re-ask.
    permission.status = 'undetermined';
    permission.canAskAgain = true;
    notifications.requestPermissionsAsync.mockImplementation(async () => ({
      status: 'granted',
      granted: true,
    }));
    expect(await requestPermission()).toBe('granted');
    expect(notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  });

  it('survives a provider that throws', async () => {
    notifications.getPermissionsAsync.mockRejectedValueOnce(new Error('native down'));
    expect(await currentPermissionStatus()).toBe('unavailable');
  });
});

describe('registration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permission.status = 'granted';
    notifications.getExpoPushTokenAsync.mockResolvedValue({ data: 'ExponentPushToken[fake]' });
    deviceStore.get.mockResolvedValue(null);
  });

  it('registers the token with the backend', async () => {
    expect(await registerForPush()).not.toBeNull();
    expect(pushDevices.registerDevice).toHaveBeenCalledWith(
      expect.objectContaining({ platform: 'android', push_token: 'ExponentPushToken[fake]' }),
    );
  });

  it('does not register without permission', async () => {
    permission.status = 'denied';
    expect(await registerForPush()).toBeNull();
    expect(pushDevices.registerDevice).not.toHaveBeenCalled();
  });

  it('does not register for an unauthenticated user', async () => {
    tokenStorage.get.mockResolvedValueOnce(null);
    expect(await registerForPush()).toBeNull();
    expect(pushDevices.registerDevice).not.toHaveBeenCalled();
  });

  it('does not register when no token can be obtained', async () => {
    notifications.getExpoPushTokenAsync.mockRejectedValueOnce(new Error('no project id'));
    expect(await registerForPush()).toBeNull();
    expect(pushDevices.registerDevice).not.toHaveBeenCalled();
  });

  it('survives a failed registration and can be retried', async () => {
    pushDevices.registerDevice.mockRejectedValueOnce(new Error('offline'));
    expect(await registerForPush()).toBeNull();
    // The retry is the next authenticated start; the server is idempotent, so a
    // second attempt is the correct response rather than a duplicate row.
    expect(await registerForPush()).not.toBeNull();
    expect(pushDevices.registerDevice).toHaveBeenCalledTimes(2);
  });

  it('remembers the device id so logout can unregister', async () => {
    await registerForPush();
    expect(deviceStore.set).toHaveBeenCalledWith('device-uuid');
  });

  it('never persists the push token itself', async () => {
    await registerForPush();
    expect(deviceStore.set).not.toHaveBeenCalledWith(
      expect.stringContaining('ExponentPushToken'),
    );
  });

  it('checks rather than prompts when asked not to', async () => {
    await registerForPush({ ask: false });
    expect(notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('creates the Android channel before registering', async () => {
    await registerForPush();
    expect(notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
      ANDROID_CHANNEL_ID,
      expect.objectContaining({ name: expect.any(String) }),
    );
  });
});

describe('foreground behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('suppresses the banner so the socket does not duplicate it', () => {
    const behavior = configureForegroundBehaviour();
    expect(behavior.shouldShowBanner).toBe(false);
    expect(behavior.shouldShowList).toBe(false);
    expect(behavior.shouldPlaySound).toBe(false);
    expect(behavior.shouldSetBadge).toBe(false);
  });

  it('installs the handler with Expo', () => {
    configureForegroundBehaviour();
    expect(notifications.setNotificationHandler).toHaveBeenCalledTimes(1);
  });

  it('creates no channel on a non-Android platform', async () => {
    const rn = await import('react-native');
    Object.defineProperty(rn.Platform, 'OS', { value: 'ios', configurable: true });
    await ensureAndroidChannel();
    expect(notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
    Object.defineProperty(rn.Platform, 'OS', { value: 'android', configurable: true });
  });
});

describe('payload parsing', () => {
  it('reads the four permitted identifiers', () => {
    expect(
      parsePayload({
        notification_id: 'n1',
        type: 'message',
        target_type: 'conversation',
        target_id: 'c1',
      }),
    ).toEqual({
      notificationId: 'n1',
      type: 'message',
      targetType: 'conversation',
      targetId: 'c1',
    });
  });

  it('drops anything beyond the four identifiers', () => {
    // §13.5: a push carries identifiers only. A payload that grew would be a
    // disclosure on a lock screen, so the parser refuses to pass extra fields on.
    const payload = parsePayload({
      notification_id: 'n1',
      body: 'are you free tomorrow?',
      actor: { name: 'Someone' },
    });
    expect(JSON.stringify(payload)).not.toContain('are you free tomorrow?');
    expect(Object.keys(payload).sort()).toEqual([
      'notificationId',
      'targetId',
      'targetType',
      'type',
    ]);
  });

  it('survives a malformed payload', () => {
    expect(parsePayload(null)).toEqual({});
    expect(parsePayload('nonsense')).toEqual({});
    expect(parsePayload(undefined)).toEqual({});
    expect(parsePayload(42)).toEqual({});
  });

  it('survives a payload with the wrong field types', () => {
    const payload = parsePayload({ notification_id: 7, target_type: { a: 1 } });
    expect(payload.notificationId).toBeUndefined();
    expect(payload.targetType).toBeNull();
  });
});

describe('tap handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.tapHandlers = [];
    listeners.lastResponse = null;
  });

  it('opens the notifications screen for a tap', () => {
    expect(notificationRoute({ notificationId: 'n1' })).toBe(NOTIFICATIONS_ROUTE);
  });

  it('opens the notifications screen even for a malformed payload', () => {
    // The conversation screens are still StageScreen placeholders, so there is no
    // real route to deep-link to yet. Falling back is the honest behaviour.
    expect(notificationRoute(null)).toBe(NOTIFICATIONS_ROUTE);
    expect(notificationRoute({})).toBe(NOTIFICATIONS_ROUTE);
  });

  it('routes a response through the listener', () => {
    const onTap = vi.fn();
    observeNotificationTaps(onTap);
    listeners.tapHandlers[0](tapResponse({ notification_id: 'n1', type: 'message' }));
    expect(onTap).toHaveBeenCalledWith(
      expect.objectContaining({ notificationId: 'n1', type: 'message' }),
    );
  });

  it('does not throw on a malformed tap', () => {
    const onTap = vi.fn();
    observeNotificationTaps(onTap);
    expect(() => listeners.tapHandlers[0](tapResponse('garbage'))).not.toThrow();
  });

  it('unsubscribes cleanly', () => {
    expect(() => observeNotificationTaps(vi.fn())()).not.toThrow();
  });

  it('returns null on an ordinary cold start', async () => {
    expect(await consumeInitialNotification()).toBeNull();
  });

  it('drains the tap that launched the app from a killed state', async () => {
    listeners.lastResponse = tapResponse({ notification_id: 'n1', type: 'message' });
    expect(await consumeInitialNotification()).toEqual(
      expect.objectContaining({ notificationId: 'n1' }),
    );
  });

  it('survives a provider that throws while reading the last response', async () => {
    notifications.getLastNotificationResponseAsync.mockRejectedValueOnce(new Error('native'));
    expect(await consumeInitialNotification()).toBeNull();
  });
});

describe('unregistration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('removes the registered device', async () => {
    expect(await unregisterForPush('device-uuid')).toBe(true);
    expect(pushDevices.removeDevice).toHaveBeenCalledWith('device-uuid');
  });

  it('treats an already-removed device as success', async () => {
    pushDevices.removeDevice.mockRejectedValueOnce(
      new ApiError({ message: 'Not found', status: 404, code: 'not_found' }),
    );
    expect(await unregisterForPush('device-uuid')).toBe(true);
  });

  it('never blocks logout on a network failure', async () => {
    pushDevices.removeDevice.mockRejectedValueOnce(new Error('offline'));
    expect(await unregisterForPush('device-uuid')).toBe(false);
  });

  it('does nothing when no device was ever registered', async () => {
    expect(await unregisterForPush(null)).toBe(false);
    expect(pushDevices.removeDevice).not.toHaveBeenCalled();
  });
});

describe('the websocket path is untouched', () => {
  it('exposes no second cache-invalidation path', async () => {
    // A regression guard on the boundary itself: push must not grow its own
    // invalidation, or a notification would refresh the cache twice.
    const module = await import('@/notifications/push');
    const names = Object.keys(module);
    expect(
      names.some((name) => /invalidate|queryClient|realtime/i.test(name)),
    ).toBe(false);
  });
});