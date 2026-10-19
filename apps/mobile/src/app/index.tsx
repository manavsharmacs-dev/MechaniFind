import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Body, ErrorMessage, Label, PrimaryButton, Screen, SignPanel, TextButton } from '@/components/ui';
import { apiFetch, authClient } from '@/lib/auth-client';
import { CANT_CONNECT } from '@/lib/auth-errors';
import { displayE164 } from '@/lib/phone';
import { space } from '@/theme';

type Me = {
  id: string;
  name: string;
  phoneNumber: string | null;
  email: string | null;
  role: string;
  companyId: string | null;
};

const ROLE_NAMES: Record<string, string> = {
  driver: 'Driver',
  mechanic: 'Mechanic',
  fleet_manager: 'Fleet manager',
  admin: 'Admin',
};

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  // Reload the account every time this screen is shown (e.g. after adding an email).
  useFocusEffect(
    useCallback(() => {
      apiFetch('/me')
        .then(async (res) => {
          if (res.status === 401) return authClient.signOut(); // session expired on the server
          if (!res.ok) throw new Error();
          setMe(await res.json());
          setError(null);
        })
        .catch(() => setError(CANT_CONNECT));
    }, []),
  );

  async function signOut() {
    setSigningOut(true);
    await authClient.signOut().finally(() => setSigningOut(false));
  }

  const title = me?.phoneNumber ? displayE164(me.phoneNumber) : me?.email ?? undefined;

  return (
    <Screen>
      <SignPanel title="You're signed in" subtitle={title} />

      <ErrorMessage message={error} />

      {me ? (
        <>
          <View style={styles.row}>
            <Label>Account type</Label>
            <Body>{ROLE_NAMES[me.role] ?? me.role}</Body>
          </View>

          <View style={styles.row}>
            <Label>Phone</Label>
            {me.phoneNumber ? (
              <Body>{displayE164(me.phoneNumber)}</Body>
            ) : (
              <TextButton label="Add your phone number" onPress={() => router.push({ pathname: '/add-contact', params: { method: 'phone' } })} />
            )}
          </View>

          <View style={styles.row}>
            <Label>Email</Label>
            {me.email ? (
              <Body>{me.email}</Body>
            ) : (
              <TextButton label="Add your email" onPress={() => router.push({ pathname: '/add-contact', params: { method: 'email' } })} />
            )}
          </View>
        </>
      ) : null}

      <Body muted>Breakdown requests will show up here.</Body>

      <View style={styles.spacer} />
      <PrimaryButton label="Sign out" onPress={signOut} loading={signingOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: space.xs },
  spacer: { flex: 1 },
});
