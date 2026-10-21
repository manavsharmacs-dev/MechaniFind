import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import * as Location from 'expo-location';
import { Body, ErrorMessage, Label, PrimaryButton, Screen, SignPanel, TextButton } from '@/components/ui';
import { Chips, OutlineButton, Segmented, TextField } from '@/components/form';
import {
  createMechanicProfile, mechanicErrorMessage, RADIUS_OPTIONS, SERVICE_TYPES, SPECIALTIES,
  type ServiceType, type SpecialtyId,
} from '@/lib/mechanic';
import { CANT_CONNECT } from '@/lib/auth-errors';
import { colors, space } from '@/theme';

type Spot = { lat: number; lng: number; label: string };

const digitsOnly = (t: string, max: number) => t.replace(/\D/g, '').slice(0, max);

/** "06/30/2027" -> "2027-06-30", or null if it isn't a real date. */
function toISODate(s: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${m[1]}-${m[2]}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(iso) ? iso : null;
}

export default function MechanicSignup() {
  const [businessName, setBusinessName] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType | null>(null);
  const [specialties, setSpecialties] = useState<SpecialtyId[]>([]);
  const [fee, setFee] = useState('');
  const [radius, setRadius] = useState<number>(50);
  const [shopAddress, setShopAddress] = useState('');
  const [serviceArea, setServiceArea] = useState('');
  const [llcNumber, setLlcNumber] = useState('');
  const [llcState, setLlcState] = useState('');
  const [ein, setEin] = useState('');
  const [usdot, setUsdot] = useState('');
  const [mc, setMc] = useState('');
  const [insurer, setInsurer] = useState('');
  const [policy, setPolicy] = useState('');
  const [coverage, setCoverage] = useState('');
  const [expires, setExpires] = useState('');
  const [spot, setSpot] = useState<Spot | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsAddress = serviceType === 'shop' || serviceType === 'both';
  const feeCents = Math.round(parseFloat(fee) * 100);
  const feeOk = fee.trim() !== '' && Number.isFinite(feeCents) && feeCents >= 0 && feeCents <= 100_000;
  const einDigits = ein.replace(/\D/g, '');
  const coverageDollars = Number(coverage);
  const coverageOk = coverage !== '' && Number.isInteger(coverageDollars) && coverageDollars >= 1 && coverageDollars <= 100_000_000;
  const expiresOn = toISODate(expires);
  const expiresOk = !!expiresOn && expiresOn > new Date().toISOString().slice(0, 10);

  const missing = [
    businessName.trim().length < 2 && 'business name',
    !serviceType && 'mobile or shop',
    specialties.length === 0 && 'at least one specialty',
    !feeOk && 'call-out fee ($0–$1,000)',
    needsAddress && shopAddress.trim().length < 5 && 'shop address',
    serviceType === 'mobile' && serviceArea.trim().length < 3 && 'service area',
    !spot && 'your location',
    llcNumber.trim().length < 3 && 'LLC / business number',
    !/^[A-Za-z]{2}$/.test(llcState) && 'state',
    einDigits.length !== 9 && 'EIN (9 digits)',
    insurer.trim().length < 2 && 'insurance company',
    policy.trim().length < 4 && 'policy number',
    !coverageOk && 'coverage amount',
    !expiresOk && 'insurance expiration date (MM/DD/YYYY, in the future)',
  ].filter(Boolean) as string[];

  function toggleSpecialty(id: SpecialtyId) {
    setSpecialties((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function useMyLocation() {
    setError(null);
    setLocating(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationDenied(true);
        return;
      }
      setLocationDenied(false);
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude: lat, longitude: lng } = pos.coords;
      let label = 'Location set';
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
        if (place?.city) label = `Near ${place.city}${place.region ? `, ${place.region}` : ''}`;
      } catch {
        // The city name is just a nicety; coordinates are what matter.
      }
      setSpot({ lat, lng, label });
    } catch {
      setError("Couldn't get your location. Make sure location is on, then try again.");
    } finally {
      setLocating(false);
    }
  }

  async function submit() {
    if (missing.length) {
      setError(`Still needed: ${missing.join(', ')}.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const r = await createMechanicProfile({
        businessName: businessName.trim(),
        serviceType: serviceType!,
        specialties,
        calloutFeeCents: feeCents,
        serviceRadiusMiles: radius,
        location: { lat: spot!.lat, lng: spot!.lng },
        ...(needsAddress ? { shopAddress: shopAddress.trim() } : {}),
        ...(serviceType === 'mobile' ? { serviceArea: serviceArea.trim() } : {}),
        llcNumber: llcNumber.trim(),
        llcState: llcState.toUpperCase(),
        ein: einDigits,
        ...(usdot ? { usdotNumber: usdot } : {}),
        ...(mc ? { mcNumber: mc } : {}),
        insuranceProvider: insurer.trim(),
        insurancePolicyNumber: policy.trim(),
        insuranceCoverageDollars: coverageDollars,
        insuranceExpiresOn: expiresOn!,
      });
      if (!r.ok) return setError(mechanicErrorMessage(r));
      router.dismissTo('/'); // home shows "Pending approval"
    } catch {
      setError(CANT_CONNECT);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <SignPanel title="Join as a mechanic" subtitle="Get breakdown jobs near you. We review every mechanic before they go live." />

      <TextField
        label="Business name"
        value={businessName}
        onChangeText={setBusinessName}
        placeholder="Joe's Diesel Repair"
        autoCapitalize="words"
        maxLength={120}
        hint="You can change this once a week, and changes need re-approval."
      />

      <Segmented label="How do you work?" options={SERVICE_TYPES} value={serviceType} onChange={setServiceType} />

      {needsAddress ? (
        <TextField
          label="Shop address"
          value={shopAddress}
          onChangeText={setShopAddress}
          placeholder="123 Main St, Elgin, IL"
          autoCapitalize="words"
          maxLength={200}
        />
      ) : null}

      {serviceType === 'mobile' ? (
        <TextField
          label="Service area"
          value={serviceArea}
          onChangeText={setServiceArea}
          placeholder="Elgin to Rockford, I-90 and I-39"
          maxLength={200}
          hint="Cities and highways you cover. Shown to our review team."
        />
      ) : null}

      <Chips
        label="Specialties"
        hint="Pick everything you work on. Jobs are matched on these."
        options={SPECIALTIES}
        selected={specialties}
        onToggle={toggleSpecialty}
      />

      <TextField
        label="Call-out fee"
        value={fee}
        onChangeText={(t) => setFee(t.replace(/[^0-9.]/g, ''))}
        prefix="$"
        placeholder="150"
        keyboardType="decimal-pad"
        maxLength={7}
        hasError={fee !== '' && !feeOk}
        hint="Shown to drivers before they confirm. The rest is settled with the driver on site."
      />

      <Segmented
        label="How far will you travel?"
        options={RADIUS_OPTIONS.map((m) => ({ id: m, label: `${m} mi` }))}
        value={radius}
        onChange={setRadius}
      />

      <View style={styles.field}>
        <Label>{serviceType === 'shop' ? 'Shop location' : 'Your location'}</Label>
        {spot ? <Body>📍 {spot.label}</Body> : null}
        <OutlineButton
          label={locating ? 'Finding you…' : spot ? 'Update location' : 'Use my current location'}
          onPress={useMyLocation}
          disabled={locating}
        />
        <Body muted>
          {serviceType === 'shop'
            ? 'Do this while you are at the shop.'
            : 'Used to match you with breakdowns nearby. Only shared while you are available.'}
        </Body>
        {locationDenied ? (
          <View style={styles.denied}>
            <ErrorMessage message="Location permission is off. MechaniFind needs it to send you nearby jobs." />
            <TextButton label="Open Settings" onPress={() => Linking.openSettings()} />
          </View>
        ) : null}
      </View>

      <Label>Business details</Label>
      <Body muted>We verify these before you can take jobs. Changing them later needs re-approval.</Body>

      <TextField
        label="LLC / business registration number"
        value={llcNumber}
        onChangeText={setLlcNumber}
        placeholder="LLC1234567"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={30}
      />
      <TextField
        label="State registered in"
        value={llcState}
        onChangeText={(t) => setLlcState(t.replace(/[^A-Za-z]/g, '').toUpperCase())}
        placeholder="IL"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={2}
      />
      <TextField
        label="EIN (federal tax ID)"
        value={ein}
        onChangeText={(t) => {
          const d = digitsOnly(t, 9);
          setEin(d.length > 2 ? `${d.slice(0, 2)}-${d.slice(2)}` : d);
        }}
        placeholder="12-3456789"
        keyboardType="number-pad"
        maxLength={10}
        hasError={einDigits.length > 0 && einDigits.length !== 9}
        hint="Kept private. Only the last 4 digits are ever shown."
      />
      <TextField
        label="USDOT number (optional)"
        value={usdot}
        onChangeText={(t) => setUsdot(digitsOnly(t, 8))}
        placeholder="1234567"
        keyboardType="number-pad"
        maxLength={8}
        hint="Only if your service truck needs one."
      />
      <TextField
        label="MC number (optional)"
        value={mc}
        onChangeText={(t) => setMc(digitsOnly(t, 8))}
        prefix="MC-"
        placeholder="123456"
        keyboardType="number-pad"
        maxLength={8}
      />

      <Label>Insurance</Label>
      <Body muted>{"Liability / garagekeepers coverage, so damage to a driver's truck is covered. You can't go online once it expires."}</Body>

      <TextField
        label="Insurance company"
        value={insurer}
        onChangeText={setInsurer}
        placeholder="Progressive Commercial"
        autoCapitalize="words"
        maxLength={120}
      />
      <TextField
        label="Policy number"
        value={policy}
        onChangeText={setPolicy}
        placeholder="PC-123-4567"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={40}
      />
      <TextField
        label="Coverage amount"
        value={coverage}
        onChangeText={(t) => setCoverage(digitsOnly(t, 9))}
        prefix="$"
        placeholder="1000000"
        keyboardType="number-pad"
        maxLength={9}
        hasError={coverage !== '' && !coverageOk}
      />
      <TextField
        label="Expiration date"
        value={expires}
        onChangeText={(t) => {
          const d = digitsOnly(t, 8);
          setExpires([d.slice(0, 2), d.slice(2, 4), d.slice(4)].filter(Boolean).join('/'));
        }}
        placeholder="MM/DD/YYYY"
        keyboardType="number-pad"
        maxLength={10}
        hasError={expires.length === 10 && !expiresOk}
      />

      <ErrorMessage message={error} />
      <PrimaryButton label="Submit for review" onPress={submit} loading={saving} />
      <TextButton label="Cancel" onPress={() => router.back()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  field: { gap: space.s },
  denied: { gap: space.xs, borderLeftWidth: 3, borderLeftColor: colors.error, paddingLeft: space.s },
});
