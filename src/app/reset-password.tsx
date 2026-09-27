/**
 * Password recovery — honest notice.
 *
 * The API has no password-reset or password-change router, so this screen does
 * **not** present a "send reset link" form. A form that accepts an address and
 * then silently does nothing is worse than saying plainly that the feature does
 * not exist yet.
 *
 * The route is still registered (and linked from the sign-in screen) so the gap
 * is visible and reviewable rather than hidden.
 */
import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { StageNotice } from '@/components/ui/StageNotice';
import { spacing } from '@/theme/tokens';

export default function ResetPasswordScreen() {
  const router = useRouter();

  return (
    <Screen testID="reset-password-screen">
      <View style={styles.stack}>
        <StageNotice
          title="Password recovery"
          description="Resetting a password requires a server endpoint that does not exist yet, so this screen cannot honestly offer one."
          stage="Later stage — account recovery"
          nextStep="In the meantime, sign in again or create a new account. We would rather show an honest “not yet” than a form that silently does nothing."
        />
        <Button
          label="Back to sign in"
          variant="ghost"
          fullWidth
          onPress={() => router.replace('/login' as never)}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
});