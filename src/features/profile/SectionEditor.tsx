/**
 * Section editor — the shared shell for the candidate's list-shaped profile
 * sections (education, experience, projects).
 *
 * The three sections have the same server contract (paged list, create, patch,
 * delete) and the same interaction, so they share one component instead of
 * three near-copies. What differs — the endpoint, the fields, and how a record
 * is summarised — is passed in as configuration, which keeps each screen's
 * unique parts visible in one small file.
 *
 * Every mutation invalidates the profile aggregate as well as its own list, so
 * the completeness percentage on Home reflects the change the moment it lands.
 */

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { BackButton } from '@/components/ui/BackButton';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { colors, spacing } from '@/theme/tokens';
import type { Page } from '@/types/profile';

export interface SectionApi<TRecord, TCreate> {
  list: (limit?: number, offset?: number) => Promise<Page<TRecord>>;
  create: (body: TCreate) => Promise<TRecord>;
  remove: (id: string) => Promise<void>;
}

export interface SectionEditorProps<TRecord, TCreate> {
  testID: string;
  title: string;
  description: string;
  emptyMessage: string;
  api: SectionApi<TRecord, TCreate>;
  queryKey: readonly unknown[];
  /** Renders one record. `onRemove` starts the delete confirmation for it. */
  render: (item: TRecord) => ReactNode;
  /** The create form. `submit` is disabled while the mutation is in flight. */
  form: (args: {
    submit: (body: TCreate) => void;
    saving: boolean;
  }) => ReactNode;
}

export function SectionEditor<TRecord extends { id: string }, TCreate>({
  testID,
  title,
  description,
  emptyMessage,
  api,
  queryKey,
  render,
  form,
}: SectionEditorProps<TRecord, TCreate>) {
  const queryClient = useQueryClient();
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const list = useQuery({ queryKey, queryFn: () => api.list(100, 0) });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey });
    // The aggregate drives the completeness percentage, so it must refresh too.
    void queryClient.invalidateQueries({ queryKey: queryKeys.profile });
  };

  const create = useMutation({
    mutationFn: (body: TCreate) => api.create(body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: invalidate,
  });

  const error = create.error ?? remove.error;

  return (
    <Screen testID={testID}>
      <View style={styles.stack}>
        {/*
          These screens are detail routes inside a headerless `Tabs` shell, so the
          back control is what gets the user off them at all.
        */}
        <BackButton />
        <AppText variant="h1" accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="body" tone="secondary">
          {description}
        </AppText>

        {error ? (
          <StatusBanner
            title="That change did not save"
            description={error instanceof ApiError ? error.message : 'Please try again.'}
          />
        ) : null}

        {list.isPending ? (
          <SkeletonCard lines={3} />
        ) : list.isError ? (
          <StatusBanner
            title={`Could not load your ${title.toLowerCase()}`}
            description={list.error instanceof Error ? list.error.message : 'The API did not answer.'}
            onRetry={() => void list.refetch()}
          />
        ) : list.data && list.data.items.length === 0 ? (
          <Card>
            <AppText variant="small" tone="secondary">
              {emptyMessage}
            </AppText>
          </Card>
        ) : list.data ? (
          list.data.items.map((item) => {
            const isConfirming = confirmingId === item.id;
            return (
              <Card key={item.id} style={styles.card}>
                {render(item)}
                {isConfirming ? (
                  <View style={styles.confirm}>
                    <AppText variant="caption" tone="secondary">
                      Delete this entry? This cannot be undone.
                    </AppText>
                    <View style={styles.confirmActions}>
                      <Button label="Cancel" variant="ghost" onPress={() => setConfirmingId(null)} />
                      <Button
                        label="Delete"
                        variant="danger"
                        loading={remove.isPending}
                        onPress={() => remove.mutate(item.id)}
                      />
                    </View>
                  </View>
                ) : (
                  <Button
                    label="Remove"
                    variant="ghost"
                    onPress={() => setConfirmingId(item.id)}
                  />
                )}
              </Card>
            );
          })
        ) : null}

        <Card style={styles.card}>
          <SectionHeader title={`Add to your ${title.toLowerCase()}`} />
          {form({ submit: (body) => create.mutate(body), saving: create.isPending })}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  card: { gap: spacing.md },
  confirm: {
    borderTopColor: colors.colorBorder,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  confirmActions: { flexDirection: 'row', gap: spacing.md },
});
