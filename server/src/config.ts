import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envFile = path.join(root, '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const env = (k: string, d = '') => process.env[k]?.trim() || d;

export const config = {
  root,
  env: env('NODE_ENV', 'development'),
  isProd: env('NODE_ENV') === 'production',
  port: Number(env('PORT', '8080')),
  publicUrl: env('PUBLIC_URL', 'http://localhost:8080').replace(/\/$/, ''),
  databaseUrl: env('DATABASE_URL', 'postgres://localhost:5432/ecorun'),
  jwtSecret: env('JWT_SECRET'),
  botSecret: env('BOT_INTERNAL_SECRET'),
  uploadsDir: path.join(root, 'server', 'uploads'),
  webDist: path.join(root, 'web', 'dist'),
  telegram: {
    token: env('TELEGRAM_BOT_TOKEN'),
    username: env('TELEGRAM_BOT_USERNAME').replace(/^@/, ''),
    channelId: env('TELEGRAM_CHANNEL_ID'),
  },
  eskiz: { email: env('ESKIZ_EMAIL'), password: env('ESKIZ_PASSWORD'), from: env('ESKIZ_FROM', '4546') },
  google: { clientId: env('GOOGLE_CLIENT_ID') },
  apple: { clientId: env('APPLE_CLIENT_ID') },
  strava: { clientId: env('STRAVA_CLIENT_ID'), clientSecret: env('STRAVA_CLIENT_SECRET') },
  vapid: { publicKey: env('VAPID_PUBLIC_KEY'), privateKey: env('VAPID_PRIVATE_KEY'), subject: env('VAPID_SUBJECT', 'mailto:admin@ecorun.uz') },
  payments: { payme: env('PAYME_MERCHANT_ID'), click: env('CLICK_SERVICE_ID'), uzum: env('UZUM_MERCHANT_ID') },
};

if (!config.jwtSecret || config.jwtSecret.length < 32) {
  throw new Error('JWT_SECRET missing or shorter than 32 chars. Run `npm run setup` first.');
}

export const smsConfigured = () => Boolean(config.eskiz.email && config.eskiz.password);
