/**
 * The ONE centralized API client — the mobile counterpart of
 * `apps/web/src/api/client.ts`. There is no second fetch wrapper in this app.
 *
 * Responsibilities: base URL + JSON, bearer attachment, timeout/abort,
 * consistent error parsing into {@link ApiError}, 401 notification, and
 * correlation-id surfacing. Feature modules call `apiClient` and never
 * re-implement transport concerns.
 */

import { API_ERROR_CODES, ApiError, isApiErrorEnvelope } from '@/api/errors';
import { tokenStorage } from '@/auth/tokenStorage';
import { env } from '@/lib/env';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Attach the bearer token (default true; login/signup/health opt out). */
  auth?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

type UnauthorizedListener = () => void;

class ApiClient {
  private readonly baseUrl: string;
  private readonly unauthorizedListeners = new Set<UnauthorizedListener>();

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  /** Register a 401 listener (the auth provider clears session state). */
  onUnauthorized(listener: UnauthorizedListener): () => void {
    this.unauthorizedListeners.add(listener);
    return () => {
      this.unauthorizedListeners.delete(listener);
    };
  }

  get<T>(path: string, options: Omit<RequestOptions, 'method' | 'body'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'GET' });
  }

  post<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'POST' });
  }

  put<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PUT' });
  }

  patch<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'PATCH' });
  }

  /**
   * `body` is accepted deliberately. `DELETE /users/me` takes a payload (the
   * password plus a typed confirmation phrase), and the contract for that endpoint
   * is a body — so the transport must be able to carry one. Omitting `body` from
   * the accepted options made a correct call a compile error, and the obvious
   * "fix" of moving the confirmations into query parameters would have invented a
   * route the server does not serve.
   */
  delete<T>(path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    return this.request<T>(path, { ...options, method: 'DELETE' });
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, auth = true, timeoutMs = DEFAULT_TIMEOUT_MS } = options;

    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    if (options.signal) {
      if (options.signal.aborted) controller.abort();
      else options.signal.addEventListener('abort', abortFromCaller, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (auth) {
      const token = await tokenStorage.get();
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
        credentials: 'omit',
      });
    } catch (error) {
      if (isAbortError(error)) {
        if (options.signal?.aborted) {
          throw new ApiError({ message: 'Request cancelled.', code: API_ERROR_CODES.aborted });
        }
        throw new ApiError({
          message: 'The request timed out. Please try again.',
          code: API_ERROR_CODES.timeout,
        });
      }
      throw new ApiError({
        // The URL is included deliberately: a bare "network error" on a phone is
        // undiagnosable, and the most common cause is simply the wrong address
        // (emulator alias, or localhost on a real device).
        message: env.needsDeviceConfiguration
          ? `Cannot reach ${this.baseUrl}. This build is on a physical phone, and that ` +
            'address only exists inside an Android emulator. Set EXPO_PUBLIC_API_BASE_URL in ' +
            '.env to this computer\'s LAN address and restart with ' +
            '"npm run start:clear".'
          : `Network request failed. Check your connection to ${this.baseUrl}.`,
        code: API_ERROR_CODES.network,
      });
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abortFromCaller);
    }

    if (response.status === 204) return undefined as T;

    if (!response.ok) {
      const apiError = await this.parseError(response);
      if (apiError.isUnauthenticated) {
        await tokenStorage.clear();
        this.unauthorizedListeners.forEach((listener) => listener());
      }
      throw apiError;
    }

    try {
      return (await response.json()) as T;
    } catch {
      throw new ApiError({
        message: 'The server returned an unexpected response.',
        status: response.status,
        code: API_ERROR_CODES.invalidResponse,
      });
    }
  }

  private async parseError(response: Response): Promise<ApiError> {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (isApiErrorEnvelope(payload)) {
      return new ApiError({
        status: response.status,
        code: payload.error.code as ApiError['code'],
        message: payload.error.message,
        details: payload.error.details ?? null,
        requestId: payload.error.request_id ?? null,
      });
    }

    return new ApiError({
      status: response.status,
      code: API_ERROR_CODES.invalidResponse,
      message: `Request failed (${response.status}).`,
    });
  }
}

/** React Native has no `DOMException`; both runtimes surface `name: 'AbortError'`. */
function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: string }).name === 'AbortError'
  );
}

export const apiClient = new ApiClient(env.apiBaseUrl);
