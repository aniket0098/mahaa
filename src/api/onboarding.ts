/**
 * Onboarding state API — the one call that decides which step a person is on.
 *
 * Binds to `GET /onboarding/state`. This module exists so the wizard has a single
 * authority to ask instead of inferring progress from the profile aggregate,
 * the company list, or a local flag. All three of those would eventually disagree
 * with each other, and a step that disagrees with the server is a step a person
 * can get stuck on.
 */

import { apiClient } from '@/api/client';
import type { OnboardingStateRead } from '@/types/onboarding';

export function fetchOnboardingState(): Promise<OnboardingStateRead> {
  return apiClient.get<OnboardingStateRead>('/onboarding/state');
}
