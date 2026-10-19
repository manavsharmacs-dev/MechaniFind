import { createAuthClient } from 'better-auth/react';
import { expoClient } from '@better-auth/expo/client';
import { phoneNumberClient, emailOTPClient, inferAdditionalFields } from 'better-auth/client/plugins';
import * as SecureStore from 'expo-secure-store';
import { API_URL } from './api';

// Sessions are kept in the phone's secure storage (Keychain / Keystore),
// so drivers stay signed in after closing the app.
export const authClient = createAuthClient({
  baseURL: API_URL,
  plugins: [
    expoClient({ scheme: 'mechanifind', storagePrefix: 'mechanifind', storage: SecureStore }),
    phoneNumberClient(),
    emailOTPClient(),
    inferAdditionalFields({
      user: {
        role: { type: 'string', required: false },
        companyId: { type: 'string', required: false },
      },
    }),
  ],
});

/** fetch() for our own API routes, with the signed-in session attached. */
export async function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const cookie = await authClient.getCookie(); // async — without await the session was never sent
  if (cookie) headers.set('Cookie', cookie);
  return fetch(`${API_URL}${path}`, { ...init, headers, credentials: 'omit' });
}
