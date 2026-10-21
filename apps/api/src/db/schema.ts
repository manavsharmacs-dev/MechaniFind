import { sql } from 'drizzle-orm';
import {
  pgTable, pgEnum, uuid, text, varchar, integer, boolean, timestamp,
  doublePrecision, jsonb, date, index, uniqueIndex, unique, check, foreignKey,
  customType, bigint, primaryKey,
} from 'drizzle-orm/pg-core';

// ---------- Location type ----------
// geography (not geometry) so distances are in METERS, not degrees.
// Miles -> meters: miles * 1609.344
export type LngLat = { lng: number; lat: number };

export const geographyPoint = customType<{ data: LngLat; driverData: string }>({
  dataType: () => 'geography', // SRID 4326 (GPS lat/lng) is the geography default
  toDriver: ({ lng, lat }) => {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      throw new Error('Invalid coordinates');
    }
    return `SRID=4326;POINT(${lng} ${lat})`;
  },
  fromDriver: (hex) => {
    // Postgres returns EWKB hex for a point
    const buf = Buffer.from(hex, 'hex');
    const le = buf[0] === 1;
    const type = le ? buf.readUInt32LE(1) : buf.readUInt32BE(1);
    const offset = 5 + (type & 0x20000000 ? 4 : 0);
    const lng = le ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
    const lat = le ? buf.readDoubleLE(offset + 8) : buf.readDoubleBE(offset + 8);
    return { lng, lat };
  },
});

// ---------- Shared timestamps ----------
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date());
const deletedAt = () => timestamp('deleted_at', { withTimezone: true }); // soft delete

// ---------- Fixed lists (so typos / LLM output can't invent values) ----------
export const SPECIALTIES = [
  'engine', 'transmission', 'electrical', 'brakes', 'tires', 'suspension',
  'aftertreatment', 'hvac', 'reefer', 'hydraulics', 'trailer', 'general',
] as const;
export const ISSUE_CATEGORIES = [
  'engine', 'transmission', 'electrical', 'brakes', 'tires', 'suspension',
  'aftertreatment', 'hvac', 'reefer', 'hydraulics', 'trailer', 'fuel', 'other',
] as const;
export const TRUCK_TYPES = [
  'sleeper', 'day_cab', 'box_truck', 'straight_truck', 'dump', 'tanker', 'flatbed', 'other',
] as const;

export const specialty = pgEnum('specialty', SPECIALTIES);
export const issueCategory = pgEnum('issue_category', ISSUE_CATEGORIES);
export const truckType = pgEnum('truck_type', TRUCK_TYPES);

export const userRole = pgEnum('user_role', ['driver', 'mechanic', 'fleet_manager', 'admin']);
export const serviceType = pgEnum('service_type', ['mobile', 'shop', 'both']);
export const requestStatus = pgEnum('request_status', ['dispatching', 'assigned', 'completed', 'cancelled', 'unfulfilled']);
export const offerStatus = pgEnum('offer_status', ['pending', 'accepted', 'declined', 'expired']);
export const jobStatus = pgEnum('job_status', ['accepted', 'en_route', 'arrived', 'completed', 'cancelled']);

// ---------- Companies (trucking fleets) ----------
export const companies = pgTable('companies', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 120 }).notNull(),
  dotNumber: varchar('dot_number', { length: 12 }), // USDOT number
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex('companies_dot_unique').on(t.dotNumber).where(sql`${t.dotNumber} is not null`),
]);

// ---------- Users ----------
// Field names match what Better Auth expects (emailVerified, image, phoneNumber, ...).
// When auth is added, point Better Auth at this table (modelName: "users").
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 120 }).notNull(),
  email: varchar('email', { length: 254 }).notNull().unique(), // phone-only users get a placeholder
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  phoneNumber: varchar('phone_number', { length: 16 }).unique(), // E.164, e.g. +18155551234
  phoneNumberVerified: boolean('phone_number_verified').notNull().default(false),
  // Never set from user input — the server decides roles.
  role: userRole('role').notNull().default('driver'),
  // Only set via invite code / fleet-manager approval, never by typing a company name.
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  check('users_email_lowercase', sql`${t.email} = lower(${t.email})`),
  check('users_phone_e164', sql`${t.phoneNumber} is null or ${t.phoneNumber} ~ '^\\+[1-9][0-9]{6,14}$'`),
  index('users_company_idx').on(t.companyId),
]);

