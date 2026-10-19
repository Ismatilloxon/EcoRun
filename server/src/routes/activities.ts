import type { FastifyInstance } from 'fastify';
import { config } from '../config.ts';
import { one, q } from '../db.ts';
import { fail, idParam, S } from '../http.ts';
import { optionalAuth, requireAuth, randomToken } from '../auth.ts';
import { analyzeTrack, pathLengthM, trimPrivacyZone, type Pt } from '../geo.ts';
import { afterProgress, award, maybeRewardInviter } from '../points.ts';
import { getSettings } from '../settings.ts';
import { canView } from './users.ts';

type NewActivity = {
  userId: string;
  runId?: string | null;
  startedAt: string;
  durationS: number;
  track: Pt[] | null;
  distanceM?: number;
  isCommute: boolean;
  source: 'app' | 'strava' | 'health';
  externalId?: string | null;
};

/** Saves an activity, runs anti-cheat, awards km points. Used by the tracker and imports. */
export async function saveActivity(a: NewActivity) {
  const s = await getSettings();
  const flags: string[] = [];
  let splits: unknown[] = [];
  let bestEfforts: Record<string, number> = {};
  let distance = a.distanceM ?? 0;
  if (a.track && a.track.length >= 2) {
    const an = analyzeTrack(a.track, { maxAvgKmh: s.anticheat.max_avg_kmh, maxSegmentKmh: s.anticheat.max_segment_kmh });
    distance = a.track.some((p) => p.t != null) ? an.distanceM : pathLengthM(a.track);
    splits = an.splits;
    bestEfforts = an.bestEfforts;
    flags.push(...an.flags);
  }
  if (distance < 100) fail(400, 'activity_too_short');
  if (a.durationS < 30) fail(400, 'activity_too_short');
  const avgKmh = distance / 1000 / (a.durationS / 3600);
  if (avgKmh > s.anticheat.max_avg_kmh) flags.push(`avg_speed ${avgKmh.toFixed(1)} km/h`);
  const flagged = flags.length > 0;
  const avgPace = Math.round(a.durationS / (distance / 1000));

  const act = await one(
    `insert into activities (user_id, run_id, started_at, distance_m, duration_s, avg_pace_s, track, splits, best_efforts, source, external_id, is_commute, flagged, flag_reason)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     on conflict (user_id, source, external_id) do nothing
     returning id, distance_m, duration_s, avg_pace_s, splits, best_efforts, flagged, flag_reason, is_commute, started_at`,
    [
      a.userId, a.runId ?? null, a.startedAt, Math.round(distance), a.durationS, avgPace, a.track ? JSON.stringify(a.track) : null,
      JSON.stringify(splits), JSON.stringify(bestEfforts), a.source, a.externalId ?? null, a.isCommute, flagged, flags.join('; ') || null,
    ],
  );
  if (!act) return null; // duplicate import
  let points = 0;
  // Points only for GPS-tracked runs that pass anti-cheat.
  if (!flagged && (a.track?.length ?? 0) >= 2) {
    const km = Math.floor(distance / 1000);
    const reason = a.isCommute ? 'commute_km' : 'run_km';
    const rate = a.isCommute ? s.points.commute_km : s.points.run_km;
    if (km > 0) {
      const t = await award({ userId: a.userId, reason, amount: km * rate, sourceType: 'activity', sourceId: act.id });
      points = t?.amount ?? 0;
    }
    await maybeRewardInviter(a.userId);
  }
  afterProgress(a.userId);
  return { ...act, points };
}

/** Decodes a Google/Strava encoded polyline. */
function decodePolyline(str: string): Pt[] {
  const pts: Pt[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    for (const which of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do {
        b = str.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (which === 0) lat += d;
      else lng += d;
    }
    pts.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return pts;
}

async function stravaToken(userId: string) {
  const u = await one('select strava_tokens from users where id = $1', [userId]);
  const t = u?.strava_tokens;
  if (!t) fail(400, 'strava_not_linked');
  if (t.expires_at * 1000 > Date.now() + 60_000) return t.access_token as string;
  const res = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_id: config.strava.clientId, client_secret: config.strava.clientSecret, grant_type: 'refresh_token', refresh_token: t.refresh_token }),
  });
  const json: any = await res.json();
  if (!json.access_token) fail(502, 'strava_refresh_failed');
  await q('update users set strava_tokens = $2 where id = $1', [userId, JSON.stringify({ access_token: json.access_token, refresh_token: json.refresh_token, expires_at: json.expires_at })]);
  return json.access_token as string;
}

async function importStrava(userId: string) {
  const token = await stravaToken(userId);
  const res = await fetch('https://www.strava.com/api/v3/athlete/activities?per_page=30', { headers: { authorization: `Bearer ${token}` } });
  const list: any[] = await res.json();
  let imported = 0;
  for (const a of Array.isArray(list) ? list : []) {
    if (!['Run', 'TrailRun', 'VirtualRun'].includes(a.sport_type ?? a.type)) continue;
    const track = a.map?.summary_polyline ? decodePolyline(a.map.summary_polyline) : null;
    const r = await saveActivity({
      userId, startedAt: a.start_date, durationS: a.moving_time, distanceM: a.distance, track, isCommute: Boolean(a.commute), source: 'strava', externalId: String(a.id),
    }).catch(() => null);
    if (r) imported++;
  }
  return imported;
}

const stravaStates = new Map<string, { userId: string; at: number }>();

