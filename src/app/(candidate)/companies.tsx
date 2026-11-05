/**
 * Companies (Messages section) — a dedicated destination reached from the
 * Messages screen's Companies tab. Kept as an honest later-stage notice: company
 * conversations land in a later phase, so no recruiter identities or company
 * threads are invented here. The Back control is provided by `StageScreen`.
 */

import { StageScreen } from '@/features/stages/StageScreen';

export default function CompaniesScreen() {
  return (
    <StageScreen
      title="Companies"
      description="Message threads with companies you follow or have applied to will appear here."
      stage="Message section - Companies"
      nextStep="The company messaging view is built in a later phase. It will keep company conversations distinct from individual ones, using only real company data."
    />
  );
}
