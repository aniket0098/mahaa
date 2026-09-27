/**
 * System API calls — liveness and readiness.
 *
 * `GET /health` deliberately does not touch the database, so it is the correct
 * probe for "is the API reachable at all" on a phone. `GET /ready` verifies the
 * database too and is what the Home screen's connection card reports.
 */

import { apiClient } from '@/api/client';
import type { HealthResponse, ReadinessResponse } from '@/types/api';

export function fetchHealth(): Promise<HealthResponse> {
  return apiClient.get<HealthResponse>('/health', { auth: false, timeoutMs: 8000 });
}

export function fetchReadiness(): Promise<ReadinessResponse> {
  return apiClient.get<ReadinessResponse>('/ready', { auth: false, timeoutMs: 8000 });
}
