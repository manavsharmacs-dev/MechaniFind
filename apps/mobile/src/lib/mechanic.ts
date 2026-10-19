import { apiFetch } from '@/lib/auth-client';

// Must match SPECIALTIES in apps/api/src/db/schema.ts.
export const SPECIALTIES = [
  { id: 'engine', label: 'Engine' },
  { id: 'transmission', label: 'Transmission' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'brakes', label: 'Brakes & air' },
  { id: 'tires', label: 'Tires' },
  { id: 'suspension', label: 'Suspension' },
  { id: 'aftertreatment', label: 'DEF / DPF' },
  { id: 'hvac', label: 'A/C & heat' },
  { id: 'reefer', label: 'Reefer units' },
  { id: 'hydraulics', label: 'Hydraulics' },
  { id: 'trailer', label: 'Trailer' },
  { id: 'general', label: 'General repair' },
] as const;
export type SpecialtyId = (typeof SPECIALTIES)[number]['id'];

export const SERVICE_TYPES = [
  { id: 'mobile', label: 'Mobile' },
  { id: 'shop', label: 'Shop' },
  { id: 'both', label: 'Both' },
] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number]['id'];

export const RADIUS_OPTIONS = [10, 25, 50, 75, 100] as const;

export type MechanicProfile = {
  businessName: string;
  serviceType: ServiceType;
  specialties: SpecialtyId[];
  calloutFeeCents: number;
  serviceRadiusMiles: number;
  location: { lat: number; lng: number } | null;
  shopAddress: string | null;
  status: 'pending' | 'approved';
  isAvailable: boolean;
  nextNameChangeAt: string | null;
};

export type NewMechanicProfile = {
  businessName: string;
  serviceType: ServiceType;
  specialties: SpecialtyId[];
  calloutFeeCents: number;
  serviceRadiusMiles: number;
  location: { lat: number; lng: number };
  shopAddress?: string;
};

type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string; message?: string; fields?: string[] };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  const res = await apiFetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, data: body as T };
  return { ok: false, status: res.status, error: body.error ?? 'unknown', message: body.message, fields: body.fields };
}

/** null = this account has no mechanic profile yet. */
export async function getMyMechanicProfile(): Promise<MechanicProfile | null> {
  const r = await call<MechanicProfile>('/mechanic/profile');
  if (r.ok) return r.data;
  if (r.status === 404) return null;
  throw new Error(r.error);
}

export function createMechanicProfile(p: NewMechanicProfile) {
  return call<MechanicProfile>('/mechanic/profile', { method: 'POST', body: JSON.stringify(p) });
}

const FIELD_NAMES: Record<string, string> = {
  businessName: 'business name',
  serviceType: 'mobile or shop',
  specialties: 'specialties',
  calloutFeeCents: 'call-out fee',
  serviceRadiusMiles: 'service radius',
  location: 'location',
  shopAddress: 'shop address',
};

/** Turns an API error into one sentence the mechanic can act on. */
export function mechanicErrorMessage(r: { status: number; error: string; message?: string; fields?: string[] }): string {
  if (r.error === 'invalid_input' && r.fields?.length) {
    const names = r.fields.map((f) => FIELD_NAMES[f.split('.')[0]!] ?? f);
    return `Check your ${[...new Set(names)].join(', ')}.`;
  }
  return r.message ?? 'Something went wrong. Try again.';
}

export const formatFee = (cents: number) =>
  `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

// ---------- Dashboard ----------

export type Stats = {
  jobsCompleted: number;
  calloutFeesCents: number;
  offersReceived: number;
  offersAccepted: number;
  acceptanceRate: number | null;
  avgSecondsToAccept: number | null;
};

export type Offer = {
  offerId: string;
  requestId: string;
  category: string | null;
  requiredSpecialty: string | null;
  faultCode: string | null;
  driverSaysDrivable: boolean | null;
  description: string;
  approxMiles: number | null;
  sentAt: string;
  expiresAt: string;
};

export type ActiveJob = {
  jobId: string;
  status: 'accepted' | 'en_route' | 'arrived';
  calloutFeeCents: number | null;
  category: string | null;
  faultCode: string | null;
  driverSaysDrivable: boolean | null;
  description: string;
  location: { lat: number; lng: number };
};

export type Dashboard = {
  profile: MechanicProfile;
  canGoOnline: boolean;
  offers: Offer[];
  activeJob: ActiveJob | null;
  stats: { timeZone: string; today: Stats; thisWeek: Stats };
  history: { jobId: string; status: string; finishedAt: string | null; calloutFeeCents: number | null; category: string | null }[];
};

const deviceTimeZone = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return 'America/Chicago'; }
};

/** null = no mechanic profile. */
export async function getDashboard(): Promise<Dashboard | null> {
  const r = await call<Dashboard>(`/mechanic/dashboard?tz=${encodeURIComponent(deviceTimeZone())}`);
  if (r.ok) return r.data;
  if (r.status === 404) return null;
  throw new Error(r.error);
}

export function setAvailability(available: boolean, location?: { lat: number; lng: number }) {
  return call<MechanicProfile>('/mechanic/availability', {
    method: 'POST',
    body: JSON.stringify(available ? { available, location } : { available }),
  });
}

export function sendLocation(location: { lat: number; lng: number }) {
  return call<{ ok: true }>('/mechanic/location', { method: 'POST', body: JSON.stringify({ location }) });
}

export function updateProfile(changes: Partial<NewMechanicProfile>) {
  return call<MechanicProfile>('/mechanic/profile', { method: 'PATCH', body: JSON.stringify(changes) });
}

export const ISSUE_LABELS: Record<string, string> = {
  engine: 'Engine', transmission: 'Transmission', electrical: 'Electrical', brakes: 'Brakes & air',
  tires: 'Tires', suspension: 'Suspension', aftertreatment: 'DEF / DPF', hvac: 'A/C & heat',
  reefer: 'Reefer unit', hydraulics: 'Hydraulics', trailer: 'Trailer', fuel: 'Fuel', other: 'Other',
};