export default async function activityRoutes(app: FastifyInstance) {
  app.post(
    '/activities',
    {
      preHandler: requireAuth,
      config: { rateLimit: { max: 30, timeWindow: '1 hour' } },
      schema: {
        tags: ['activities'],
        bodyLimit: 4 * 1024 * 1024,
        body: S.obj(
          {
            started_at: S.str({ format: 'date-time' }),
            duration_s: S.int({ minimum: 1, maximum: 86400 }),
            track: S.arr(S.obj({ lat: S.num(), lng: S.num(), t: S.num(), acc: S.num() }, ['lat', 'lng', 't']), { maxItems: 40000 }),
            is_commute: S.bool(),
            run_id: S.nuuid(),
            client_id: S.str({ maxLength: 64 }),
          },
          ['started_at', 'duration_s', 'track'],
        ),
      },
    },
    async (req) => {
      const b = req.body as any;
      if (new Date(b.started_at).getTime() > Date.now() + 5 * 60_000) fail(400, 'future_activity');
      // Drop very inaccurate fixes (> 50 m) before analysis.
      const track = (b.track as any[]).filter((p) => p.acc == null || p.acc <= 50).map((p) => ({ lat: p.lat, lng: p.lng, t: p.t }));
      return saveActivity({
        userId: req.user!.id, runId: b.run_id ?? null, startedAt: b.started_at, durationS: b.duration_s, track, isCommute: Boolean(b.is_commute),
        source: 'app', externalId: b.client_id ?? null,
      });
    },
  );

  app.get('/activities/:id', { preHandler: optionalAuth, schema: { tags: ['activities'], params: idParam } }, async (req) => {
    const a = await one(
      `select a.*, u.visibility, u.hide_location, u.name, u.photo_url from activities a join users u on u.id = a.user_id where a.id = $1 and u.deleted_at is null`,
      [(req.params as any).id],
    );
    if (!a) fail(404, 'not_found');
    const own = req.user?.id === a!.user_id;
    if (!own && !(await canView(req.user?.id ?? null, { id: a!.user_id, visibility: a!.visibility }))) fail(404, 'not_found');
    if (!own && a!.hide_location) a!.track = trimPrivacyZone(a!.track ?? []);
    const points = own ? await one(`select coalesce(sum(amount), 0) as p from points_transactions where source_type = 'activity' and source_id = $1`, [a!.id]) : null;
    delete a!.visibility;
    delete a!.hide_location;
    return { ...a, points: points?.p ?? null };
  });

  app.delete('/activities/:id', { preHandler: requireAuth, schema: { tags: ['activities'], params: idParam } }, async (req) => {
    const r = await one('delete from activities where id = $1 and user_id = $2 returning id', [(req.params as any).id, req.user!.id]);
    if (!r) fail(404, 'not_found');
    await q(`update points_transactions set status = 'rejected', note = 'activity_deleted' where source_type = 'activity' and source_id = $1`, [r!.id]);
    return { ok: true };
  });

  // ---- Strava ----
  app.get('/integrations/strava/url', { preHandler: requireAuth, schema: { tags: ['integrations'] } }, async (req) => {
    if (!config.strava.clientId) fail(501, 'strava_not_configured');
    const state = randomToken(16);
    stravaStates.set(state, { userId: req.user!.id, at: Date.now() });
    const redirect = `${config.publicUrl}/api/v1/integrations/strava/callback`;
    return {
      url: `https://www.strava.com/oauth/authorize?client_id=${config.strava.clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&approval_prompt=auto&scope=read,activity:read&state=${state}`,
    };
  });

  app.get('/integrations/strava/callback', { schema: { tags: ['integrations'], querystring: S.obj({ code: S.str(), state: S.str(), scope: S.str(), error: S.str() }) } }, async (req, reply) => {
    const { code, state } = req.query as any;
    const st = stravaStates.get(state);
    stravaStates.delete(state);
    if (!st || Date.now() - st.at > 10 * 60_000 || !code) return reply.redirect('/profile?strava=error');
    const res = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ client_id: config.strava.clientId, client_secret: config.strava.clientSecret, code, grant_type: 'authorization_code' }),
    });
    const json: any = await res.json();
    if (!json.access_token) return reply.redirect('/profile?strava=error');
    await q('update users set strava_id = $2, strava_tokens = $3 where id = $1', [
      st.userId, String(json.athlete?.id), JSON.stringify({ access_token: json.access_token, refresh_token: json.refresh_token, expires_at: json.expires_at }),
    ]).catch(() => null);
    importStrava(st.userId).catch((e) => req.log.error(e));
    return reply.redirect('/profile?strava=ok');
  });

  app.post('/integrations/strava/sync', { preHandler: requireAuth, schema: { tags: ['integrations'] } }, async (req) => ({ imported: await importStrava(req.user!.id) }));

  app.post('/integrations/strava/unlink', { preHandler: requireAuth, schema: { tags: ['integrations'] } }, async (req) => {
    await q('update users set strava_id = null, strava_tokens = null where id = $1', [req.user!.id]);
    return { ok: true };
  });

  app.get('/integrations', { preHandler: optionalAuth, schema: { tags: ['integrations'] } }, async () => ({
    strava: Boolean(config.strava.clientId),
    payments: { payme: Boolean(config.payments.payme), click: Boolean(config.payments.click), uzum: Boolean(config.payments.uzum) },
  }));
}
