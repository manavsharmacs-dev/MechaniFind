import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import { Body, ErrorMessage, Label, PrimaryButton, TextButton } from '@/components/ui';
import { OutlineButton, TextField } from '@/components/form';
import {
  formatFee, getDashboard, ISSUE_LABELS, mechanicErrorMessage, sendLocation, setAvailability,
  SPECIALTIES, updateProfile, type Dashboard, type Stats,
} from '@/lib/mechanic';
import { CANT_CONNECT } from '@/lib/auth-errors';
import { colors, fonts, space } from '@/theme';

const REFRESH_MS = 15_000;   // re-check offers while the dashboard is open
const PING_MS = 60_000;      // share location while online

async function currentSpot() {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return null;
  const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  return { lat: pos.coords.latitude, lng: pos.coords.longitude };
}

export function MechanicDashboard() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const online = !!data?.profile.isAvailable;
  // The location timer reads this, so it always knows the latest online state.
  const onlineRef = useRef(online);
  useEffect(() => { onlineRef.current = online; }, [online]);

  const load = useCallback(async () => {
    try {
      const d = await getDashboard();
      if (d) setData(d);
      setError(null);
    } catch {
      setError(CANT_CONNECT);
    }
  }, []);

  // Refresh while the screen is showing; share location while online.
  useFocusEffect(
    useCallback(() => {
      load();
      const refresh = setInterval(load, REFRESH_MS);
      const ping = setInterval(async () => {
        if (!onlineRef.current) return;
        const spot = await currentSpot().catch(() => null);
        if (spot) sendLocation(spot).catch(() => {});
      }, PING_MS);
      return () => { clearInterval(refresh); clearInterval(ping); };
    }, [load]),
  );

  async function toggleOnline() {
    if (!data) return;
    setSwitching(true);
    setError(null);
    try {
      if (online) {
        const r = await setAvailability(false);
        if (!r.ok) return setError(mechanicErrorMessage(r));
      } else {
        const spot = await currentSpot();
        if (!spot) { setLocationDenied(true); return; }
        setLocationDenied(false);
        const r = await setAvailability(true, spot);
        if (!r.ok) return setError(mechanicErrorMessage(r));
      }
      await load();
    } catch {
      setError(CANT_CONNECT);
    } finally {
      setSwitching(false);
    }
  }

  if (!data) {
    return error ? <ErrorMessage message={error} /> : <ActivityIndicator color={colors.brand} size="large" />;
  }

  const { profile, offers, activeJob, stats, history, canGoOnline } = data;

  return (
    <View style={styles.wrap}>
      {/* 1. Online switch */}
      <View style={[styles.card, online && styles.cardOnline]}>
        <View style={styles.rowBetween}>
          <Text style={styles.business} numberOfLines={1}>{profile.businessName}</Text>
          <Pill text={!canGoOnline ? 'Pending approval' : online ? 'Online' : 'Offline'}
            color={!canGoOnline ? colors.warning : online ? colors.success : colors.textMuted} />
        </View>
        {!canGoOnline ? (
          <Body muted>{"We're reviewing your profile. You can go online once you're approved."}</Body>
        ) : (
          <>
            <Body muted>{online ? 'Receiving breakdown jobs. Sharing your location.' : 'Go online to start receiving jobs.'}</Body>
            {online
              ? <OutlineButton label={switching ? 'Going offline…' : 'Go offline'} onPress={toggleOnline} disabled={switching} />
              : <PrimaryButton label="Go online" onPress={toggleOnline} loading={switching} />}
          </>
        )}
        {locationDenied ? (
          <>
            <ErrorMessage message="Location is off. MechaniFind needs it to send you nearby jobs." />
            <TextButton label="Open Settings" onPress={() => Linking.openSettings()} />
          </>
        ) : null}
        <ErrorMessage message={error} />
      </View>

      {/* 2. Active job */}
      {activeJob ? (
        <Section title="Current job">
          <View style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{ISSUE_LABELS[activeJob.category ?? ''] ?? 'Breakdown'}</Text>
              <Pill text={activeJob.status === 'en_route' ? 'En route' : activeJob.status === 'arrived' ? 'Arrived' : 'Accepted'} color={colors.brand} />
            </View>
            {activeJob.faultCode ? <Body>Code: {activeJob.faultCode}</Body> : null}
            <Body muted>{activeJob.description}</Body>
            <OutlineButton
              label="Navigate"
              onPress={() => Linking.openURL(`https://maps.google.com/?daddr=${activeJob.location.lat},${activeJob.location.lng}`)}
            />
          </View>
        </Section>
      ) : null}

      {/* 3. Offers */}
      <Section title="Job offers">
        {offers.length === 0 ? (
          <Body muted>{online ? 'No offers right now. Stay online — new breakdowns appear here.' : 'No offers. Go online to receive jobs.'}</Body>
        ) : offers.map((o) => (
          <View key={o.offerId} style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardTitle}>{ISSUE_LABELS[o.category ?? ''] ?? 'Breakdown'}</Text>
              {o.approxMiles != null ? <Text style={styles.miles}>~{o.approxMiles} mi</Text> : null}
            </View>
            {o.faultCode ? <Body>Code: {o.faultCode}</Body> : null}
            <Body muted>{o.description}</Body>
            {o.driverSaysDrivable === false ? <Body muted>Driver says the truck can’t move.</Body> : null}
            <Body muted>Accepting jobs from the app is coming next.</Body>
          </View>
        ))}
      </Section>

      {/* 4. Stats */}
      <Section title="Today">
        <StatRow s={stats.today} />
      </Section>
      <Section title="This week">
        <StatRow s={stats.thisWeek} />
      </Section>

      {/* 5. Profile */}
      <Section title="My profile">
        <ProfileCard data={data} onSaved={load} />
      </Section>

      {/* 6. History */}
      <Section title="Recent jobs">
        {history.length === 0 ? <Body muted>No completed jobs yet.</Body> : history.map((h) => (
          <View key={h.jobId} style={styles.historyRow}>
            <Text style={styles.historyTitle}>{ISSUE_LABELS[h.category ?? ''] ?? 'Job'}{h.status === 'cancelled' ? ' (cancelled)' : ''}</Text>
            <Text style={styles.historyMeta}>
              {h.finishedAt ? new Date(h.finishedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : ''}
              {h.calloutFeeCents != null ? `  ·  ${formatFee(h.calloutFeeCents)}` : ''}
            </Text>
          </View>
        ))}
      </Section>
    </View>
  );
}

