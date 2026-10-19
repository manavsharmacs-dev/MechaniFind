import { useCallback, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { ErrorMessage, PrimaryButton, Screen, TextButton } from '@/components/ui';
import { MechanicDashboard } from '@/components/mechanic-dashboard';
import { apiFetch, authClient } from '@/lib/auth-client';
import { CANT_CONNECT } from '@/lib/auth-errors';
import { getMyMechanicProfile, type MechanicProfile } from '@/lib/mechanic';
import { colors, space } from '@/theme';

type Me = { phoneNumber: string | null; role: string };

export default function Home() {
  const [me, setMe] = useState<Me | null>(null);
  const [mechanic, setMechanic] = useState<MechanicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reload every time this screen is shown (e.g. after signing up or adding a phone).
  useFocusEffect(
    useCallback(() => {
      apiFetch('/me')
        .then(async (res) => {
          if (res.status === 401) return authClient.signOut(); // session expired on the server
          if (!res.ok) throw new Error();
          setMe(await res.json());
          setMechanic(await getMyMechanicProfile());
          setError(null);
        })
        .catch(() => setError(CANT_CONNECT));
    }, []),
  );

  function becomeMechanic() {
    // The server requires a confirmed phone for mechanics, so add one first.
    if (!me?.phoneNumber) router.push({ pathname: '/add-contact', params: { method: 'phone' } });
    else router.push('/mechanic-signup');
  }

  return (
    <Screen>
      <View style={me && mechanic ? styles.top : styles.center}>
        {error ? <ErrorMessage message={error} /> : null}
        {!me && !error ? <ActivityIndicator color={colors.brand} size="large" /> : null}
        {me && mechanic ? <MechanicDashboard /> : null}
        {me && !mechanic ? <PrimaryButton label="Become a mechanic" onPress={becomeMechanic} /> : null}
      </View>
      <View style={styles.footer}>
        <TextButton center label="Account" onPress={() => router.push('/account')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', gap: space.m },
  top: { flex: 1, gap: space.m },
  footer: { paddingBottom: space.s },
});
