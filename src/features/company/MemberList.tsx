/**
 * Team member list for the company workspace.
 *
 * Member actions are permission-gated exactly as the server gates them: only an
 * owner or admin may remove someone, and the last owner is never removable, so
 * an owner row carries no Remove control at all.
 *
 * Removing is a two-step confirm, because the server performs a soft removal
 * that a mis-tap should not trigger.
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { fetchCompanyMembers, removeMember } from '@/api/company';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { spacing } from '@/theme/tokens';

export function MemberList({ companyId, canManage }: { companyId: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const members = useQuery({
    queryKey: queryKeys.companyMembers(companyId),
    queryFn: () => fetchCompanyMembers(companyId),
  });

  const remove = useMutation({
    mutationFn: (id: string) => removeMember(companyId, id),
    onSuccess: () => {
      setConfirmingId(null);
      void queryClient.invalidateQueries({ queryKey: queryKeys.companyMembers(companyId) });
    },
  });

  if (members.isPending) return <SkeletonCard lines={2} />;

  if (members.isError) {
    return (
      <StatusBanner
        title="Could not load your team"
        description={
          members.error instanceof Error ? members.error.message : 'The API did not answer.'
        }
        onRetry={() => void members.refetch()}
      />
    );
  }

  if (members.data.length === 0) {
    return (
      <AppText variant="small" tone="secondary">
        No team members yet.
      </AppText>
    );
  }

  return (
    <View style={styles.list}>
      {remove.isError ? (
        <StatusBanner
          title="That member was not removed"
          description={remove.error instanceof ApiError ? remove.error.message : 'Please try again.'}
        />
      ) : null}
      {members.data.map((member) => (
        <View key={member.id} style={styles.row}>
          <View style={styles.text}>
            <AppText variant="body" weight="semibold">
              {member.user.name}
            </AppText>
            <AppText variant="caption" tone="tertiary">
              {member.role} · {member.status}
            </AppText>
          </View>
          {canManage && member.role !== 'owner' ? (
            confirmingId === member.id ? (
              <View style={styles.confirm}>
                <Button label="Cancel" variant="ghost" onPress={() => setConfirmingId(null)} />
                <Button
                  label="Remove"
                  variant="danger"
                  loading={remove.isPending}
                  onPress={() => remove.mutate(member.id)}
                />
              </View>
            ) : (
              <Button
                label="Remove"
                variant="ghost"
                onPress={() => setConfirmingId(member.id)}
              />
            )
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    justifyContent: 'space-between',
  },
  text: { flex: 1, gap: 2 },
  confirm: { flexDirection: 'row', gap: spacing.sm },
});