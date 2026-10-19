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

export default function MechanicSignup() {
  const [businessName, setBusinessName] = useState('');
  const [serviceType, setServiceType] = useState<ServiceType | null>(null);
  const [specialties, setSpecialties] = useState<SpecialtyId[]>([]);
  const [fee, setFee] = useState('');
  const [radius, setRadius] = useState<number>(50);
  const [shopAddress, setShopAddress] = useState('');
  const [spot, setSpot] = useState<Spot | null>(null);
  const [locating, setLocating] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const needsAddress = serviceType === 'shop' || serviceType === 'both';
  const feeCents = Math.round(parseFloat(fee) * 100);
  const feeOk = fee.trim() !== '' && Number.isFinite(feeCents) && feeCents >= 0 && feeCents <= 100_000;

  const missing = [
    businessName.trim().length < 2 && 'business name',
    !serviceType && 'mobile or shop',
    specialties.length === 0 && 'at least one specialty',
    !feeOk && 'call-out fee ($0–$1,000)',
    needsAddress && shopAddress.trim().length < 5 && 'shop address',
    !spot && 'your location',
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
