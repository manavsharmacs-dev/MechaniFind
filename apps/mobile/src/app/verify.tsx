import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui';
import { CodeEntry } from '@/components/code-entry';
import { isEmail } from '@/lib/email';
import { isUSE164 } from '@/lib/phone';

export default function Verify() {
  const { method, value } = useLocalSearchParams<{ method: string; value: string }>();

  // These arrive as link parameters — never trust them blindly (a crafted
  // mechanifind:// link could otherwise point the screen at someone else's contact).
  const valid = (method === 'phone' && isUSE164(value)) || (method === 'email' && isEmail(value));
  if (!valid) return <Redirect href="/sign-in" />;

  return (
    <Screen>
      <CodeEntry
        method={method as 'phone' | 'email'}
        value={value}
        mode="sign-in"
        // Signed in: the root layout sees the new session and shows the home screen.
        onConfirmed={() => {}}
        onBack={() => router.back()}
      />
    </Screen>
  );
}
