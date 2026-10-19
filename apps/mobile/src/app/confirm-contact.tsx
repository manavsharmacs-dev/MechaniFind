import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { Screen } from '@/components/ui';
import { CodeEntry } from '@/components/code-entry';
import { isEmail } from '@/lib/email';
import { isUSE164 } from '@/lib/phone';

/** Signed in: confirm the code sent to the phone/email being added. */
export default function ConfirmContact() {
  const { method, value } = useLocalSearchParams<{ method: string; value: string }>();

  const valid = (method === 'phone' && isUSE164(value)) || (method === 'email' && isEmail(value));
  if (!valid) return <Redirect href="/" />;

  return (
    <Screen>
      <CodeEntry
        method={method as 'phone' | 'email'}
        value={value}
        mode="link"
        title={method === 'phone' ? 'Confirm your phone' : 'Confirm your email'}
        onConfirmed={() => router.dismissTo('/')} // home reloads and shows it
        onBack={() => router.back()}
      />
    </Screen>
  );
}
