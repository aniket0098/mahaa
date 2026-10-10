/**
 * Discover — the candidate opportunity screen (the `/jobs` tab).
 *
 * This was a `StageScreen` placeholder; it is now the real thing. The route,
 * tab label ("Discover"), icon and position are unchanged. The screen itself
 * is now a thin delegate: the pinned title + search header and the paged feed
 * both live in `@/features/jobs/OpportunityList`, which reads the real
 * `GET /opportunities` through the central client. Nothing here invents a
 * listing, a count, or a filter the backend does not serve.
 */

import { OpportunityList } from '@/features/jobs/OpportunityList';

export default function CandidateJobsScreen() {
  return <OpportunityList />;
}