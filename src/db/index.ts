import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.ts';

declare global {
  var _postgresPool: Pool | undefined;
}

export function resolvePostgresConfig() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (connectionString) {
    return {
      connectionString,
      max: Number(process.env.SQL_POOL_MAX || 10),
      connectionTimeoutMillis: 15000,
    };
  }

  const host = process.env.SQL_HOST || process.env.PGHOST;
  const port = Number(process.env.SQL_PORT || process.env.PGPORT || 5432);
  const database = process.env.SQL_DB_NAME || process.env.PGDATABASE;
  const user = process.env.SQL_USER || process.env.SQL_ADMIN_USER || process.env.PGUSER;
  const password = process.env.SQL_PASSWORD || process.env.SQL_ADMIN_PASSWORD || process.env.PGPASSWORD;

  return {
    host,
    port,
    user,
    password,
    database,
    max: Number(process.env.SQL_POOL_MAX || 10),
    connectionTimeoutMillis: 15000,
  };
}

export const createPool = () => {
  if (!global._postgresPool) {
    global._postgresPool = new Pool(resolvePostgresConfig());

    global._postgresPool.on('error', (err) => {
      console.error('Unexpected error on idle SQL pool client:', err);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();
export const db = drizzle(pool, { schema });

export async function checkDatabaseReadiness(): Promise<{ ready: boolean; latencyMs: number }> {
  const started = Date.now();
  try {
    await pool.query('SELECT 1');
    return { ready: true, latencyMs: Date.now() - started };
  } catch (err) {
    console.error('Database readiness check failed:', err);
    return { ready: false, latencyMs: Date.now() - started };
  }
}
