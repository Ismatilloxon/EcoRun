import pg from 'pg';
import { config } from './config.ts';

pg.types.setTypeParser(1700, (v) => Number(v)); // numeric -> number
pg.types.setTypeParser(20, (v) => Number(v)); // bigint -> number (counts, ids fit in 2^53)

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

// Rows are dynamic SQL results; routes validate input, not output shapes.
export type Row = any;

export async function q<T = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function one<T = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    client.release();
  }
}

export type Db = Pick<pg.PoolClient, 'query'>;
