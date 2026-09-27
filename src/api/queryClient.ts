/**
 * TanStack Query conventions — the mobile counterpart of
 * `apps/web/src/api/queryClient.ts`.
 *
 * - query keys are declared in `@/api/queryKeys` (never inline arrays);
 * - retries: never retry deterministic client failures (4xx except 408/429);
 * - mutations are not auto-retried (callers decide);
 * - queries stay fresh for 30s; app-focus refetching is off for the
 *   mobile-first shell (revisit when push lands in V1.1).
 */

import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/errors';

function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.status === 408 || error.status === 429) return failureCount < 2;
    if (error.status >= 400 && error.status < 500) return false;
  }
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetryQuery,
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
