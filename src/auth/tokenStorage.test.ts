import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Token storage is the root of the "Authentication required." report.
 *
 * `expo start --web` serves this app on 8081, and `expo-secure-store` has no web
 * implementation. The old guards were `if (!isSecureStoreAvailable()) return;`,
 * which made `set()` a silent no-op on web: the token returned by login/signup
 * was discarded, and the very next `GET /auth/me` went out with no
 * `Authorization` header and came back 401. The account was never the problem.
 *
 * `Platform.OS` is mocked because that is the only branch point.
 */

const state = vi.hoisted(() => ({ platform: 'web' as string }));

vi.mock('react-native', () => ({
  get Platform() {
    return {
      get OS() {
        return state.platform;
      },
    };
  },
}));

const secureStore = vi.hoisted(() => ({
  getItemAsync: vi.fn<() => Promise<string | null>>(async () => null),
  setItemAsync: vi.fn<() => Promise<void>>(async () => {}),
  deleteItemAsync: vi.fn<() => Promise<void>>(async () => {}),
}));

vi.mock('expo-secure-store', () => ({
  getItemAsync: secureStore.getItemAsync,
  setItemAsync: secureStore.setItemAsync,
  deleteItemAsync: secureStore.deleteItemAsync,
}));

/** A complete `Storage`, so the fake satisfies the same type the app uses. */
function fakeSessionStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
  };
}

describe('tokenStorage on web (the 8081 dev server)', () => {
  let store: Storage;

  beforeEach(() => {
    state.platform = 'web';
    store = fakeSessionStorage();
    vi.stubGlobal('window', { sessionStorage: store });
    secureStore.getItemAsync.mockClear();
    secureStore.setItemAsync.mockClear();
    secureStore.deleteItemAsync.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps the token so the next protected request can send it', async () => {
    const { tokenStorage } = await import('@/auth/tokenStorage');

    await tokenStorage.set('token-abc');

    // The regression: this was a no-op, so `get` returned null and /auth/me was
    // sent unauthenticated -> 401 "Authentication required."
    expect(await tokenStorage.get()).toBe('token-abc');
    expect(store.getItem('mahajob.access_token')).toBe('token-abc');
  });

  it('never touches the native secure store on web', async () => {
    const { tokenStorage } = await import('@/auth/tokenStorage');

    await tokenStorage.set('token-abc');
    await tokenStorage.get();
    await tokenStorage.clear();

    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
    expect(secureStore.getItemAsync).not.toHaveBeenCalled();
    expect(secureStore.deleteItemAsync).not.toHaveBeenCalled();
  });

  it('uses sessionStorage, never localStorage', async () => {
    // docs/SECURITY.md Stage 4 rule J: tab-scoped only, never localStorage.
    const { tokenStorage } = await import('@/auth/tokenStorage');
    const local = fakeSessionStorage();
    vi.stubGlobal('window', { sessionStorage: store, localStorage: local });

    await tokenStorage.set('token-abc');

    expect(local.getItem('mahajob.access_token')).toBeNull();
  });

  it('clears the token on sign out', async () => {
    const { tokenStorage } = await import('@/auth/tokenStorage');

    await tokenStorage.set('token-abc');
    await tokenStorage.clear();

    expect(await tokenStorage.get()).toBeNull();
    expect(store.getItem('mahajob.access_token')).toBeNull();
  });

  it('still authenticates when sessionStorage is unavailable', async () => {
    // Private mode / blocked storage must not silently drop the token again.
    vi.stubGlobal('window', {
      get sessionStorage(): Storage {
        throw new Error('storage disabled');
      },
    });
    const { tokenStorage } = await import('@/auth/tokenStorage');

    await tokenStorage.set('token-abc');

    expect(await tokenStorage.get()).toBe('token-abc');
  });
});

describe('tokenStorage on iOS and Android', () => {
  let store: Storage;

  beforeEach(() => {
    state.platform = 'ios';
    store = fakeSessionStorage();
    vi.stubGlobal('window', { sessionStorage: store });
    secureStore.getItemAsync.mockReset().mockResolvedValue(null);
    secureStore.setItemAsync.mockReset().mockResolvedValue(undefined);
    secureStore.deleteItemAsync.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses expo-secure-store and not the browser store', async () => {
    const { tokenStorage } = await import('@/auth/tokenStorage');

    await tokenStorage.set('token-native');

    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      'mahajob.access_token',
      'token-native',
    );
    expect(store.getItem('mahajob.access_token')).toBeNull();
  });

  it('reads the token back from the keychain', async () => {
    secureStore.getItemAsync.mockResolvedValue('token-native');
    const { tokenStorage } = await import('@/auth/tokenStorage');

    expect(await tokenStorage.get()).toBe('token-native');
  });

  it('never writes the token to the browser on a device platform', async () => {
    const { tokenStorage } = await import('@/auth/tokenStorage');

    await tokenStorage.set('token-native');

    expect(store.getItem('mahajob.access_token')).toBeNull();
  });

  it('a keychain failure does not throw out of a successful login', async () => {
    secureStore.setItemAsync.mockRejectedValue(new Error('keystore unavailable'));
    const { tokenStorage } = await import('@/auth/tokenStorage');

    await expect(tokenStorage.set('token-native')).resolves.toBeUndefined();
  });
});
