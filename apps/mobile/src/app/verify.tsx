import { useEffect, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Body, ErrorMessage, Label, PrimaryButton, Screen, SignPanel, TextButton } from '@/components/ui';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage, CANT_CONNECT } from '@/lib/auth-errors';
import { displayE164, isUSE164 } from '@/lib/phone';
import { colors, fonts, space } from '@/theme';

const RESEND_SECONDS = 30;

export default function Verify() {
  const { phone } = useLocalSearchParams<{ phone: string }>();
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

  // The number arrives as a link parameter — never trust it blindly (a crafted
  // mechanifind:// link could otherwise point the screen at someone else's number).
  if (!isUSE164(phone)) return <Redirect href="/sign-in" />;

  async function signIn(value = code) {
    if (value.length !== 6 || checking) return;
    setError(null);
    setNotice(null);
    setChecking(true);
    try {
      const { error: apiError } = await authClient.phoneNumber.verify({ phoneNumber: phone, code: value });
      if (apiError) {
        setError(authErrorMessage(apiError));
        setCode('');
        return;
      }
      // Signed in. The root layout sees the new session and shows the home screen.
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
      const { error: apiError } = await authClient.phoneNumber.sendOtp({ phoneNumber: phone });
      if (apiError) return setError(authErrorMessage(apiError));
      setCode('');
      setWait(RESEND_SECONDS);
      setNotice('New code sent.');
    } catch {
      setError(CANT_CONNECT);
    }
  }

  return (
    <Screen>
      <SignPanel title="Enter your code" subtitle={`Sent to ${displayE164(phone)}`} />

      <View style={styles.field}>
        <Label>6-digit code</Label>
        <TextInput
          style={[styles.code, error ? styles.codeError : null]}
          value={code}
          onChangeText={(t) => {
            const digits = t.replace(/\D/g, '').slice(0, 6);
            setCode(digits);
            setError(null);
            if (digits.length === 6) signIn(digits); // sign in as soon as the last digit is typed
          }}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="sms-otp"
          maxLength={6}
          placeholder="000000"
          placeholderTextColor={colors.shoulder}
          accessibilityLabel="6-digit code"
          autoFocus
        />
        <ErrorMessage message={error} />
        {notice ? <Body muted>{notice}</Body> : null}
      </View>

      <PrimaryButton label="Sign in" onPress={() => signIn()} loading={checking} disabled={code.length !== 6} />

      <View>
        <TextButton
          label={wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'}
          onPress={resend}
          disabled={wait > 0}
        />
        <TextButton label="Use a different number" onPress={() => router.back()} />
      </View>
    </Screen>
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
