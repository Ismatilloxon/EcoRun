import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from './config.ts';

const dir = path.join(config.root, 'server', 'migrations');

async function ensureDatabase() {
  const url = new URL(config.databaseUrl);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  const exists = await admin.query('select 1 from pg_database where datname = $1', [name]);
  if (!exists.rowCount) {
    await admin.query(`create database "${name.replace(/"/g, '')}"`);
    console.log(`created database ${name}`);
  }
  await admin.end();
}

export async function migrate({ reset = false } = {}) {
  await ensureDatabase();
  const client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
  if (reset) {
    await client.query('drop schema public cascade; create schema public;');
    console.log('schema reset');
  }
  await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())');
  const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    if (done.has(file)) continue;
    const sql = readFileSync(path.join(dir, file), 'utf8');
    await client.query('begin');
    try {
      await client.query(sql);
      await client.query('insert into schema_migrations (name) values ($1)', [file]);
      await client.query('commit');
      console.log(`applied ${file}`);
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  }
  await client.end();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => console.log('migrations up to date'))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
