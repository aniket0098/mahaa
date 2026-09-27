/**
 * API contract types mirroring the backend error envelope (docs/API.md) and the
 * FastAPI schemas the mobile client actually consumes today.
 */

/** Backend error envelope: `app/core/errors.py` + `docs/API.md`. */
export interface ApiErrorDetail {
  field?: string | null;
  message: string;
  type?: string | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: ApiErrorDetail[] | null;
  request_id?: string | null;
}

export interface ApiErrorEnvelope {
  error: ApiErrorBody;
}

/** `GET /api/v1/health` — liveness. */
export interface HealthResponse {
  status: string;
  app: string;
  version: string;
  environment: string;
}

/** `GET /api/v1/ready` — readiness (503 when the database is unreachable). */
export interface ReadinessResponse {
  status: string;
  checks: Record<string, string>;
}

export interface PageParams {
  limit?: number;
  offset?: number;
}