function ProfileCard({ data, onSaved }: { data: Dashboard; onSaved: () => void }) {
  const p = data.profile;
  const [editing, setEditing] = useState(false);
  const [fee, setFee] = useState(String(p.calloutFeeCents / 100));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cents = Math.round(parseFloat(fee) * 100);
  const valid = Number.isFinite(cents) && cents >= 0 && cents <= 100_000;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await updateProfile({ calloutFeeCents: cents });
      if (!r.ok) return setError(mechanicErrorMessage(r));
      setEditing(false);
      onSaved();
    } catch {
      setError(CANT_CONNECT);
    } finally {
      setSaving(false);
    }
  }

  const specialties = SPECIALTIES.filter((s) => p.specialties.includes(s.id)).map((s) => s.label).join(' · ');
  return (
    <View style={styles.card}>
      <View style={styles.facts}>
        <Fact label="Call-out fee" value={formatFee(p.calloutFeeCents)} />
        <Fact label="Travels" value={`${p.serviceRadiusMiles} mi`} />
        <Fact label="Works" value={p.serviceType === 'both' ? 'Mobile + shop' : p.serviceType === 'shop' ? 'At shop' : 'Mobile'} />
      </View>
      <Body muted>{specialties}</Body>
      {editing ? (
        <>
          <TextField label="New call-out fee" value={fee} onChangeText={(t) => setFee(t.replace(/[^0-9.]/g, ''))}
            prefix="$" keyboardType="decimal-pad" maxLength={7} hasError={!valid} autoFocus />
          <ErrorMessage message={error} />
          <PrimaryButton label="Save fee" onPress={save} loading={saving} disabled={!valid} />
          <TextButton label="Cancel" onPress={() => setEditing(false)} />
        </>
      ) : (
        <TextButton label="Change call-out fee" onPress={() => { setFee(String(p.calloutFeeCents / 100)); setEditing(true); }} />
      )}
    </View>
  );
}

function StatRow({ s }: { s: Stats }) {
  return (
    <View style={styles.stats}>
      <Tile label="Jobs done" value={String(s.jobsCompleted)} />
      <Tile label="Call-out fees" value={formatFee(s.calloutFeesCents)} />
      <Tile label="Accepted" value={s.acceptanceRate == null ? '—' : `${Math.round(s.acceptanceRate * 100)}%`} />
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <View style={styles.section}><Label>{title}</Label>{children}</View>;
}
function Tile({ label, value }: { label: string; value: string }) {
  return <View style={styles.tile}><Text style={styles.tileValue}>{value}</Text><Text style={styles.tileLabel}>{label}</Text></View>;
}
function Fact({ label, value }: { label: string; value: string }) {
  return <View style={styles.fact}><Text style={styles.factLabel}>{label}</Text><Text style={styles.factValue}>{value}</Text></View>;
}
function Pill({ text, color }: { text: string; color: string }) {
  return <View style={[styles.pill, { borderColor: color }]}><Text style={[styles.pillText, { color }]}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  wrap: { gap: space.l },
  section: { gap: space.s },
  card: { gap: space.s, padding: space.m, borderRadius: 14, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  cardOnline: { borderColor: colors.success, borderWidth: 2 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.s },
  business: { flex: 1, fontFamily: fonts.heavy, fontSize: 24, color: colors.text },
  cardTitle: { flex: 1, fontFamily: fonts.bold, fontSize: 20, color: colors.text },
  miles: { fontFamily: fonts.bold, fontSize: 18, color: colors.brand },
  pill: { borderWidth: 2, borderRadius: 14, paddingHorizontal: space.s, paddingVertical: 4 },
  pillText: { fontFamily: fonts.bold, fontSize: 14 },
  stats: { flexDirection: 'row', gap: space.s },
  tile: { flex: 1, padding: space.s, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, gap: 2 },
  tileValue: { fontFamily: fonts.heavy, fontSize: 24, color: colors.text },
  tileLabel: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted },
  facts: { flexDirection: 'row', gap: space.s },
  fact: { flex: 1, gap: 2 },
  factLabel: { fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted },
  factValue: { fontFamily: fonts.bold, fontSize: 18, color: colors.text },
  historyRow: { paddingVertical: space.xs, borderBottomWidth: 1, borderBottomColor: colors.border, gap: 2 },
  historyTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text },
  historyMeta: { fontFamily: fonts.regular, fontSize: 15, color: colors.textMuted },
});