// ---------- Trucks ----------
export const trucks = pgTable('trucks', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
  assignedDriverId: text('assigned_driver_id').references(() => users.id, { onDelete: 'set null' }),
  unitNumber: varchar('unit_number', { length: 30 }),
  make: varchar('make', { length: 40 }),
  model: varchar('model', { length: 40 }),
  year: integer('year'),
  truckType: truckType('truck_type'),
  vin: varchar('vin', { length: 17 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  deletedAt: deletedAt(),
}, (t) => [
  check('trucks_year_range', sql`${t.year} is null or ${t.year} between 1980 and 2100`),
  // owner-operator trucks have a driver but no company; fleet trucks have a company
  check('trucks_has_owner', sql`${t.companyId} is not null or ${t.assignedDriverId} is not null`),
  unique('trucks_company_unit_unique').on(t.companyId, t.unitNumber),
  uniqueIndex('trucks_vin_unique').on(t.vin).where(sql`${t.vin} is not null`),
  index('trucks_company_idx').on(t.companyId),
  index('trucks_driver_idx').on(t.assignedDriverId),
]);

// ---------- Mechanic profiles ----------
export const mechanicProfiles = pgTable('mechanic_profiles', {
  userId: text('user_id').primaryKey().references(() => users.id, { onDelete: 'restrict' }),
  businessName: varchar('business_name', { length: 120 }),
  serviceType: serviceType('service_type').notNull(),
  specialties: specialty('specialties').array().notNull().default(sql`'{}'`),
  certifications: jsonb('certifications').notNull().default(sql`'[]'::jsonb`),
  calloutFeeCents: integer('callout_fee_cents'),
  serviceRadiusMiles: integer('service_radius_miles').notNull().default(50),
  location: geographyPoint('location'),
  shopAddress: varchar('shop_address', { length: 200 }),
  serviceArea: varchar('service_area', { length: 200 }), // mobile: where they cover, e.g. "Elgin to Rockford, I-90"
  // Business & insurance details an admin verifies before approval. Changing any needs re-approval.
  llcNumber: varchar('llc_number', { length: 30 }), // state business entity number
  llcState: varchar('llc_state', { length: 2 }),
  ein: varchar('ein', { length: 9 }), // digits only; the API only ever returns the last 4
  usdotNumber: varchar('usdot_number', { length: 8 }), // optional: only needed if they run commercial vehicles
  mcNumber: varchar('mc_number', { length: 8 }),
  insuranceProvider: varchar('insurance_provider', { length: 120 }),
  insurancePolicyNumber: varchar('insurance_policy_number', { length: 40 }),
  insuranceCoverageDollars: integer('insurance_coverage_dollars'),
  insuranceExpiresOn: date('insurance_expires_on', { mode: 'string' }), // no valid insurance = can't go online or accept jobs
  isAvailable: boolean('is_available').notNull().default(false),
  isApproved: boolean('is_approved').notNull().default(false), // only an admin endpoint may change this
  lastLocationAt: timestamp('last_location_at', { withTimezone: true }),
  nameChangedAt: timestamp('name_changed_at', { withTimezone: true }), // business name: 1 change per week
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('mechanic_fee_range', sql`${t.calloutFeeCents} is null or ${t.calloutFeeCents} between 0 and 100000`),
  check('mechanic_radius_range', sql`${t.serviceRadiusMiles} between 1 and 100`),
  check('mechanic_ein_digits', sql`${t.ein} is null or ${t.ein} ~ '^[0-9]{9}$'`),
  check('mechanic_usdot_digits', sql`${t.usdotNumber} is null or ${t.usdotNumber} ~ '^[0-9]{1,8}$'`),
  check('mechanic_mc_digits', sql`${t.mcNumber} is null or ${t.mcNumber} ~ '^[0-9]{1,8}$'`),
  check('mechanic_llc_state', sql`${t.llcState} is null or ${t.llcState} ~ '^[A-Z]{2}$'`),
  check('mechanic_coverage_range', sql`${t.insuranceCoverageDollars} is null or ${t.insuranceCoverageDollars} between 1 and 100000000`),
  check('mechanic_location_is_point', sql`${t.location} is null or ST_GeometryType(${t.location}::geometry) = 'ST_Point'`),
  // matching search only ever looks at available + approved mechanics
  index('mechanic_match_location_idx').using('gist', t.location)
    .where(sql`${t.isAvailable} and ${t.isApproved}`),
  index('mechanic_specialties_idx').using('gin', t.specialties),
]);

// ---------- Service requests (breakdowns) ----------
export const serviceRequests = pgTable('service_requests', {
  id: uuid('id').primaryKey().defaultRandom(),
  driverId: text('driver_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  truckId: uuid('truck_id').references(() => trucks.id, { onDelete: 'restrict' }),
  // Set by the server from the driver's session — never from the request body.
  companyId: uuid('company_id').references(() => companies.id, { onDelete: 'restrict' }),
  description: varchar('description', { length: 2000 }).notNull(), // driver's own words
  faultCode: varchar('fault_code', { length: 40 }),
  category: issueCategory('category'),
  requiredSpecialty: specialty('required_specialty'),
  driverSaysDrivable: boolean('driver_says_drivable'),
  location: geographyPoint('location').notNull(),
  status: requestStatus('status').notNull().default('dispatching'),
  currentWave: integer('current_wave').notNull().default(0),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  cancelReason: varchar('cancel_reason', { length: 200 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check('request_wave_nonnegative', sql`${t.currentWave} >= 0`),
  // A driver can have only ONE open breakdown. Enforced by the database itself,
  // so two taps at the same instant can't create two.
  uniqueIndex('one_open_request_per_driver').on(t.driverId)
    .where(sql`${t.status} in ('dispatching', 'assigned')`),
  check('request_location_is_point', sql`ST_GeometryType(${t.location}::geometry) = 'ST_Point'`),
  index('request_location_idx').using('gist', t.location),
  index('request_status_idx').on(t.status),
  index('request_company_created_idx').on(t.companyId, t.createdAt),
  index('request_driver_idx').on(t.driverId),
]);

// ---------- Dispatch offers (who got pinged, in which wave) ----------
export const dispatchOffers = pgTable('dispatch_offers', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull().references(() => serviceRequests.id, { onDelete: 'restrict' }),
  mechanicId: text('mechanic_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  wave: integer('wave').notNull(),
  distanceMiles: doublePrecision('distance_miles'),
  status: offerStatus('status').notNull().default('pending'),
  sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => [
  check('offer_wave_nonnegative', sql`${t.wave} >= 0`),
  unique('one_offer_per_mechanic').on(t.requestId, t.mechanicId),
  index('offers_pending_by_mechanic_idx').on(t.mechanicId).where(sql`${t.status} = 'pending'`),
]);

// ---------- Jobs (the accepted request) ----------
export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  requestId: uuid('request_id').notNull().references(() => serviceRequests.id, { onDelete: 'restrict' }),
  mechanicId: text('mechanic_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  status: jobStatus('status').notNull().default('accepted'),
  // The mechanic's fee at the moment they accepted — later price changes don't rewrite history.
  calloutFeeCents: integer('callout_fee_cents'),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }).notNull().defaultNow(),
  enRouteAt: timestamp('en_route_at', { withTimezone: true }),
  arrivedAt: timestamp('arrived_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  updatedAt: updatedAt(),
}, (t) => [
  // Only ONE active job per request — but a cancelled job frees it to be re-dispatched.
  uniqueIndex('one_active_job_per_request').on(t.requestId).where(sql`${t.status} <> 'cancelled'`),
  // A mechanic can only hold a job they were actually offered.
  foreignKey({
    name: 'jobs_must_match_offer',
    columns: [t.requestId, t.mechanicId],
    foreignColumns: [dispatchOffers.requestId, dispatchOffers.mechanicId],
  }).onDelete('restrict'),
  index('jobs_mechanic_status_idx').on(t.mechanicId, t.status),
]);

// =====================================================================
// Auth tables (managed by Better Auth — don't write to these directly)
// =====================================================================

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('accounts_user_idx').on(t.userId)]);

// One-time sign-in codes
export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index('verifications_identifier_idx').on(t.identifier, t.createdAt)]);

