import { Pool } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import { env } from '../env.js';
import * as schema from './schema.js';

// Pool (WebSocket) driver instead of the HTTP one, because it supports
// real transactions — needed for race-safe job accepts.
export const pool = new Pool({ connectionString: env.DATABASE_URL });
export const db = drizzle({ client: pool, schema });
