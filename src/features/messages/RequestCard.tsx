/**
 * RequestCard — one incoming message request in the Requests tab.
 *
 * Renders the server's sender summary field for field: a real profile image with
 * an initials fallback, the display name, the professional-detail line (only when
 * the server actually returned one), the request note, and a relative time. The
 * two actions — Accept and Reject — are always enabled unless *this* card is the
 * one whose action is on the wire, which disables both so a double submit is
 * impossible.
 *
 * A failed action shows the server's message inline next to the buttons rather
 * than as a toast, and the card is never removed here: the list removes it only
 * after the invalidation refetch confirms the server accepted the transition.
 */

import { StyleSheet, View } from 'react-native';

import type { MessageRequest } from '@/api/messageRequests';
import { AppText } from '@/components/ui/AppText';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  formatRequestTime,
  requestContextLine,
} from '@/features/messages/messageSections';
import { spacing } from '@/theme/tokens';

export interface RequestCardProps {
  request: MessageRequest;
  /** True while this card's accept/reject is on the wire. */
  busy: boolean;
  /** The inline error message for this card, or null. */
  error: string | null;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
}

export function RequestCard({ request, busy, error, onAccept, onReject }: RequestCardProps) {
  const sender = request.sender;
  const context = requestContextLine(sender.designation);

  return (
    <Card testID={`request-card-${request.id}`} style={styles.card}>
      <View style={styles.header}>
        <Avatar name={sender.name} src={sender.avatar_url} size={56} />
        <View style={styles.identity}>
          <AppText variant="body" weight="semibold" numberOfLines={1}>
            {sender.name}
          </AppText>
          {context ? (
            <AppText variant="caption" tone="secondary" numberOfLines={1}>
              {context}
            </AppText>
          ) : null}
          <AppText variant="caption" tone="tertiary">
            {formatRequestTime(request.created_at)}
          </AppText>
        </View>
      </View>

      {request.note ? (
        <AppText variant="small" tone="secondary" style={styles.note}>
          {request.note}
        </AppText>
      ) : null}

      {error ? (
        <AppText variant="caption" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}

      <View style={styles.actions}>
        <Button
          label="Accept"
          onPress={() => onAccept(request.id)}
          disabled={busy}
          loading={busy}
          style={styles.action}
        />
        <Button
          label="Reject"
          variant="secondary"
          onPress={() => onReject(request.id)}
          disabled={busy}
          style={styles.action}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  header: { alignItems: 'center', flexDirection: 'row', gap: spacing.md },
  identity: { flex: 1, gap: 2 },
  note: { lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing.md },
  action: { flex: 1 },
});
