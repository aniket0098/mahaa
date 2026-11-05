/**
 * `PersonConnectionAction` — the one button (or state pill) that stands for the
 * caller's relationship to another person. Used by the public profile screen so
 * the action is byte-for-byte the same logic as a Home suggestion row.
 *
 * It is a thin view over `usePersonConnection`: the hook decides the state from
 * the caller's real `/connections` rows, and this component only maps that state
 * to a control.
 *
 *   none              -> "Connect"      (fires a request)
 *   outgoing_pending  -> "Requested"    (tap cancels / withdraws)
 *   incoming_pending  -> "Accept"       (tap accepts; "Decline" beside it)
 *   connected         -> "Connected"    (informational)
 *   self              -> "This is you"  (informational)
 *
 * Nothing is optimistically flipped to a success state: the label only changes
 * after the server confirms, and a failure leaves a persistent, retryable banner.
 */

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { usePersonConnection } from '@/features/people/usePersonConnection';
import { spacing } from '@/theme/tokens';

export interface PersonConnectionActionProps {
  publicId: string;
  selfPublicId: string | null;
}

export function PersonConnectionAction({ publicId, selfPublicId }: PersonConnectionActionProps) {
  const connection = usePersonConnection(publicId, selfPublicId);

  return (
    <View style={styles.wrap}>
      {connection.error ? (
        <StatusBanner
          title={connection.error}
          description="Nothing changed on the server. Try again."
          onRetry={connection.dismissError}
        />
      ) : null}

      {connection.kind === 'send' ? (
        <Button
          label={connection.label}
          fullWidth
          loading={connection.isBusy}
          disabled={connection.isBusy}
          accessibilityHint="Sends a connection request to this person"
          onPress={connection.send}
        />
      ) : null}

      {connection.kind === 'cancel' ? (
        <Button
          label="Withdraw request"
          variant="ghost"
          fullWidth
          loading={connection.isBusy}
          disabled={connection.isBusy}
          accessibilityHint="Cancels the request you sent"
          onPress={connection.cancel}
        />
      ) : null}

      {connection.kind === 'respond' ? (
        <View style={styles.respondRow}>
          <Button
            label="Accept"
            style={styles.respondButton}
            loading={connection.isBusy}
            disabled={connection.isBusy}
            accessibilityHint="Accepts this connection request"
            onPress={connection.accept}
          />
          <Button
            label="Decline"
            variant="ghost"
            style={styles.respondButton}
            disabled={connection.isBusy}
            accessibilityHint="Declines this connection request"
            onPress={connection.decline}
          />
        </View>
      ) : null}

      {connection.kind === 'none' ? (
        <AppText variant="small" tone={connection.state === 'connected' ? 'success' : 'tertiary'}>
          {connection.label}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  respondRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  respondButton: {
    flex: 1,
  },
});