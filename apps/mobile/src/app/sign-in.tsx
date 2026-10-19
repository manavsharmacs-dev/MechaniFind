import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Body, ErrorMessage, PrimaryButton, Screen, SignPanel } from '@/components/ui';
import { ContactInput, MethodToggle, type Method } from '@/components/contact-input';
import { authErrorMessage, CANT_CONNECT } from '@/lib/auth-errors';
import { sendCode } from '@/lib/contact-auth';
import { isEmail, normalizeEmail } from '@/lib/email';
import { toE164 } from '@/lib/phone';
import { space } from '@/theme';

export default function SignIn() {
  const [method, setMethod] = useState<Method>('phone');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const value = method === 'phone' ? toE164(phone) : isEmail(normalizeEmail(email)) ? normalizeEmail(email) : null;

  async function send() {
    if (!value) {
      setError(method === 'phone' ? 'Enter a 10-digit US phone number.' : 'Enter a valid email address.');
      return;
    }
    setError(null);
    setSending(true);
    try {
      const { error: apiError } = await sendCode(method, value, 'sign-in');
      if (apiError) return setError(authErrorMessage(apiError));
      router.push({ pathname: '/verify', params: { method, value } });
    } catch {
      setError(CANT_CONNECT);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <SignPanel title="MechaniFind" subtitle="Get a mechanic to your truck." />

      <MethodToggle value={method} onChange={(m) => { setMethod(m); setError(null); }} />

      <View style={styles.field}>
        <ContactInput
          method={method}
          value={method === 'phone' ? phone : email}
          onChange={(v) => { (method === 'phone' ? setPhone : setEmail)(v); setError(null); }}
          onSubmit={send}
          hasError={!!error}
        />
        <ErrorMessage message={error} />
        <Body muted>
          {method === 'phone'
            ? "We'll text you a 6-digit code to sign in. No password needed."
            : "We'll email you a 6-digit code to sign in. No password needed."}
        </Body>
      </View>

      <PrimaryButton label="Send code" onPress={send} loading={sending} disabled={!value} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
});
