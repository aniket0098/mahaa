/**
 * Create an account (docs/SCREEN_INVENTORY.md — Signup + role; docs/UX_FLOWS.md F1).
 *
 * Binds to `POST /auth/signup`. The form collects only account essentials —
 * progressive onboarding continues on the profile, matching the server contract
 * (`name`, `email`, `password`, optional `phone`, `role`). No endpoint is
 * invented and no field the server forbids is offered.
 *
 * Server-side field errors are mapped back onto the inputs instead of being
 * flattened into a single toast, and the entered values are preserved.
 */

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { ApiError, fieldErrors } from '@/api/errors';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { PasswordChecklist } from '@/components/ui/PasswordChecklist';
import { RoleSelector, type SignupRole } from '@/components/ui/RoleSelector';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/auth/AuthContext';
import { resolveEntryPath } from '@/auth/entryPath';
import { evaluatePassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@/lib/passwordRules';
import { spacing } from '@/theme/tokens';

export default function SignupScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { signup } = useAuth();

  const [role, setRole] = useState<SignupRole>('candidate');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const errors = useMemo(() => fieldErrors(error), [error]);
  const passwordState = evaluatePassword(password);

  // A duplicate email is a 409, not a validation error: the server is telling us
  // the account already exists. The remedy is to sign in, so the screen offers
  // that instead of leaving the person on a form that cannot succeed.
  const duplicateEmail = error?.isConflict === true && Boolean(errors.email);

  // A 422 is only "handled" if its messages reach the screen. Field details
  // render inline; anything the form has no input for (a body-level
  // password-strength rule, for example) still needs the banner. Without this
  // check a rejected signup showed no feedback at all.
  const inlineFieldError = Boolean(errors.name || errors.email || errors.phone || errors.password);
  const showBanner = Boolean(error) && !(error?.isValidation && inlineFieldError);

  const passwordComplete = passwordState.length && passwordState.letter && passwordState.number;
  const canSubmit =
    name.trim().length >= 2 && email.trim().length > 0 && passwordComplete && !submitting;

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const principal = await signup({
        name: name.trim(),
        email: email.trim(),
        password,
        phone: phone.trim() ? phone.trim() : undefined,
        role,
      });
      // The server-issued role decides the destination, not the one selected on
      // this form, so the app can never drop someone into the wrong tree — and
      // the server's onboarding state decides whether they see the wizard first.
      // A new account is never signed in as "already set up": `entryPathForRole`
      // sends anyone whose required steps are outstanding to `/onboarding`, which
      // is what stops a half-finished profile reaching the dashboard.
      const destination = await resolveEntryPath(queryClient, principal.role);
      router.replace(destination as never);
    } catch (cause) {
      setError(
        cause instanceof ApiError
          ? cause
          : new ApiError({ message: 'Check your details and try again.' }),
      );
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen testID="signup-screen">
        <View style={styles.header}>
          <AppText variant="h1" accessibilityRole="header">
            Create your account
          </AppText>
          <AppText variant="body" tone="secondary">
            Start with the essentials. You will build the rest of your profile next.
          </AppText>
        </View>

        {showBanner ? (
          <StatusBanner
            title={
              duplicateEmail
                ? 'You already have an account'
                : 'We could not create your account'
            }
            description={error?.message ?? null}
          />
        ) : null}

        {/*
          The duplicate-email case has exactly one useful next step, so it gets a
          real action rather than leaving the person to hunt for the sign-in link.
          The typed email carries over so nothing has to be re-entered.
        */}
        {duplicateEmail ? (
          <Button
            label="Sign in instead"
            variant="secondary"
            size="lg"
            fullWidth
            onPress={() =>
              router.push({ pathname: '/login', params: { email: email.trim() } } as never)
            }
          />
        ) : null}

        <View style={styles.section}>
          <AppText variant="label" tone="secondary">
            I am joining as
          </AppText>
          <RoleSelector value={role} onChange={setRole} />
        </View>

        <View style={styles.form}>
          <TextField
            label="Full name"
            value={name}
            onChangeText={setName}
            autoComplete="name"
            textContentType="name"
            error={errors.name}
            helper="At least 2 characters."
            required
          />
          <TextField
            label="Email address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            error={errors.email}
            required
          />
          <TextField
            label="Phone (optional)"
            value={phone}
            onChangeText={setPhone}
            autoComplete="tel"
            textContentType="telephoneNumber"
            keyboardType="phone-pad"
            error={errors.phone}
            helper="Include the country code, for example +91."
          />
          <View style={styles.passwordGroup}>
            <TextField
              label="Password"
              value={password}
              onChangeText={setPassword}
              autoCapitalize="none"
              autoComplete="new-password"
              textContentType="newPassword"
              secureTextEntry
              maxLength={PASSWORD_MAX_LENGTH}
              error={errors.password}
              required
            />
            <PasswordChecklist value={password} />
          </View>
        </View>

        <Button
          label="Create account"
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!canSubmit}
          onPress={onSubmit}
        />

        <View style={styles.altAction}>
          <AppText variant="small" tone="secondary">
            Already have an account?{' '}
            <AppText
              variant="small"
              weight="semibold"
              tone="accent"
              accessibilityRole="link"
              onPress={() => router.push('/login' as never)}>
              Sign in
            </AppText>
          </AppText>
          <AppText variant="caption" tone="tertiary">
            Password must be at least {PASSWORD_MIN_LENGTH} characters.
          </AppText>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  header: {
    gap: spacing.xs,
  },
  section: {
    gap: spacing.sm,
  },
  form: {
    gap: spacing.lg,
  },
  passwordGroup: {
    gap: spacing.xs,
  },
  altAction: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
  },
});
