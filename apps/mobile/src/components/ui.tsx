import type { PropsWithChildren } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView,
  StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, fonts, space } from '@/theme';

/** Page wrapper: safe area, keyboard-aware, scrolls on small phones. */
export function Screen({ children }: PropsWithChildren) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** The one bold element: a green guide-sign panel with the white inset border. */
export function SignPanel({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <View style={styles.sign} accessibilityRole="header">
      <View style={styles.signInset}>
        <Text style={styles.signTitle}>{title}</Text>
        {subtitle ? <Text style={styles.signSubtitle}>{subtitle}</Text> : null}
      </View>
    </View>
  );
}

export function PrimaryButton({
  label, onPress, loading = false, disabled = false,
}: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean }) {
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [styles.button, pressed && styles.buttonPressed, disabled && styles.buttonDisabled]}
    >
      {loading ? <ActivityIndicator color={colors.signWhite} /> : <Text style={styles.buttonLabel}>{label}</Text>}
    </Pressable>
  );
}

export function TextButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.textButton, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.textButtonLabel, disabled && styles.textButtonDisabled]}>{label}</Text>
    </Pressable>
  );
}

export function ErrorMessage({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text style={styles.error} accessibilityLiveRegion="polite" accessibilityRole="alert">
      {message}
    </Text>
  );
}

export function Label({ children }: PropsWithChildren) {
  return <Text style={styles.label}>{children}</Text>;
}

export function Body({ children, muted = false }: PropsWithChildren<{ muted?: boolean }>) {
  return <Text style={[styles.body, muted && styles.bodyMuted]}>{children}</Text>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.concrete },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, padding: space.m, gap: space.m },

  sign: {
    backgroundColor: colors.signGreen,
    borderRadius: 14,
    padding: 6,
    marginBottom: space.s,
  },
  signInset: {
    borderWidth: 3,
    borderColor: colors.signWhite,
    borderRadius: 10,
    paddingHorizontal: space.m,
    paddingTop: space.m,
    paddingBottom: space.m - 2,
    gap: space.xs,
  },
  signTitle: { fontFamily: fonts.heavy, fontSize: 36, lineHeight: 42, color: colors.signWhite },
  signSubtitle: { fontFamily: fonts.regular, fontSize: 19, lineHeight: 26, color: colors.signWhite },

  label: { fontFamily: fonts.bold, fontSize: 18, lineHeight: 24, color: colors.asphalt },
  body: { fontFamily: fonts.regular, fontSize: 17, lineHeight: 25, color: colors.asphalt },
  bodyMuted: { color: colors.road },

  button: {
    minHeight: 60,
    borderRadius: 10,
    backgroundColor: colors.signGreen,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.m,
  },
  buttonPressed: { backgroundColor: colors.signGreenPressed },
  buttonDisabled: { opacity: 0.45 },
  buttonLabel: { fontFamily: fonts.bold, fontSize: 20, color: colors.signWhite },

  textButton: { minHeight: 48, justifyContent: 'center', alignSelf: 'flex-start' },
  textButtonLabel: {
    fontFamily: fonts.bold, fontSize: 17, color: colors.signGreen, textDecorationLine: 'underline',
  },
  textButtonDisabled: { color: colors.road, textDecorationLine: 'none' },

  error: { fontFamily: fonts.bold, fontSize: 17, lineHeight: 24, color: colors.stopRed },
});
