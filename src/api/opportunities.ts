/**
 * Opportunities API calls — binds to `/opportunities` in
 * `apps/api/app/api/v1/endpoints/opportunities.py`.
 */

import { apiClient } from '@/api/client';
import type { Opportunity, OpportunityType, WorkMode } from '@/types/opportunity';
import type { FastApiPage } from '@/types/story';

export interface OpportunityFilterParams {
  type?: OpportunityType;
  workMode?: WorkMode;
  query?: string;
  page?: number;
  pageSize?: number;
}

export async function fetchOpportunities(
  params?: OpportunityFilterParams,
): Promise<FastApiPage<Opportunity>> {
  const query = new URLSearchParams();
  if (params?.type) query.set('type', params.type);
  if (params?.workMode) query.set('work_mode', params.workMode);
  if (params?.query) query.set('q', params.query);
  if (params?.page) query.set('page', String(params.page));
  if (params?.pageSize) query.set('page_size', String(params.pageSize));

  const queryString = query.toString();
  const path = queryString ? `/opportunities?${queryString}` : '/opportunities';

  return apiClient.get<FastApiPage<Opportunity>>(path);
}

export async function fetchOpportunity(opportunityId: string): Promise<Opportunity> {
  return apiClient.get<Opportunity>(`/opportunities/${opportunityId}`);
}
