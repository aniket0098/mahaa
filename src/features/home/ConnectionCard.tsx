/**
 * Home-screen connection summary.
 *
 * A thin wrapper over the shared `ApiConnectionPanel`, so the authenticated
 * home screen and the pre-auth sign-in screen can never report a different
 * answer for the same question.
 */

import { View } from 'react-native';

import { ApiConnectionPanel } from '@/features/connection/ApiConnectionPanel';

export function ConnectionCard() {
  return (
    <View>
      <ApiConnectionPanel autoStart />
    </View>
  );
}

