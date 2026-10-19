import { env } from '../env.js';

/**
 * Every abuse/cost limit in one place. Tune numbers here.
 * (A few can be overridden with env vars, mainly so tests can use small values.)
 */

// ---------- Rate limits (in memory, per server instance) ----------
export const RATE = {
  /** Any request from one IP address, to any route — including routes that don't exist. */
  ipPerMinute: env.RATE_IP_PER_MIN ?? 120,
  /** Any request from one signed-in account, across all its devices. */
  userPerMinute: env.RATE_USER_PER_MIN ?? 120,
  /** Requests one IP may have in progress at the same moment. */
  ipConcurrent: 20,
  /** /health/db wakes the database, so it gets its own tight limit. */
  healthPerMinute: 6,
};

// ---------- Scanner auto-block ----------
// Someone probing the API "page by page" racks up 404s, 401s, 400s. Too many
// in a short window and the IP is blocked from EVERYTHING for a while.
export const SCANNER = {
  badResponses: env.SCANNER_BAD_LIMIT ?? 30,
  windowMinutes: 10,
  blockMinutes: 15,
  // 401 is NOT counted: expired sessions are normal, and many drivers can share
  // one IP at a truck stop or on a carrier network.
  badStatuses: new Set([400, 403, 404, 405, 413, 415]),
};

// ---------- Request throttling ----------
export const REQUEST = {
  maxBodyBytes: 16 * 1024, // 16 KB — the API never needs big bodies (files go straight to storage)
  timeoutMs: 15_000,       // a request taking longer than this is cut off
  headersTimeoutMs: 10_000,// slow clients that dribble headers get dropped
};

// ---------- Usage quotas (stored in the database, survive restarts) ----------
export const QUOTA = {
  smsPerPhonePerHour: 5,
  smsPerPhonePerDay: 10,
  emailPerAddressPerHour: 5,
  emailPerAddressPerDay: 10,
  codesPerIpPerHour: 10,             // phone + email codes combined, per IP
  verifyAttemptsPerEmailPerHour: 10,
  verifyAttemptsPerPhonePerHour: 10, // with 6-digit codes: ~1 in 100,000 odds per hour per phone
  llmMessagesPerUserPerDay: 40,     // ready for the AI assistant
  breakdownRequestsPerUserPerDay: 5,// ready for breakdown requests
  profileEditIntervalDays: 7, // mechanics can change their profile once a week
};

// ---------- Cost caps (whole app, per day). When hit, that feature pauses. ----------
export const COST_CAP = {
  smsPerDay: env.SMS_DAILY_CAP ?? 200,   // ~$1.60/day at ~$0.008/text
  emailPerDay: env.EMAIL_DAILY_CAP ?? 300, // stays inside a free email tier
  llmCallsPerDay: env.LLM_DAILY_CAP ?? 3000, // ~$6/day at ~$0.002/call
};

// ---------- Concurrency caps for slow/expensive work ----------
export const CONCURRENCY = {
  llm: 5, // at most 5 AI calls running at once across the server
};
