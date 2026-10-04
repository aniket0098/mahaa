/**
 * The body of the onboarding wizard for one step.
 *
 * Split out of the host screen so every step is chosen by a plain `switch`, with
 * the data each step needs fetched here rather than in the host. That matters:
 * the host cannot call hooks conditionally, so a host that owned the queries would
 * either break the rules of hooks or need a component per data shape anyway. Here
 * every branch is either a step component (which owns its own hooks) or a plain
 * element, so the rules hold no matter which step is on screen.
 *
 * The data this needs is deliberately small ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â the stored identity, the caller's
 * company, the caller's institution ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â and each is read from the same cached query
 * the step itself will read, so opening a step does not double-fetch.
 */

import { useQuery } from '@tanstack/react-query';

import { fetchMyCompanies, requestVerification } from '@/api/company';
import { fetchMyInstitutions, requestInstitutionVerification } from '@/api/institutions';
import { fetchProfile } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Skeleton } from '@/components/ui/Skeleton';
import { BasicsStep } from '@/features/onboarding/BasicsStep';
import { CollegeContactStep } from '@/features/onboarding/CollegeContactStep';
import { CompanyStep } from '@/features/onboarding/CompanyStep';
import { AboutYouStep } from '@/features/onboarding/AboutYouStep';
import { InstitutionStep } from '@/features/onboarding/InstitutionStep';
import { PhotoStep } from '@/features/onboarding/PhotoStep';
import { ProgramsStep } from '@/features/onboarding/ProgramsStep';
import { RecruiterProfileStep } from '@/features/onboarding/RecruiterProfileStep';
import { ReviewStep } from '@/features/onboarding/ReviewStep';
import { VerificationStep } from '@/features/onboarding/VerificationStep';
import { REVIEW_STEP_KEY } from '@/features/onboarding/onboardingSteps';

export interface StepProps {
  onNext: (save?: () => Promise<unknown>) => void;
  busy: boolean;
  canGoBack: boolean;
  onBack: () => void;
}

export interface OnboardingStepViewProps extends StepProps {
  stepKey: string;
  role: string | undefined;
  /** The host's finish handler, so only the host can leave the wizard. */
  onFinish: () => void | Promise<void>;
}

export function OnboardingStepView(props: OnboardingStepViewProps) {
  switch (props.stepKey) {
    case 'basics':
      return <BasicsView {...props} />;
    // Education and skills, merged into one screen. The two separate steps are
    // gone from the wizard, not from the product: `/profile/education` and
    // `/profile/skills` are unchanged and still edit the same rows.
    case 'about':
      return <AboutYouStep {...props} />;
    case 'photo':
      return <PhotoStep {...props} />;
    case 'company':
      return <CompanyStep {...props} />;
    case 'institution':
      return <InstitutionStep {...props} />;
    case 'programs':
      return <ProgramsView {...props} />;
    case 'profile':
      return props.role === 'college' ? (
        <CollegeContactStep {...props} />
      ) : (
        <RecruiterProfileStep {...props} />
      );
    case 'verification':
      return props.role === 'college' ? (
        <CollegeVerificationView {...props} />
      ) : (
        <EmployerVerificationView {...props} />
      );
    case REVIEW_STEP_KEY:
      return <ReviewStep {...props} onFinish={props.onFinish} />;
    default:
      // An unknown key still lands on review rather than a blank screen. Failing
      // open into the finish step is safe precisely because review re-reads the
      // server's state and refuses to finish while anything is outstanding.
      return <ReviewStep {...props} onFinish={props.onFinish} />;
  }
}

function BasicsView({ onNext, busy, canGoBack, onBack }: StepProps) {
  const profile = useQuery({ queryKey: queryKeys.profile, queryFn: fetchProfile });
  if (profile.isLoading) return <Skeleton height={160} />;
  const identity = profile.data?.identity;
  if (!identity) {
    return (
      <AppText variant="body" tone="secondary">
        Your profile could not be loaded. Go back a step and try again.
      </AppText>
    );
  }
  return (
    <BasicsStep
      identity={identity}
      onNext={onNext}
      busy={busy}
      canGoBack={canGoBack}
      onBack={onBack}
    />
  );
}

/** Programs need the institution id, which only exists once step 1 has saved. */
function ProgramsView({ onNext, busy, canGoBack, onBack }: StepProps) {
  const institutions = useQuery({
    queryKey: queryKeys.myInstitutions,
    queryFn: fetchMyInstitutions,
  });
  if (institutions.isLoading) return <Skeleton height={160} />;
  return (
    <ProgramsStep
      institutionId={institutions.data?.[0]?.institution.id ?? null}
      onNext={onNext}
      busy={busy}
      canGoBack={canGoBack}
      onBack={onBack}
    />
  );
}

function EmployerVerificationView({ onNext, busy, canGoBack, onBack }: StepProps) {
  const companies = useQuery({ queryKey: queryKeys.myCompanies, queryFn: fetchMyCompanies });
  if (companies.isLoading) return <Skeleton height={160} />;
  const company = companies.data?.[0]?.company;
  return (
    <VerificationStep
      subject="Company verification"
      target={company ? { id: company.id, status: company.verification_status } : null}
      onRequest={() =>
        company
          ? requestVerification(company.id)
          : Promise.reject(new Error('Save your company before requesting verification.'))
      }
      invalidates={[queryKeys.myCompanies]}
      onNext={onNext}
      busy={busy}
      canGoBack={canGoBack}
      onBack={onBack}
    />
  );
}

function CollegeVerificationView({ onNext, busy, canGoBack, onBack }: StepProps) {
  const institutions = useQuery({
    queryKey: queryKeys.myInstitutions,
    queryFn: fetchMyInstitutions,
  });
  if (institutions.isLoading) return <Skeleton height={160} />;
  const institution = institutions.data?.[0]?.institution;
  return (
    <VerificationStep
      subject="Institution verification"
      target={institution ? { id: institution.id, status: institution.verification_status } : null}
      onRequest={() =>
        institution
          ? requestInstitutionVerification(institution.id)
          : Promise.reject(new Error('Save your institution before requesting verification.'))
      }
      invalidates={[queryKeys.myInstitutions]}
      onNext={onNext}
      busy={busy}
      canGoBack={canGoBack}
      onBack={onBack}
    />
  );
}

