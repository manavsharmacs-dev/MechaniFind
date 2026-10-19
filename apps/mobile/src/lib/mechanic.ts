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
