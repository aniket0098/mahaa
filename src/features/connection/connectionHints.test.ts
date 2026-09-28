import { describe, expect, it } from 'vitest';

import { hintForBaseUrl } from '@/features/connection/connectionHints';

describe('hintForBaseUrl', () => {
  it('explains the emulator alias, which is the classic phone-only failure', () => {
    const hint = hintForBaseUrl('http://10.0.2.2:8000/api/v1');
    expect(hint).toMatch(/emulator/i);
    expect(hint).toMatch(/LAN address/i);
  });

  it('explains that a phone cannot reach localhost', () => {
    expect(hintForBaseUrl('http://localhost:8000/api/v1')).toMatch(/cannot reach/i);
    expect(hintForBaseUrl('http://127.0.0.1:8000/api/v1')).toMatch(/cannot reach/i);
  });

  it('names the cleartext rule for plain http on a real LAN address', () => {
    const hint = hintForBaseUrl('http://192.168.56.1:8000/api/v1');
    expect(hint).toMatch(/cleartext|http:\/\//i);
    expect(hint).toMatch(/Wi-Fi/i);
  });

  it('falls back to the shared-network check for https', () => {
    expect(hintForBaseUrl('https://api.mahajob.test/api/v1')).toMatch(/same Wi-Fi/i);
  });
});

describe('hintForBaseUrl — silent emulator fallback on a real phone', () => {
  it('names the exact address in use and the exact cause', () => {
    const hint = hintForBaseUrl('http://10.0.2.2:8000/api/v1', {
      needsDeviceConfiguration: true,
    });
    expect(hint).toContain('http://10.0.2.2:8000/api/v1');
    expect(hint).toMatch(/physical phone/i);
    expect(hint).toMatch(/emulator/i);
  });

  it('gives an actionable remedy: the env var and the cache-clearing restart', () => {
    const hint = hintForBaseUrl('http://10.0.2.2:8000/api/v1', {
      needsDeviceConfiguration: true,
    });
    expect(hint).toContain('EXPO_PUBLIC_API_BASE_URL');
    // The LAN variable is the one a phone actually needs, and it must be named as
    // such: the shared variable is what already resolves to 10.0.2.2, so telling
    // the user to edit it would leave the phone exactly where it started.
    expect(hint).toContain('EXPO_PUBLIC_API_BASE_URL_LAN');
    expect(hint).toContain('npm run start:clear');
  });

  it('takes precedence over the generic emulator-alias hint', () => {
    // The generic hint assumes a developer typed the wrong value. On a phone the
    // cause is different — nothing was configured, so the value in use is a
    // fallback the user never chose. The specific hint must therefore be the one
    // that names the address in use and the cache-clearing restart.
    const generic = hintForBaseUrl('http://10.0.2.2:8000/api/v1');
    const specific = hintForBaseUrl('http://10.0.2.2:8000/api/v1', {
      needsDeviceConfiguration: true,
    });
    expect(specific).not.toBe(generic);
    expect(generic).not.toContain('start:clear');
    expect(specific).toContain('start:clear');
    expect(generic).not.toContain('http://10.0.2.2:8000/api/v1');
  });
});
