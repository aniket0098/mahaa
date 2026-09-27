/**
 * Employer company workspace — real data from the `/companies` router.
 *
 * The backend supports this domain (create, read, update, members, verification
 * request), so this screen is genuinely functional rather than a stage notice.
 * Two server rules are respected here:
 *
 *  - **The caller cannot choose their own role.** Creating a company makes the
 *    creator its owner, server-side, so no role field is offered.
 *  - **Verification is request-only.** The server records the request and moves
 *    the status to `pending`; document review is a later stage, so the UI shows
 *    the server's own note and never claims "verified".
 */

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { fetchMyCompanies, requestVerification } from '@/api/company';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Screen } from '@/components/ui/Screen';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { SkeletonCard } from '@/components/ui/Skeleton';
import { StatusBanner } from '@/components/ui/StatusBanner';
import {
  CompanyActions,
  CreateCompanyForm,
  Detail,
  EditCompanyForm,
} from '@/features/company/CompanyForms';
import { InviteForm } from '@/features/company/InviteForm';
import { MemberList } from '@/features/company/MemberList';
import { spacing } from '@/theme/tokens';

export default function CompanyScreen() {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<'view' | 'create' | 'edit' | 'invite'>('view');
  const [notice, setNotice] = useState<string | null>(null);

  const companies = useQuery({ queryKey: queryKeys.myCompanies, queryFn: fetchMyCompanies });
  const active = companies.data?.[0];

  const verify = useMutation({
    mutationFn: () => requestVerification(active!.company.id),
    onSuccess: (result) => {
      setNotice(result.note);
      void queryClient.invalidateQueries({ queryKey: queryKeys.myCompanies });
    },
  });

  if (companies.isPending) {
    return (
      <Screen testID="company-screen">
        <SkeletonCard lines={4} />
      </Screen>
    );
  }

  if (companies.isError) {
    return (
      <Screen testID="company-screen">
        <StatusBanner
          title="Could not load your company"
          description={
            companies.error instanceof Error ? companies.error.message : 'The API did not answer.'
          }
          onRetry={() => void companies.refetch()}
        />
      </Screen>
    );
  }

  if (!active) {
    return (
      <Screen testID="company-screen">
        <View style={styles.stack}>
          <AppText variant="h1" accessibilityRole="header">
            Set up your company
          </AppText>
          <AppText variant="body" tone="secondary">
            Create a stable company profile before your team starts hiring. You become its owner.
          </AppText>
          {mode === 'create' ? (
            <CreateCompanyForm onDone={() => setMode('view')} onCancel={() => setMode('view')} />
          ) : (
            <Button label="Set up company" fullWidth onPress={() => setMode('create')} />
          )}
        </View>
      </Screen>
    );
  }

  const { company } = active;
  const canManage = active.role === 'owner' || active.role === 'admin';

  return (
    <Screen testID="company-screen">
      <View style={styles.stack}>
        <AppText variant="h1" accessibilityRole="header">
          {company.name}
        </AppText>
        <AppText variant="body" tone="secondary">
          {company.industry ?? 'Industry not added'}
        </AppText>

        {notice ? (
          <StatusBanner title="Verification requested" description={notice} tone="info" />
        ) : null}
        {verify.isError ? (
          <StatusBanner
            title="Could not request verification"
            description={
              verify.error instanceof ApiError ? verify.error.message : 'Please try again.'
            }
          />
        ) : null}

        <Card style={styles.card}>
          <SectionHeader title="Company profile" />
          <Detail label="Your role" value={active.role} />
          <Detail label="Verification" value={company.verification_status} />
          <Detail label="Location" value={company.location ?? 'Not added'} />
          <Detail label="Company size" value={company.company_size ?? 'Not added'} />
          <Detail label="Website" value={company.website ?? 'Not added'} />
          {mode === 'edit' ? (
            <EditCompanyForm
              company={company}
              onDone={() => setMode('view')}
              onCancel={() => setMode('view')}
            />
          ) : canManage ? (
            <CompanyActions
              company={company}
              onEdit={() => setMode('edit')}
              onVerify={() => verify.mutate()}
              verifying={verify.isPending}
            />
          ) : (
            <AppText variant="caption" tone="tertiary">
              Only an owner or admin can edit this company.
            </AppText>
          )}
        </Card>
        <Card style={styles.card}>
          <SectionHeader title="Team members" />
          {mode === 'invite' ? (
            <InviteForm
              companyId={company.id}
              onDone={() => setMode('view')}
              onCancel={() => setMode('view')}
            />
          ) : (
            <>
              <MemberList companyId={company.id} canManage={canManage} />
              {canManage ? (
                <Button
                  label="Invite a team member"
                  variant="secondary"
                  fullWidth
                  onPress={() => setMode('invite')}
                />
              ) : null}
            </>
          )}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.lg },
  card: { gap: spacing.md },
});