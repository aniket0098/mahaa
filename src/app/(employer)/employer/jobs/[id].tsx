/**
 * Manage a posted job.
 *
 * A real dynamic route: the id is read from the path and echoed back, so the
 * deep link is verifiably wired to the right screen. The body is an honest
 * notice because the opportunities domain does not exist on the server yet.
 */
import { useLocalSearchParams } from 'expo-router';

import { StageScreen } from '@/features/stages/StageScreen';

export default function ManageEmployerJobScreen() {
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  return (
    <StageScreen
      title="Manage this role"
      description={
        id
          ? `Role ${id}: edit the details, and pause, close, or archive it.`
          : 'Edit the details, and pause, close, or archive the role.'
      }
      stage="Stage 7 — opportunity lifecycle"
      nextStep="This route resolves the id from the path and is ready for a single opportunity as soon as the API exposes one."
    />
  );
}