import { describe, expect, it } from 'vitest';

import {
  DEFAULT_API_BASE_URL,
  hostKindFor,
  resolveApiBaseUrl,
} from '@/lib/apiBaseUrl';

describe('resolveApiBaseUrl', () => {
  it('uses the Android emulator host alias by default', () => {
    // `localhost` inside an emulator is the emulator itself, so the default must
    // point at the host machine.
    expect(resolveApiBaseUrl(undefined, 'android').baseUrl).toBe(
      'http://10.0.2.2:8000/api/v1',
    );
  });

  it('uses loopback for the iOS simulator, which shares the host network', () => {
    expect(resolveApiBaseUrl(undefined, 'ios').baseUrl).toBe('http://localhost:8000/api/v1');
    expect(resolveApiBaseUrl(undefined, 'web').baseUrl).toBe('http://localhost:8000/api/v1');
  });

  it('treats an empty or whitespace value as unset', () => {
    expect(resolveApiBaseUrl('', 'ios').baseUrl).toBe(DEFAULT_API_BASE_URL.ios);
    expect(resolveApiBaseUrl('   ', 'ios').baseUrl).toBe(DEFAULT_API_BASE_URL.ios);
    expect(resolveApiBaseUrl('   ', 'ios').source).toBe('platform-default');
  });

  it('prefers the configured value over the platform default', () => {
    const resolved = resolveApiBaseUrl('https://api.mahajob.test/api/v1', 'android');
    expect(resolved.baseUrl).toBe('https://api.mahajob.test/api/v1');
    expect(resolved.source).toBe('configured');
  });

  it('strips trailing slashes so paths never double up', () => {
    expect(resolveApiBaseUrl('https://api.mahajob.test/api/v1/', 'ios').baseUrl).toBe(
      'https://api.mahajob.test/api/v1',
    );
  });

  it('trims surrounding whitespace', () => {
    expect(resolveApiBaseUrl('  https://api.mahajob.test/api/v1  ', 'ios').baseUrl).toBe(
      'https://api.mahajob.test/api/v1',
    );
  });

  it('fails fast on a malformed URL instead of issuing broken requests', () => {
    expect(() => resolveApiBaseUrl('not-a-url', 'ios')).toThrow(/Invalid EXPO_PUBLIC_API_BASE_URL/);
  });

  it('rejects a non-http scheme', () => {
    expect(() => resolveApiBaseUrl('ftp://example.test/api/v1', 'ios')).toThrow(
      /expected an http\(s\) URL/,
    );
  });

  it('validates without `new URL`, which behaves differently in React Native', () => {
    // React Native's `URL` is a hand-rolled class that never throws, so a
    // try/catch around `new URL()` silently accepts junk on a device while the
    // Node unit test passes. String validation is identical in both runtimes.
    expect(() => resolveApiBaseUrl('not-a-url', 'ios')).toThrow();
    expect(() => resolveApiBaseUrl('api.mahajob.test/api/v1', 'ios')).toThrow(
      /Invalid EXPO_PUBLIC_API_BASE_URL/,
    );
    expect(() => resolveApiBaseUrl('http://', 'ios')).toThrow(/Invalid EXPO_PUBLIC_API_BASE_URL/);
  });
});

describe('resolveApiBaseUrl — device configuration', () => {
  it('flags the silent emulator-alias fallback on a physical phone', () => {
    // This is the regression that produced "Network request failed" while Chrome
    // could reach the API: the env var never reached the bundle, so the app fell
    // back to an address that cannot exist on real hardware.
    const resolved = resolveApiBaseUrl(undefined, 'android', true);
    expect(resolved.baseUrl).toBe('http://10.0.2.2:8000/api/v1');
    expect(resolved.source).toBe('platform-default');
    expect(resolved.hostKind).toBe('emulator');
    expect(resolved.needsDeviceConfiguration).toBe(true);
  });

  it('stays quiet for that same fallback inside an emulator', () => {
    const resolved = resolveApiBaseUrl(undefined, 'android', false);
    expect(resolved.hostKind).toBe('emulator');
    expect(resolved.needsDeviceConfiguration).toBe(false);
  });

  it('does not flag a correctly configured LAN address on a phone', () => {
    const resolved = resolveApiBaseUrl(
      'http://192.168.56.1:8000/api/v1',
      'android',
      true,
    );
    expect(resolved.source).toBe('configured');
    expect(resolved.hostKind).toBe('lan');
    expect(resolved.needsDeviceConfiguration).toBe(false);
  });

  it('leaves an explicitly configured loopback URL alone — the user chose it', () => {
    // A visible, deliberate setting is not a silent misconfiguration, so it must
    // not be relabelled as one.
    const resolved = resolveApiBaseUrl('http://localhost:8000/api/v1', 'android', true);
    expect(resolved.source).toBe('configured');
    expect(resolved.hostKind).toBe('loopback');
    expect(resolved.needsDeviceConfiguration).toBe(false);
  });

  it('flags an iOS device that fell back to loopback', () => {
    const resolved = resolveApiBaseUrl(undefined, 'ios', true);
    expect(resolved.hostKind).toBe('loopback');
    expect(resolved.needsDeviceConfiguration).toBe(true);
  });
});

describe('hostKindFor', () => {
  it('classifies the emulator-only alias', () => {
    expect(hostKindFor('http://10.0.2.2:8000/api/v1')).toBe('emulator');
  });

  it('classifies loopback hosts', () => {
    expect(hostKindFor('http://localhost:8000/api/v1')).toBe('loopback');
    expect(hostKindFor('http://127.0.0.1:8000/api/v1')).toBe('loopback');
    expect(hostKindFor('http://[::1]:8000/api/v1')).toBe('loopback');
  });

  it('classifies a real LAN address', () => {
    expect(hostKindFor('http://192.168.56.1:8000/api/v1')).toBe('lan');
    expect(hostKindFor('https://api.mahajob.in/api/v1')).toBe('lan');
  });

  it('is not fooled by a host that merely contains the emulator alias', () => {
    expect(hostKindFor('http://10.0.2.20:8000/api/v1')).toBe('lan');
  });
});
