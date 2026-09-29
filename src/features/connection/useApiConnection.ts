import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';

import { fetchHealth } from '@/api/health';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { hintForBaseUrl } from '@/features/connection/connectionHints';
import { env } from '@/lib/env';

/**
 * Live API connection probe.
 *
 * A phone is the single most likely place to meet a wrong base URL, and a bare
 * "Network request failed" tells the user nothing about which of the three usual
 * causes it was. This probe names the URL the app is actually using and turns a
 * failure into one concrete, correct instruction — so the problem is diagnosable
 * on the device instead of by guesswork.
 *
 * It lives before the auth gate on purpose: the first network call a new user
 * makes is the login request, so that is where the check has to be.
 *
 * The probe is a `useQuery` rather than a hand-rolled `useState` + `useEffect`.
 * That is the same data layer every other screen in this app uses, and it means
 * the in-flight flag comes from the query cache instead of from a synchronous
 * `setState` inside an effect — which is a cascading render, and which the React
 * lint rules correctly reject. `enabled: autoStart` reproduces the old behaviour
 * exactly: probe on mount, or wait for the user to press "Check".
 */

export type ConnectionState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ok'; detail: string }
  | { status: 'failed'; message: string; hint: string };

/** The one place that turns a base URL into a next action. */
export { hintForBaseUrl } from '@/features/connection/connectionHints';

export interface ApiConnectionProbe {
  state: ConnectionState;
  baseUrl: string;
  check: () => void;
}

export function useApiConnection(autoStart = false): ApiConnectionProbe {
  const probe = useQuery({
    queryKey: queryKeys.health,
    queryFn: fetchHealth,
    enabled: autoStart,
    retry: false,
    // The panel is a diagnostic, not a data source: a stale "connected" badge
    // would be misleading, so it is never shown from cache.
    staleTime: 0,
    gcTime: 0,
  });

  const check = useCallback(() => {
    void probe.refetch();
  }, [probe]);

  const baseUrl = env.apiBaseUrl;

  const state: ConnectionState = (() => {
    // Before the user asks for it, the probe has simply not run.
    if (!autoStart && !probe.isFetching && probe.data === undefined && probe.error === null) {
      return { status: 'idle' };
    }
    if (probe.isPending || probe.isFetching) return { status: 'checking' };
    if (probe.data) {
      return {
        status: 'ok',
        detail: `${probe.data.app} v${probe.data.version} · ${probe.data.environment}`,
      };
    }
    if (probe.error) {
      const message =
        probe.error instanceof ApiError
          ? probe.error.message
          : 'The app could not reach the API.';
      return {
        status: 'failed',
        message,
        hint: hintForBaseUrl(baseUrl, {
          needsDeviceConfiguration: env.needsDeviceConfiguration,
        }),
      };
    }
    return { status: 'idle' };
  })();

  return { state, baseUrl, check };
}
