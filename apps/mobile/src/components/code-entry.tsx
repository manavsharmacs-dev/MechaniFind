import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Body, ErrorMessage, Label, PrimaryButton, SignPanel, TextButton } from '@/components/ui';
import type { Method } from '@/components/contact-input';
import { authErrorMessage, CANT_CONNECT } from '@/lib/auth-errors';
import { confirmCode, sendCode } from '@/lib/contact-auth';
import { displayE164 } from '@/lib/phone';
import { colors, fonts, space } from '@/theme';

const RESEND_SECONDS = 30;

/**
 * The 6-digit code step, shared by sign-in and "add phone/email".
 * Calls onConfirmed once the code is accepted.
 */
export function CodeEntry({
  method, value, mode, onConfirmed, onBack, title = 'Enter your code',
}: {
  method: Method;
  value: string;
  mode: 'sign-in' | 'link';
  onConfirmed: () => void;
  onBack: () => void;
  title?: string;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [wait, setWait] = useState(RESEND_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const shown = method === 'phone' ? displayE164(value) : value;

  async function submit(entered = code) {
    if (entered.length !== 6 || checking) return;
    setError(null);
    setNotice(null);
    setChecking(true);
    try {
      const { error: apiError } = await confirmCode(method, value, entered, mode);
      if (apiError) {
        setError(authErrorMessage(apiError));
        setCode('');
        return;
      }
      onConfirmed();
    } catch {
      setError(CANT_CONNECT);
    } finally {
      setChecking(false);
    }
  }

  async function resend() {
    setError(null);
    setNotice(null);
    try {
      const { error: apiError } = await sendCode(method, value, mode);
      if (apiError) return setError(authErrorMessage(apiError));
      setCode('');
      setWait(RESEND_SECONDS);
      setNotice('New code sent.');
    } catch {
      setError(CANT_CONNECT);
    }
  }

  return (
    <>
      <SignPanel title={title} subtitle={`Sent to ${shown}`} />

      <View style={styles.field}>
        <Label>6-digit code</Label>
        <TextInput
          style={[styles.code, error ? styles.codeError : null]}
          value={code}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, 6);
            setCode(digits);
            setError(null);
            if (digits.length === 6) submit(digits); // continue as soon as the last digit is typed
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete={method === 'phone' ? 'sms-otp' : 'one-time-code'}
          maxLength={6}
          placeholder="000000"
          placeholderTextColor={colors.shoulder}
          accessibilityLabel="6-digit code"
          autoFocus
        />
        <ErrorMessage message={error} />
        {notice ? <Body muted>{notice}</Body> : null}
        {method === 'email' ? <Body muted>Check your inbox (and spam folder).</Body> : null}
      </View>

      <PrimaryButton
        label={mode === 'link' ? 'Confirm' : 'Sign in'}
        onPress={() => submit()}
        loading={checking}
        disabled={code.length !== 6}
      />

      <View>
        <TextButton
          label={wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          onPress={resend}
          disabled={wait > 0}
        />
        <TextButton label={method === 'phone' ? 'Use a different number' : 'Use a different email'} onPress={onBack} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
  code: {
    minHeight: 72,
    borderWidth: 2,
    borderColor: colors.shoulder,
    borderRadius: 10,
    backgroundColor: colors.signWhite,
    paddingHorizontal: space.m,
    fontFamily: fonts.heavy,
    fontSize: 34,
    letterSpacing: 10,
    color: colors.asphalt,
  },
  codeError: { borderColor: colors.stopRed },
});
