/**
 * Certificates — real CRUD against `/profile/certifications`.
 *
 * Only the fields the server accepts are offered: `title` and `issuer` are
 * required, `issued_on`/`expires_on` are ISO dates, and `verification_url` is
 * checked as http(s) by the server's `HttpUrlStr`. Dates are validated here
 * first so a typo produces a disabled control rather than a 422.
 *
 * There is no image field on a certification, so no upload control is shown.
 */
import { useState } from 'react';
import { View } from 'react-native';

import { certificationsApi } from '@/api/profile';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { SectionEditor } from '@/features/profile/SectionEditor';
import { credentialDate } from '@/features/profile/profileModel';
import { styles } from '@/features/profile/profileStyles';
import type { CertificationCreate, CertificationRead } from '@/types/profile';

/** `YYYY-MM-DD`, the only shape `date` accepts. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default function CertificationsScreen() {
  return (
    <SectionEditor<CertificationRead, CertificationCreate>
      testID="certifications-screen"
      title="Certificates"
      description="Credentials you have earned, with the body that issued each one."
      emptyMessage="No certificates yet. Adding one raises your profile completeness."
      api={certificationsApi}
      queryKey={queryKeys.certifications}
      render={(item) => (
        <View style={styles.entry}>
          <AppText variant="body" weight="semibold">
            {item.title}
          </AppText>
          <AppText variant="small" tone="secondary">
            {item.issuer}
          </AppText>
          {credentialDate(item) ? (
            <AppText variant="caption" tone="tertiary">
              {credentialDate(item)}
            </AppText>
          ) : null}
        </View>
      )}
      form={({ submit, saving }) => <CertificationForm submit={submit} saving={saving} />}
    />
  );
}

function CertificationForm({
  submit,
  saving,
}: {
  submit: (body: CertificationCreate) => void;
  saving: boolean;
}) {
  const [title, setTitle] = useState('');
  const [issuer, setIssuer] = useState('');
  const [issuedOn, setIssuedOn] = useState('');
  const [credentialId, setCredentialId] = useState('');
  const [verificationUrl, setVerificationUrl] = useState('');

  const issuedOk = issuedOn.trim() === '' || ISO_DATE.test(issuedOn.trim());
  const urlOk = verificationUrl.trim() === '' || /^https?:\/\//i.test(verificationUrl.trim());
  const canSubmit =
    title.trim().length > 0 && issuer.trim().length > 0 && issuedOk && urlOk && !saving;

  return (
    <View style={styles.form}>
      <TextField
        label="Certificate"
        value={title}
        onChangeText={setTitle}
        placeholder="Cloud Fundamentals"
        required
      />
      <TextField
        label="Issued by"
        value={issuer}
        onChangeText={setIssuer}
        placeholder="Example Institute"
        required
      />
      <TextField
        label="Issued on"
        value={issuedOn}
        onChangeText={setIssuedOn}
        placeholder="2026-02-10"
        helper="YYYY-MM-DD"
        error={issuedOk ? null : 'Use the YYYY-MM-DD format.'}
      />
      <TextField
        label="Credential ID"
        value={credentialId}
        onChangeText={setCredentialId}
        placeholder="ABC-1234"
      />
      <TextField
        label="Verification link"
        value={verificationUrl}
        onChangeText={setVerificationUrl}
        placeholder="https://example.com/verify/abc"
        autoCapitalize="none"
        keyboardType="url"
        error={urlOk ? null : 'The link must start with http:// or https://.'}
      />
      <Button
        label="Add certificate"
        fullWidth
        loading={saving}
        disabled={!canSubmit}
        onPress={() => {
          submit({
            title: title.trim(),
            issuer: issuer.trim(),
            issued_on: issuedOn.trim() || null,
            credential_id: credentialId.trim() || null,
            verification_url: verificationUrl.trim() || null,
          });
          setTitle('');
          setIssuer('');
          setIssuedOn('');
          setCredentialId('');
          setVerificationUrl('');
        }}
      />
    </View>
  );
}
