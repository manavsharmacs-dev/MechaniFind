import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Body, Label } from '@/components/ui';
import { OutlineButton } from '@/components/form';
import { formatFee, SPECIALTIES, type MechanicProfile } from '@/lib/mechanic';
import { colors, fonts, space } from '@/theme';

/** Home-screen card: either "Become a mechanic", or the mechanic's status. */
export function MechanicCard({ profile, hasPhone, role }: {
  profile: MechanicProfile | null;
  hasPhone: boolean;
  role: string;
}) {
  if (!profile) {
    if (role !== 'driver' && role !== 'admin') return null;
    return (
      <View style={styles.card}>
        <Label>Are you a mechanic?</Label>
        <Body muted>Get breakdown jobs from truck drivers near you.</Body>
        {hasPhone ? (
          <OutlineButton label="Become a mechanic" onPress={() => router.push('/mechanic-signup')} />
        ) : (
          <>
            <Body muted>First, add your phone number. Drivers and job alerts need to reach you.</Body>
            <OutlineButton
              label="Add phone number"
              onPress={() => router.push({ pathname: '/add-contact', params: { method: 'phone' } })}
            />
          </>
        )}
      </View>
    );
  }

  const approved = profile.status === 'approved';
  const specialtyNames = SPECIALTIES.filter((s) => profile.specialties.includes(s.id)).map((s) => s.label);
  const nextName = profile.nextNameChangeAt
    ? new Date(profile.nextNameChangeAt).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    : null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.business} numberOfLines={2}>{profile.businessName}</Text>
        <View style={[styles.pill, { borderColor: approved ? colors.success : colors.warning }]}>
          <Text style={[styles.pillText, { color: approved ? colors.success : colors.warning }]}>
            {approved ? 'Approved' : 'Pending approval'}
          </Text>
        </View>
      </View>

      {!approved ? (
        <Body muted>{"We're reviewing your profile. Once approved, you can go available and start getting jobs."}</Body>
      ) : null}

      <View style={styles.facts}>
        <Fact label="Call-out fee" value={formatFee(profile.calloutFeeCents)} />
        <Fact label="Travels" value={`${profile.serviceRadiusMiles} mi`} />
        <Fact label="Works" value={profile.serviceType === 'both' ? 'Mobile + shop' : profile.serviceType === 'shop' ? 'At shop' : 'Mobile'} />
      </View>
      <Body muted>{specialtyNames.join(' · ')}</Body>
      {nextName ? <Body muted>Business name can change again {nextName}.</Body> : null}
    </View>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space.s, padding: space.m, borderRadius: 14,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: space.s },
  business: { flex: 1, fontFamily: fonts.heavy, fontSize: 24, lineHeight: 30, color: colors.text },
  pill: { borderWidth: 2, borderRadius: 14, paddingHorizontal: space.s, paddingVertical: 4 },
  pillText: { fontFamily: fonts.bold, fontSize: 14 },
  facts: { flexDirection: 'row', gap: space.s },
  fact: { flex: 1, gap: 2 },
  factLabel: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted },
  factValue: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
});
