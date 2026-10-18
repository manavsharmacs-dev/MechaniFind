import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Body, ErrorMessage, Label, PrimaryButton, Screen, SignPanel } from '@/components/ui';
import { authClient } from '@/lib/auth-client';
import { authErrorMessage, CANT_CONNECT } from '@/lib/auth-errors';
import { formatUSPhone, toE164 } from '@/lib/phone';
import { colors, fonts, space } from '@/theme';

export default function SignIn() {
  const [phone, setPhone] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const e164 = toE164(phone);

  async function sendCode() {
    if (!e164) {
      setError('Enter a 10-digit US phone number.');
      return;
    }
    setError(null);
    setSending(true);
    try {
      const { error: apiError } = await authClient.phoneNumber.sendOtp({ phoneNumber: e164 });
      if (apiError) return setError(authErrorMessage(apiError));
      router.push({ pathname: '/verify', params: { phone: e164 } });
    } catch {
      setError(CANT_CONNECT);
    } finally {
      setSending(false);
    }
  }

  return (
    <Screen>
      <SignPanel title="MechaniFind" subtitle="Get a mechanic to your truck." />

      <View style={styles.field}>
        <Label>Your phone number</Label>
        <View style={[styles.inputRow, error ? styles.inputRowError : null]}>
          <Text style={styles.prefix}>+1</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={(t) => { setPhone(formatUSPhone(t)); setError(null); }}
            onSubmitEditing={sendCode}
            placeholder="(815) 555-0123"
            placeholderTextColor={colors.road}
            keyboardType="phone-pad"
            textContentType="telephoneNumber"
            autoComplete="tel"
            returnKeyType="send"
            accessibilityLabel="Your phone number"
            autoFocus
          />
        </View>
        <ErrorMessage message={error} />
        <Body muted>We'll text you a 6-digit code to sign in. No password needed.</Body>
      </View>

      <PrimaryButton label="Send code" onPress={sendCode} loading={sending} disabled={!e164} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 64,
    borderWidth: 2,
    borderColor: colors.shoulder,
    borderRadius: 10,
    backgroundColor: colors.signWhite,
    paddingHorizontal: space.m,
    gap: space.s,
  },
  inputRowError: { borderColor: colors.stopRed },
  prefix: { fontFamily: fonts.bold, fontSize: 24, color: colors.road },
  input: { flex: 1, fontFamily: fonts.bold, fontSize: 24, color: colors.asphalt, paddingVertical: space.s },
});
