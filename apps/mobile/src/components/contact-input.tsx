import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Label } from '@/components/ui';
import { formatUSPhone } from '@/lib/phone';
import { colors, fonts, space } from '@/theme';

export type Method = 'phone' | 'email';

/** "Phone | Email" switch. */
export function MethodToggle({ value, onChange }: { value: Method; onChange: (m: Method) => void }) {
  return (
    <View style={styles.toggle} accessibilityRole="tablist">
      {(['phone', 'email'] as const).map((m) => {
        const active = value === m;
        return (
          <Pressable
            key={m}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(m)}
            style={[styles.toggleItem, active && styles.toggleItemActive]}
          >
            <Text style={[styles.toggleLabel, active && styles.toggleLabelActive]}>
              {m === 'phone' ? 'Phone' : 'Email'}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Phone or email field, styled like the rest of the app. */
export function ContactInput({
  method, value, onChange, onSubmit, hasError, autoFocus = true,
}: {
  method: Method;
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  hasError: boolean;
  autoFocus?: boolean;
}) {
  const isPhone = method === 'phone';
  return (
    <View style={styles.field}>
      <Label>{isPhone ? 'Your phone number' : 'Your email'}</Label>
      <View style={[styles.inputRow, hasError ? styles.inputRowError : null]}>
        {isPhone ? <Text style={styles.prefix}>+1</Text> : null}
        <TextInput
          key={method} // fresh keyboard when switching
          style={[styles.input, !isPhone && styles.emailInput]}
          value={value}
          onChangeText={(t) => onChange(isPhone ? formatUSPhone(t) : t)}
          onSubmitEditing={onSubmit}
          placeholder={isPhone ? '(815) 555-0123' : 'you@example.com'}
          placeholderTextColor={colors.road}
          keyboardType={isPhone ? 'phone-pad' : 'email-address'}
          textContentType={isPhone ? 'telephoneNumber' : 'emailAddress'}
          autoComplete={isPhone ? 'tel' : 'email'}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={isPhone ? 16 : 254}
          returnKeyType="send"
          accessibilityLabel={isPhone ? 'Your phone number' : 'Your email'}
          autoFocus={autoFocus}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: {
    flexDirection: 'row',
    borderWidth: 2,
    borderColor: colors.shoulder,
    borderRadius: 10,
    backgroundColor: colors.signWhite,
    padding: 4,
    gap: 4,
  },
  toggleItem: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  toggleItemActive: { backgroundColor: colors.signGreen },
  toggleLabel: { fontFamily: fonts.bold, fontSize: 18, color: colors.road },
  toggleLabelActive: { color: colors.signWhite },
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
  emailInput: { fontSize: 20 },
});
