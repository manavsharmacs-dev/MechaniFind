import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Body, ErrorMessage, PrimaryButton, Screen, SignPanel, TextButton } from '@/components/ui';
import { ContactInput } from '@/components/contact-input';
import { authErrorMessage, CANT_CONNECT } from '@/lib/auth-errors';
import { sendCode } from '@/lib/contact-auth';
import { isEmail, normalizeEmail } from '@/lib/email';
import { toE164 } from '@/lib/phone';
import { space } from '@/theme';

/** Signed in: add a phone number or email to this account. */
export default function AddContact() {
  const { method } = useLocalSearchParams<{ method: string }>();
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  if (method !== 'phone' && method !== 'email') return <Redirect href="/" />;
  const isPhone = method === 'phone';
  const value = isPhone ? toE164(input) : isEmail(normalizeEmail(input)) ? normalizeEmail(input) : null;

  async function send() {
    if (!value) {
      setError(isPhone ? 'Enter a 10-digit US phone number.' : 'Enter a valid email address.');
      return;
    }
    setError(null);
    setSending(true);
    try {
      const { error: apiError } = await sendCode(method as 'phone' | 'email', value, 'link');
      if (apiError) return setError(authErrorMessage(apiError));
      router.push({ pathname: '/confirm-contact', params: { method, value } });
    } catch {
      setError(CANT_CONNECT);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <SignPanel
        title={isPhone ? 'Add your phone' : 'Add your email'}
        subtitle={isPhone ? 'Get job alerts and sign in by text.' : 'Get receipts and account notices.'}
      />
      <View style={styles.field}>
        <ContactInput
          method={method}
          value={input}
          onChange={(v) => { setInput(v); setError(null); }}
          onSubmit={send}
          hasError={!!error}
        />
        <ErrorMessage message={error} />
        <Body muted>{"We'll send a 6-digit code to confirm it's yours."}</Body>
      </View>
      <PrimaryButton label="Send code" onPress={send} loading={sending} disabled={!value} />
      <TextButton label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
});
