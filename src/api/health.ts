/**
 * System API calls — liveness and readiness.
 *
 * `GET /health` deliberately does not touch the database, so it is the correct
 * probe for "is the API reachable at all" on a phone. `GET /ready` verifies the
 * database too and is what the Home screen's connection card reports.
 *
 * Both use `HEALTH_PROBE_TIMEOUT_MS` rather than the client's 15s default,
 * because the production API runs on Render's Free tier and a request that
 * arrives while the service is asleep is held open for the ~34s it takes the
 * container to boot. An 8s budget aborted that wake-up and reported a healthy
 * backend as unreachable; the reasoning, and why genuine failures are still
 * fast, live with the constant in `healthTimeouts.ts`.
 */

import { apiClient } from '@/api/client';
import { HEALTH_PROBE_TIMEOUT_MS } from '@/api/healthTimeouts';
import type { HealthResponse, ReadinessResponse } from '@/types/api';

export function fetchHealth(): Promise<HealthResponse> {
  return apiClient.get<HealthResponse>('/health', { auth: false, timeoutMs: HEALTH_PROBE_TIMEOUT_MS });
}

export function fetchReadiness(): Promise<ReadinessResponse> {
  return apiClient.get<ReadinessResponse>('/ready', { auth: false, timeoutMs: HEALTH_PROBE_TIMEOUT_MS });
}
