/**
 * Sign in (docs/SCREEN_INVENTORY.md — Login; docs/UX_FLOWS.md F1).
 *
 * Binds to `POST /auth/login` in `apps/api/app/api/v1/endpoints/auth.py`.
 * The session is resolved from `/auth/me` after the token is stored — the token
 * is never treated as identity.
 *
 * Failures render in a persistent banner with the server's own message, so a
 * wrong password and an inactive account are distinguishable without inventing
 * copy. Nothing is cleared from the form on error.
 */

import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/errors';
import { AppText } from '@/components/ui/AppText';
import { Button } from '@/components/ui/Button';
import { Screen } from '@/components/ui/Screen';
import { StatusBanner } from '@/components/ui/StatusBanner';
import { TextField } from '@/components/ui/TextField';
import { useAuth } from '@/auth/AuthContext';
import { homePathForRole } from '@/auth/roleHome';
import { ApiConnectionPanel } from '@/features/connection/ApiConnectionPanel';
import { spacing } from '@/theme/tokens';

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  // The signup screen sends a duplicate-email visitor here with the address they
  // already typed, so they are not asked to retype it.
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const prefilledEmail = Array.isArray(params.email) ? params.email[0] : params.email;

  const [email, setEmail] = useState(prefilledEmail ?? '');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const onSubmit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // The principal decides the destination: a candidate lands in the
      // candidate tree, an employer in the employer tree. The app never guesses.
      const principal = await login({ email, password });
      router.replace(homePathForRole(principal.role) as never);
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

  const canSubmit = email.trim().length > 0 && password.length > 0 && !submitting;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen testID="login-screen">
        <View style={styles.header}>
          <AppText variant="h1" accessibilityRole="header">
            Sign in to MahaJob
          </AppText>
          <AppText variant="body" tone="secondary">
            Use your account email and password to continue.
          </AppText>
        </View>

        {error ? (
          <StatusBanner
            title="Sign-in failed"
            description={error.message}
            onRetry={canSubmit ? onSubmit : undefined}
          />
        ) : null}

        {/*
          Connection panel sits above the form on purpose: the first request a new
          user makes is this one, so if the API cannot be reached the app has to
          say so here and name the URL, instead of only showing a generic
          network error.
        */}
        <ApiConnectionPanel autoStart />

        <View style={styles.form}>
          <TextField
            label="Email address"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            returnKeyType="next"
            required
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            autoCapitalize="none"
            autoComplete="current-password"
            textContentType="password"
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={canSubmit ? onSubmit : undefined}
            required
          />
          <Button
            label="Sign in"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            onPress={onSubmit}
          />
        </View>

        <View style={styles.altAction}>
          <AppText variant="small" tone="secondary">
            New to MahaJob?{' '}
            <AppText
              variant="small"
              weight="semibold"
              tone="accent"
              accessibilityRole="link"
              onPress={() => router.push('/signup' as never)}>
              Create an account
            </AppText>
          </AppText>
          {/* Password recovery has no backend yet; the link opens a screen that
              says so rather than a form that would silently do nothing. */}
          <AppText
            variant="small"
            tone="tertiary"
            accessibilityRole="link"
            onPress={() => router.push('/reset-password' as never)}>
            Forgot your password?
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
  form: {
    gap: spacing.lg,
  },
  altAction: {
    alignItems: 'center',
    paddingTop: spacing.sm,
  },
});
