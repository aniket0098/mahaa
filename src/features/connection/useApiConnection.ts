import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchHealth } from '@/api/health';
import { ApiError } from '@/api/errors';
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
  const [state, setState] = useState<ConnectionState>({ status: 'idle' });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const check = useCallback(() => {
    setState({ status: 'checking' });
    fetchHealth()
      .then((health) => {
        if (!mounted.current) return;
        setState({
          status: 'ok',
          detail: `${health.app} v${health.version} · ${health.environment}`,
        });
      })
      .catch((error: unknown) => {
        if (!mounted.current) return;
        const message =
          error instanceof ApiError ? error.message : 'The app could not reach the API.';
        setState({
          status: 'failed',
          message,
          hint: hintForBaseUrl(env.apiBaseUrl, {
            needsDeviceConfiguration: env.needsDeviceConfiguration,
          }),
        });
      });
  }, []);

  useEffect(() => {
    if (autoStart && state.status === 'idle') check();
  }, [autoStart, check, state.status]);

  return { state, baseUrl: env.apiBaseUrl, check };
}