// Rate-limit counters, stored in the DB so they survive restarts on free hosting
export const rateLimits = pgTable('rate_limits', {
  id: text('id').primaryKey(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
});

// Usage quotas and daily cost caps (see src/protect/quota.ts)
export const usageCounters = pgTable('usage_counters', {
  scope: text('scope').notNull(),   // "user:<id>", "phone:+1...", or "global"
  action: text('action').notNull(), // e.g. "sms", "llm_message", "budget_sms"
  windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
  count: integer('count').notNull(),
}, (t) => [
  primaryKey({ columns: [t.scope, t.action, t.windowStart] }),
  index('usage_counters_window_idx').on(t.windowStart),
]);

// ---------- Admin audit log ----------
// One row every time an admin views or changes something: who, what, when, result.
// Append-only: database triggers (scripts/db-protect-audit.mts) refuse UPDATE,
// DELETE and TRUNCATE, and stamp `at` with the database clock so it can't be backdated.
// No foreign keys on purpose: deleting a user must never delete or block their history.
// Never put secrets here (full EIN, codes, tokens) — ids and field names only.
export const AUDIT_SOURCES = ['cli', 'api', 'test'] as const;
export const AUDIT_OUTCOMES = ['ok', 'refused'] as const;

export const adminAuditLog = pgTable('admin_audit_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
  actorUserId: text('actor_user_id'),                      // admin's account (admin panel); null for the command-line tool
  actor: varchar('actor', { length: 200 }).notNull(),      // readable "who", e.g. "manavsharma@Manavs-MacBook-Air"
  source: varchar('source', { length: 10 }).notNull(),     // cli | api | test
  action: varchar('action', { length: 60 }).notNull(),     // e.g. "mechanic.approve"
  outcome: varchar('outcome', { length: 10 }).notNull(),   // ok | refused
  targetType: varchar('target_type', { length: 30 }),      // e.g. "mechanic"
  targetId: text('target_id'),                             // e.g. the mechanic's user id
  details: jsonb('details').notNull().default({}),         // before/after values, ids shown, reason refused
}, (t) => [
  check('audit_source_valid', sql`${t.source} in ('cli', 'api', 'test')`),
  check('audit_outcome_valid', sql`${t.outcome} in ('ok', 'refused')`),
  check('audit_details_size', sql`octet_length(${t.details}::text) <= 16000`),
  index('audit_at_idx').on(t.at),
  index('audit_target_idx').on(t.targetType, t.targetId),
]);
