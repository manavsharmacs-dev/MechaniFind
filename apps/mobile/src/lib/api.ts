import Constants from 'expo-constants';

/**
 * Where the MechaniFind API lives.
 * - EXPO_PUBLIC_API_URL wins if set (production, or a deployed test server).
 * - In development, use the same computer that's running Expo, on port 3000.
 *   Your phone and laptop must be on the same Wi-Fi.
 */
function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const devHost = Constants.expoConfig?.hostUri?.split(':')[0];
  if (__DEV__ && devHost) return `http://${devHost}:3000`;
  if (__DEV__) {
    throw new Error(
      "Can't find the API. MechaniFind runs in the Expo Go app on your phone, not in a web browser. " +
        'Open Expo Go → "Enter URL manually" → exp://<your laptop IP>:8081',
    );
  }
  throw new Error('EXPO_PUBLIC_API_URL is not set');
}

export const API_URL = resolveApiUrl();

// Outside development, refuse to send sessions over an unencrypted connection.
if (!__DEV__ && !API_URL.startsWith('https://')) {
  throw new Error('API_URL must use https:// in production');
}
