/**
 * Resume types — mirrors `apps/api/app/schemas/resumes.py`.
 *
 * A resume is a **version**: a server-generated frozen snapshot of the
 * candidate's structured profile data. There is no upload and no PDF, and the
 * client never sends snapshot content — only a label and which version is the
 * default.
 */

/** `ResumeSummary` — the list item; deliberately carries no snapshot body. */
export interface ResumeSummary {
  id: string;
  label: string;
  version_no: number;
  is_default: boolean;
  source_profile_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** `ResumeDetail` — the summary plus the frozen snapshot itself. */
export interface ResumeDetail extends ResumeSummary {
  snapshot: Record<string, unknown>;
}