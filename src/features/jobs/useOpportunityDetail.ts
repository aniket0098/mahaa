/**
 * `useOpportunityDetail` — one opportunity by id, for the detail route.
 *
 * A plain `useQuery` over the real `GET /opportunities/{id}` through
 * `fetchOpportunity`. It stays disabled until there is an id, so a malformed
 * deep link never fires a request for the literal string "undefined". A 404
 * (unknown, draft, or non-public id) arrives as an {@link ApiError} the route
 * renders as a not-found state, not as a crash or a fabricated record.
 */

import { useQuery } from '@tanstack/react-query';

import { fetchOpportunity } from '@/api/opportunities';
import { queryKeys } from '@/api/queryKeys';

export function useOpportunityDetail(opportunityId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.opportunity(opportunityId ?? ''),
    queryFn: () => fetchOpportunity(opportunityId as string),
    enabled: Boolean(opportunityId),
  });
}
