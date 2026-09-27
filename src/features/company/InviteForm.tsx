/**
 * Team invite form.
 *
 * No email is sent in this stage: the server creates the membership as
 * `invited` and the invitee accepts it while signed in. The copy says exactly
 * that, because claiming "invitation sent" would be a claim the backend does
 * not back.
 *
 * An invitation can never mint an owner, so the role list starts at `admin` —
 * ownership changes through an explicit role change by an existing owner.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { inviteMember } from '@/api/company';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/theme/tokens';
import type { InvitableRole } from '@/types/company';
import { ErrorText, type CompanyFormProps } from '@/features/company/CompanyForms';

const INVITABLE: readonly InvitableRole[] = [
  'admin',
  'recruiter',
  'hiring_manager',
  'viewer',
];

export function InviteForm({
  companyId,
  onDone,
  onCancel,
}: CompanyFormProps & { companyId: string }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<InvitableRole>('recruiter');

  const invite = useMutation({
    mutationFn: () => inviteMember(companyId, { email: email.trim(), role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.companyMembers(companyId) });
      onDone();
    },
  });

  return (
    <View style={styles.form}>
      {invite.isError ? <ErrorText error={invite.error} /> : null}
      <TextField
        label="Their account email"
        value={email}
        onChangeText={setEmail}
        placeholder="teammate@company.com"
        autoCapitalize="none"
        keyboardType="email-address"
        required
        helper="They need an existing MahaJob employer account."
      />
      <AppText variant="label" tone="secondary">
        Role
      </AppText>
      <View style={styles.chips}>
        {INVITABLE.map((option) => (
          <Button
            key={option}
            label={option.replace('_', ' ')}
            variant={role === option ? 'primary' : 'secondary'}
            onPress={() => setRole(option)}
          />
        ))}
      </View>
      <AppText variant="caption" tone="tertiary">
        No email is sent in this release. The teammate accepts this invitation from their own
        account once signed in.
      </AppText>
      <Button
        label="Add team member"
        fullWidth
        loading={invite.isPending}
        disabled={email.trim().length < 3}
        onPress={() => invite.mutate()}
      />
      <Button label="Cancel" variant="ghost" fullWidth onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});