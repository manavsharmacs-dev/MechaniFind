import { SplashScreen, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts, Overpass_400Regular, Overpass_700Bold, Overpass_800ExtraBold,
} from '@expo-google-fonts/overpass';
import { authClient } from '@/lib/auth-client';
import { colors } from '@/theme';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Overpass_400Regular, Overpass_700Bold, Overpass_800ExtraBold });
  const { data: session, isPending } = authClient.useSession();

  // Keep the splash screen up until we know who's signed in and the fonts are ready.
  if (!fontsLoaded || isPending) return null;
  SplashScreen.hide();

  const signedIn = !!session;

  return (
    <>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.concrete } }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="index" />
          <Stack.Screen name="add-contact" />
          <Stack.Screen name="confirm-contact" />
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
          <Stack.Screen name="verify" />
        </Stack.Protected>
      </Stack>
    </>
  );
}
