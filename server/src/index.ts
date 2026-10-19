import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import { config } from './config.ts';
import { HttpError } from './http.ts';
import { userFromToken } from './auth.ts';
import { one } from './db.ts';
import { migrate } from './migrate.ts';
import { addUserSocket, joinRunRoom, removeSocket } from './realtime.ts';
import { startScheduler } from './scheduler.ts';
import { telegramEnabled } from './telegram.ts';
import authRoutes from './routes/auth.ts';
import userRoutes from './routes/users.ts';
import runRoutes from './routes/runs.ts';
import ecoRoutes from './routes/eco.ts';
import rewardRoutes from './routes/rewards.ts';
import activityRoutes from './routes/activities.ts';
import clubRoutes from './routes/clubs.ts';
import eventRoutes from './routes/events.ts';
import partnerRoutes from './routes/partner.ts';
import adminRoutes from './routes/admin.ts';
import botRoutes from './routes/bot.ts';

await migrate();
await mkdir(config.uploadsDir, { recursive: true });

const app = Fastify({
  logger: { level: config.isProd ? 'info' : 'info', transport: undefined },
  bodyLimit: 5 * 1024 * 1024,
  trustProxy: config.isProd,
  ajv: { customOptions: { removeAdditional: false, coerceTypes: 'array', allErrors: false } },
});

app.decorateRequest('user', null);

app.setErrorHandler((err: any, req, reply) => {
  if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message !== err.code ? err.message : undefined });
  if (err.validation) return reply.status(400).send({ error: 'validation', message: err.message });
  if (err.statusCode === 429) return reply.status(429).send({ error: 'rate_limited' });
  if (err.statusCode && err.statusCode < 500) return reply.status(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
  req.log.error(err);
  return reply.status(500).send({ error: 'internal' });
});

app.addHook('onSend', async (_req, reply, payload) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'strict-origin-when-cross-origin');
  reply.header('x-frame-options', 'SAMEORIGIN');
  reply.header('permissions-policy', 'geolocation=(self), camera=(self)');
  return payload;
});

await app.register(cors, {
  origin: config.isProd ? [config.publicUrl] : true,
  credentials: false,
});
await app.register(rateLimit, { max: 300, timeWindow: '1 minute' });
await app.register(multipart, { limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
await app.register(websocket);
await app.register(swagger, {
  openapi: {
    info: { title: 'EcoRun API', version: '0.1.0', description: 'Social running + eco-points platform. All endpoints are prefixed with /api/v1.' },
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    security: [{ bearer: [] }],
  },
});
await app.register(swaggerUi, { routePrefix: '/docs' });

await app.register(
  async (api) => {
    api.get('/health', async () => ({ ok: true, db: Boolean(await one('select 1 as ok')), telegram: telegramEnabled(), env: config.env }));
    for (const r of [authRoutes, userRoutes, runRoutes, ecoRoutes, rewardRoutes, activityRoutes, clubRoutes, eventRoutes, partnerRoutes, adminRoutes]) {
      await api.register(r);
    }
    await api.register(botRoutes);

    // Realtime: notifications + run chat rooms. Client sends {type:'auth', token} then {type:'join', runId}.
    api.get('/ws', { websocket: true }, (socket) => {
      let userId: string | null = null;
      const timer = setTimeout(() => !userId && socket.close(4001, 'auth_timeout'), 10_000);
      socket.on('message', async (raw: Buffer) => {
        let msg: any;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return;
        }
        if (msg.type === 'auth') {
          const u = await userFromToken(msg.token);
          if (!u) return socket.close(4001, 'unauthorized');
          userId = u.id;
          clearTimeout(timer);
          addUserSocket(u.id, socket as any);
          socket.send(JSON.stringify({ type: 'ready' }));
        } else if (msg.type === 'join' && userId && typeof msg.runId === 'string' && /^[0-9a-f-]{36}$/.test(msg.runId)) {
          const ok = await one(
            `select 1 from runs r where r.id = $1 and (r.organizer_id = $2 or exists (select 1 from participations p where p.run_id = r.id and p.user_id = $2 and p.status in ('joined','checked_in','waitlist'))
               or exists (select 1 from club_members m where m.club_id = r.club_id and m.user_id = $2 and m.role in ('owner','co_organizer')))`,
            [msg.runId, userId],
          );
          if (ok) joinRunRoom(msg.runId, socket as any);
        } else if (msg.type === 'ping') socket.send('{"type":"pong"}');
      });
      socket.on('close', () => {
        clearTimeout(timer);
        removeSocket(socket as any);
      });
    });
  },
  { prefix: '/api/v1' },
);

await app.register(fastifyStatic, { root: config.uploadsDir, prefix: '/uploads/', decorateReply: false, maxAge: '7d', immutable: true });

if (existsSync(config.webDist)) {
  await app.register(fastifyStatic, { root: config.webDist, prefix: '/' });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/uploads/')) return reply.status(404).send({ error: 'not_found' });
    return reply.sendFile('index.html');
  });
} else {
  app.get('/', async () => ({ name: 'EcoRun API', docs: '/docs', hint: 'Run `npm run build` to serve the web app from this port, or use `npm run dev`.' }));
}

startScheduler(app.log);

await app.listen({ port: config.port, host: process.env.HOST?.trim() || '127.0.0.1' });
app.log.info(`EcoRun API on ${config.publicUrl}  docs: ${config.publicUrl}/docs  telegram: ${telegramEnabled() ? 'on' : 'off (set TELEGRAM_BOT_TOKEN)'}`);
