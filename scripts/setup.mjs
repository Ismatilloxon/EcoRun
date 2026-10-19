// One-time local setup: creates .env with fresh secrets, migrates and seeds the database.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

let env = existsSync(envPath) ? readFileSync(envPath, 'utf8') : readFileSync(path.join(root, '.env.example'), 'utf8');
const set = (key, value, onlyIfEmpty = true) => {
  const re = new RegExp(`^${key}=(.*)$`, 'm');
  const m = env.match(re);
  if (m && onlyIfEmpty && m[1].trim()) return;
  env = m ? env.replace(re, `${key}=${value}`) : `${env.trimEnd()}\n${key}=${value}\n`;
};

set('JWT_SECRET', crypto.randomBytes(48).toString('base64url'));
set('BOT_INTERNAL_SECRET', crypto.randomBytes(32).toString('base64url'));
if (!/^VAPID_PUBLIC_KEY=.+$/m.test(env)) {
  const keys = webpush.generateVAPIDKeys();
  set('VAPID_PUBLIC_KEY', keys.publicKey);
  set('VAPID_PRIVATE_KEY', keys.privateKey);
}
writeFileSync(envPath, env, { mode: 0o600 });
console.log('.env ready');

const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });
run('npm run migrate -w server');
if (process.argv.includes('--no-seed')) process.exit(0);
run('npm run seed -w server');
