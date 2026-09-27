/**
 * Job details.
 *
 * A real dynamic route: the id comes from the path, and it is echoed back so a
 * deep link is verifiably wired to the right screen. The detail body is an
 * honest notice because the API has no opportunities router — a job detail
 * screen with fabricated role details would be the single worst place to
 * invent content.
 */
import { useLocalSearchParams } from 'expo-router';

import { StageScreen } from '@/features/stages/StageScreen';

export default function JobDetailsScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  return (
    <StageScreen
      title="Job details"
      description={
        id
          ? `Opportunity ${id}: the full description, requirements, and how to apply will live here.`
          : 'The full description, requirements, and how to apply will live here.'
      }
      stage="Stage 6 — opportunities"
      nextStep="This route resolves the id from the path, so it is ready to read a single opportunity as soon as the API exposes one."
    />
  );
}