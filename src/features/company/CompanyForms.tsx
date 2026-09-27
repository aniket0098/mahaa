/**
 * Company create/edit form.
 *
 * `extra="forbid"` on the server means only documented fields may be sent, so
 * optional text is normalised to `null` rather than an empty string; and the
 * creator's role is server-owned, so there is no role field here.
 */

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { createCompany, updateCompany } from '@/api/company';
import { ApiError } from '@/api/errors';
import { queryKeys } from '@/api/queryKeys';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/TextField';
import { spacing } from '@/theme/tokens';
import type { CompanyRead, CompanySize } from '@/types/company';

const SIZES: readonly CompanySize[] = ['1-10', '11-50', '51-200', '201-500', '501-1000', '1000+'];

export interface CompanyFormProps {
  onDone: () => void;
  onCancel: () => void;
}

function CompanyFields({
  name,
  setName,
  industry,
  setIndustry,
  location,
  setLocation,
  website,
  setWebsite,
  size,
  setSize,
}: {
  name: string;
  setName: (value: string) => void;
  industry: string;
  setIndustry: (value: string) => void;
  location: string;
  setLocation: (value: string) => void;
  website: string;
  setWebsite: (value: string) => void;
  size: CompanySize | null;
  setSize: (value: CompanySize | null) => void;
}) {
  return (
    <>
      <TextField label="Company name" value={name} onChangeText={setName} required />
      <TextField label="Industry" value={industry} onChangeText={setIndustry} />
      <TextField label="Location" value={location} onChangeText={setLocation} />
      <TextField
        label="Website"
        value={website}
        onChangeText={setWebsite}
        autoCapitalize="none"
        keyboardType="url"
        placeholder="https://example.com"
        helper="Must start with http:// or https://"
      />
      <AppText variant="label" tone="secondary">
        Company size
      </AppText>
      <View style={styles.chips}>
        {SIZES.map((option) => (
          <Button
            key={option}
            label={option}
            variant={size === option ? 'primary' : 'secondary'}
            onPress={() => setSize(option)}
          />
        ))}
      </View>
    </>
  );
}

export function CreateCompanyForm({ onDone, onCancel }: CompanyFormProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [size, setSize] = useState<CompanySize | null>(null);

  const create = useMutation({
    mutationFn: () =>
      createCompany({
        name: name.trim(),
        industry: industry.trim() || null,
        location: location.trim() || null,
        website: website.trim() || null,
        company_size: size,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myCompanies });
      onDone();
    },
  });

  return (
    <View style={styles.form}>
      {create.isError ? <ErrorText error={create.error} /> : null}
      <CompanyFields
        name={name}
        setName={setName}
        industry={industry}
        setIndustry={setIndustry}
        location={location}
        setLocation={setLocation}
        website={website}
        setWebsite={setWebsite}
        size={size}
        setSize={setSize}
      />
      <Button
        label="Create company"
        fullWidth
        loading={create.isPending}
        disabled={name.trim().length < 2}
        onPress={() => create.mutate()}
      />
      <Button label="Cancel" variant="ghost" fullWidth onPress={onCancel} />
    </View>
  );
}

export function EditCompanyForm({
  company,
  onDone,
  onCancel,
}: CompanyFormProps & { company: CompanyRead }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(company.name);
  const [industry, setIndustry] = useState(company.industry ?? '');
  const [location, setLocation] = useState(company.location ?? '');
  const [website, setWebsite] = useState(company.website ?? '');
  const [size, setSize] = useState<CompanySize | null>(
    (company.company_size as CompanySize | null) ?? null,
  );

  const update = useMutation({
    mutationFn: () =>
      updateCompany(company.id, {
        name: name.trim(),
        industry: industry.trim() || null,
        location: location.trim() || null,
        website: website.trim() || null,
        company_size: size,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.myCompanies });
      onDone();
    },
  });

  return (
    <View style={styles.form}>
      {update.isError ? <ErrorText error={update.error} /> : null}
      <CompanyFields
        name={name}
        setName={setName}
        industry={industry}
        setIndustry={setIndustry}
        location={location}
        setLocation={setLocation}
        website={website}
        setWebsite={setWebsite}
        size={size}
        setSize={setSize}
      />
      <Button
        label="Save changes"
        fullWidth
        loading={update.isPending}
        disabled={name.trim().length < 2}
        onPress={() => update.mutate()}
      />
      <Button label="Cancel" variant="ghost" fullWidth onPress={onCancel} />
    </View>
  );
}

export function CompanyActions({
  company,
  onEdit,
  onVerify,
  verifying,
}: {
  company: CompanyRead;
  onEdit: () => void;
  onVerify: () => void;
  verifying: boolean;
}) {
  return (
    <>
      <Button label="Edit company" variant="secondary" fullWidth onPress={onEdit} />
      {company.verification_status === 'unverified' ? (
        <Button
          label="Request verification"
          variant="secondary"
          fullWidth
          loading={verifying}
          onPress={onVerify}
        />
      ) : null}
    </>
  );
}

/** A label/value pair, used for the company's read-only attributes. */
export function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <AppText variant="caption" tone="tertiary">
        {label}
      </AppText>
      <AppText variant="small">{value}</AppText>
    </View>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  return (
    <AppText variant="small" tone="danger">
      {error instanceof ApiError ? error.message : 'That did not save. Please try again.'}
    </AppText>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  detail: { gap: 2 },
});