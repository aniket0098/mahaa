/**
 * Types mirroring the backend `opportunities` domain.
 *
 * Source of truth: `apps/api/app/schemas/opportunities.py`. Keep in strict parity.
 */

export type OpportunityType = "job" | "internship" | "apprenticeship" | "project_gig";
export type WorkMode = "remote" | "hybrid" | "onsite";
export type EmploymentType = "full_time" | "part_time" | "internship" | "contract";
export type CompPeriod = "hour" | "month" | "year";

export interface CompanySnapshot {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly industry?: string | null;
  readonly location?: string | null;
  readonly website?: string | null;
  readonly logo_url?: string | null;
  readonly verification_status?: string | null;
}

export interface OpportunityRequirement {
  readonly id: string;
  readonly skill_id: string;
  readonly skill_name: string;
  readonly kind: "required" | "preferred";
  readonly min_level: string | null;
  readonly importance: string;
}

export interface Opportunity {
  readonly id: string;
  readonly company_id: string;
  readonly title: string;
  readonly slug: string;
  readonly opportunity_type: OpportunityType;
  readonly status: string;
  readonly visibility: string;
  readonly description: string | null;
  readonly responsibilities: string | null;
  readonly requirements_text: string | null;
  readonly work_mode: WorkMode | null;
  readonly location: string | null;
  readonly employment_type: EmploymentType | null;
  readonly comp_min: number | null;
  readonly comp_max: number | null;
  readonly comp_currency: string | null;
  readonly comp_period: CompPeriod | null;
  readonly openings: number | null;
  readonly deadline: string | null;
  readonly start_date: string | null;
  readonly company: CompanySnapshot;
  readonly requirements: readonly OpportunityRequirement[];
  readonly published_at: string | null;
  readonly is_saved?: boolean | null;
  readonly my_application_id?: string | null;
}
