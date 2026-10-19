import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { Label } from '@/components/ui';
import { colors, fonts, space } from '@/theme';

type Option<T extends string | number> = { id: T; label: string };

/** One-of-N switch, e.g. Mobile | Shop | Both. */
export function Segmented<T extends string | number>({
  options, value, onChange, label,
}: { options: readonly Option<T>[]; value: T | null; onChange: (v: T) => void; label: string }) {
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <View style={styles.segmented} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((o) => {
          const active = o.id === value;
          return (
            <Pressable
              key={String(o.id)}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              onPress={() => onChange(o.id)}
              style={[styles.segment, active && styles.segmentActive]}
            >
              <Text style={[styles.segmentLabel, active && styles.segmentLabelActive]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Tap-to-toggle chips (multi-select), e.g. specialties. */
export function Chips<T extends string>({
  options, selected, onToggle, label, hint,
}: { options: readonly Option<T>[]; selected: readonly T[]; onToggle: (v: T) => void; label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      <View style={styles.chips}>
        {options.map((o) => {
          const on = selected.includes(o.id);
          return (
            <Pressable
              key={o.id}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => onToggle(o.id)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipLabel, on && styles.chipLabelOn]}>{on ? '✓ ' : ''}{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Labeled text input in the app's style. */
export function TextField({ label, hint, prefix, hasError, ...input }: TextInputProps & {
  label: string; hint?: string; prefix?: string; hasError?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Label>{label}</Label>
      <View style={[styles.inputRow, hasError && styles.inputRowError]}>
        {prefix ? <Text style={styles.prefix}>{prefix}</Text> : null}
        <TextInput
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={label}
          {...input}
          style={styles.input}
        />
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Secondary action: orange outline instead of a solid orange fill. */
export function OutlineButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.outline, pressed && { opacity: 0.7 }, disabled && { opacity: 0.45 }]}
    >
      <Text style={styles.outlineLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
  hint: { fontFamily: fonts.regular, fontSize: 15, lineHeight: 21, color: colors.textMuted },

  segmented: {
    flexDirection: 'row', gap: 4, padding: 4,
    borderWidth: 2, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.card,
  },
  segment: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 7 },
  segmentActive: { backgroundColor: colors.brand },
  segmentLabel: { fontFamily: fonts.bold, fontSize: 17, color: colors.textMuted },
  segmentLabelActive: { color: colors.onBrand },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  chip: {
    minHeight: 44, paddingHorizontal: space.s, justifyContent: 'center',
    borderWidth: 2, borderColor: colors.border, borderRadius: 22, backgroundColor: colors.card,
  },
  chipOn: { borderColor: colors.brand, backgroundColor: colors.primary },
  chipLabel: { fontFamily: fonts.bold, fontSize: 16, color: colors.textMuted },
  chipLabelOn: { color: colors.brand },

  inputRow: {
    flexDirection: 'row', alignItems: 'center', minHeight: 60, gap: space.xs,
    borderWidth: 2, borderColor: colors.border, borderRadius: 10, backgroundColor: colors.card,
    paddingHorizontal: space.m,
  },
  inputRowError: { borderColor: colors.error },
  prefix: { fontFamily: fonts.bold, fontSize: 22, color: colors.textMuted },
  input: { flex: 1, fontFamily: fonts.bold, fontSize: 20, color: colors.text, paddingVertical: space.s },

  outline: {
    minHeight: 60, borderRadius: 10, borderWidth: 2, borderColor: colors.brand,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.m,
  },
  outlineLabel: { fontFamily: fonts.bold, fontSize: 20, color: colors.brand },
});
