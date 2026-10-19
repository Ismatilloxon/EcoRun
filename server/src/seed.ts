// Demo data for local development. Run with `npm run db:seed` (skips if data exists; `--force` to wipe and reseed).
import { one, pool, q } from './db.ts';
import { migrate } from './migrate.ts';
import { award, BADGES } from './points.ts';
import { saveActivity } from './routes/activities.ts';
import type { Pt } from './geo.ts';

const force = process.argv.includes('--force');
await migrate({ reset: force });

if (!force && (await one('select 1 from users limit 1'))) {
  console.log('seed skipped: data already present (use --force to reset)');
  await pool.end();
  process.exit(0);
}

const tr = (uz: string, ru: string, en: string) => JSON.stringify({ uz, ru, en });

for (const b of BADGES) {
  await q('insert into badges (code, title, description, icon) values ($1,$2,$3,$4) on conflict (code) do nothing', [b.code, JSON.stringify(b.title), JSON.stringify(b.description), b.icon]);
}
await q(`insert into badges (code, title, description, icon) values ('october_50', $1, $2, 'trophy') on conflict do nothing`, [
  tr('Oktabr 50', 'Октябрь 50', 'October 50'), tr('Oktabrda 50 km', '50 км в октябре', '50 km in October'),
]);

type U = { phone: string; name: string; role?: string; gender: string; district: string; level: string; pace: number; time: string };
const people: U[] = [
  { phone: '+998900000001', name: 'Admin EcoRun', role: 'admin', gender: 'male', district: 'Yunusobod', level: 'intermediate', pace: 330, time: 'morning' },
  { phone: '+998900000002', name: 'Malika Moderator', role: 'moderator', gender: 'female', district: 'Mirobod', level: 'beginner', pace: 400, time: 'evening' },
  { phone: '+998900000003', name: 'Jasur Karimov', role: 'club_organizer', gender: 'male', district: 'Yunusobod', level: 'advanced', pace: 290, time: 'morning' },
  { phone: '+998900000004', name: 'Green Bean Partner', role: 'partner', gender: 'female', district: 'Yakkasaroy', level: 'beginner', pace: 420, time: 'day' },
  { phone: '+998900000005', name: 'Dilnoza Rahimova', role: 'club_organizer', gender: 'female', district: 'Chilonzor', level: 'intermediate', pace: 345, time: 'evening' },
  { phone: '+998900000006', name: 'Timur Aliyev', gender: 'male', district: 'Mirzo Ulug‘bek', level: 'intermediate', pace: 320, time: 'morning' },
  { phone: '+998900000007', name: 'Aziza Yusupova', gender: 'female', district: 'Yunusobod', level: 'beginner', pace: 410, time: 'evening' },
  { phone: '+998900000008', name: 'Bekzod Tursunov', gender: 'male', district: 'Shayxontohur', level: 'advanced', pace: 275, time: 'morning' },
  { phone: '+998900000009', name: 'Kamola Nazarova', gender: 'female', district: 'Mirobod', level: 'intermediate', pace: 360, time: 'evening' },
  { phone: '+998900000010', name: 'Sardor Ergashev', gender: 'male', district: 'Chilonzor', level: 'beginner', pace: 430, time: 'day' },
  { phone: '+998900000011', name: 'Nodira Saidova', gender: 'female', district: 'Yakkasaroy', level: 'intermediate', pace: 350, time: 'morning' },
  { phone: '+998900000012', name: 'Otabek Mirzayev', role: 'event_organizer', gender: 'male', district: 'Olmazor', level: 'advanced', pace: 300, time: 'evening' },
];
const ids: Record<string, string> = {};
for (const p of people) {
  const u = await one(
    `insert into users (phone, name, role, gender, district, level, pace_sec_per_km, preferred_time, preferred_distances, age_range, language, onboarded, last_lat, last_lng)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'uz',true, 41.311, 69.279) returning id`,
    [p.phone, p.name, p.role ?? 'runner', p.gender, p.district, p.level, p.pace, p.time, [5, 10], '25-34'],
  );
  ids[p.phone.slice(-2)] = u!.id;
}
const U = (n: string) => ids[n];

const places = {
  cityPark: { lat: 41.3163, lng: 69.2492, address: 'Tashkent City Park, main fountain' },
  yangiUz: { lat: 41.3489, lng: 69.3378, address: 'Yangi O‘zbekiston Park, central gate' },
  ecopark: { lat: 41.3092, lng: 69.2961, address: 'Ecopark, Mirobod entrance' },
  japanese: { lat: 41.3395, lng: 69.3326, address: 'Japanese Garden, north gate' },
  gafur: { lat: 41.3328, lng: 69.2252, address: 'Gafur Gulom Park, lake' },
  milliy: { lat: 41.311, lng: 69.244, address: 'National Park (Milliy bog‘), metro exit' },
  bodomzor: { lat: 41.3365, lng: 69.2836, address: 'Ankhor canal, Bodomzor bridge' },
  chilonzor: { lat: 41.2856, lng: 69.2036, address: 'Chilonzor, Novza park' },
};

// Clubs
const club1 = await one(
  `insert into clubs (name, description, district, lat, lng, address, schedule_text, verified, owner_id, featured, telegram_link)
   values ('Yunusobod Runners', 'Friendly community runs for every level. Pace groups 5:00–7:00. Coffee after every Sunday run.', 'Yunusobod', $1, $2, $3, 'Tue & Thu 19:00 · Sun 08:00', true, $4, true, 'https://t.me/yunusobod_runners') returning id`,
  [places.yangiUz.lat, places.yangiUz.lng, places.yangiUz.address, U('03')],
);
const club2 = await one(
  `insert into clubs (name, description, district, lat, lng, address, schedule_text, verified, owner_id)
   values ('Chilonzor Plogging Crew', 'We run and pick up litter. Bags and gloves provided. Every Saturday morning.', 'Chilonzor', $1, $2, $3, 'Sat 09:00', false, $4) returning id`,
  [places.chilonzor.lat, places.chilonzor.lng, places.chilonzor.address, U('05')],
);
await q(`update clubs set verification_requested_at = now() where id = $1`, [club2!.id]);
for (const [club, owner, members] of [[club1!.id, '03', ['06', '07', '08', '01', '11']], [club2!.id, '05', ['09', '10', '07', '11']]] as const) {
  await q(`insert into club_members (club_id, user_id, role) values ($1, $2, 'owner')`, [club, U(owner)]);
  for (const m of members) await q(`insert into club_members (club_id, user_id) values ($1, $2) on conflict do nothing`, [club, U(m)]);
}
await q(`update club_members set role = 'co_organizer' where club_id = $1 and user_id = $2`, [club1!.id, U('06')]);

// Runs
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
const atDay = (days: number, h: number, m = 0) => {
  const d = new Date(Date.now() + 5 * 3600_000);
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(h - 5, m, 0, 0);
  return d.toISOString();
};
const loop = (c: { lat: number; lng: number }, r = 0.006, n = 24): [number, number][] =>
  Array.from({ length: n + 1 }, (_, i) => [c.lat + r * Math.sin((i / n) * 2 * Math.PI), c.lng + r * 1.3 * Math.cos((i / n) * 2 * Math.PI)]);

type R = { title: string; type: string; start: string; place: keyof typeof places; km: number; paces: string[]; level: string; cap?: number; org: string; club?: string; women?: boolean; approval?: boolean; recurring?: boolean; desc: string; supplies?: string; dropoff?: string; featured?: boolean };
const runs: R[] = [
  { title: 'Sunrise 5K in City Park', type: 'casual', start: inMin(20), place: 'cityPark', km: 5, paces: ['6:00', '6:30'], level: 'all', org: '03', club: 'c1', desc: 'Easy loop around the park, all paces welcome. Check-in opens 30 minutes before start.', featured: true },
  { title: 'Thursday Tempo — Yangi O‘zbekiston', type: 'training', start: atDay(3, 19), place: 'yangiUz', km: 8, paces: ['5:00', '5:30'], level: 'intermediate', cap: 25, org: '03', club: 'c1', recurring: true, desc: '2 km warm-up, 4 km tempo, 2 km cool-down.' },
  { title: 'Saturday Plogging — Novza', type: 'plogging', start: atDay(2, 9), place: 'chilonzor', km: 4, paces: ['7:00'], level: 'beginner', cap: 30, org: '05', club: 'c2', desc: 'Run-walk and collect litter along the Novza park paths.', supplies: 'Bags and gloves provided by the club', dropoff: 'Mahalla recycling point, Novza st. 12', featured: true },
  { title: 'Ecopark Women’s Run', type: 'casual', start: atDay(1, 18, 30), place: 'ecopark', km: 5, paces: ['6:30', '7:00'], level: 'beginner', org: '05', women: true, desc: 'A relaxed women-only evening run.' },
  { title: 'Long Run along Ankhor', type: 'race_prep', start: atDay(4, 7), place: 'bodomzor', km: 18, paces: ['5:15', '5:45'], level: 'advanced', cap: 15, org: '08', approval: true, desc: 'Marathon prep long run. Bring water. Approval required.' },
  { title: 'Japanese Garden Easy 6K', type: 'casual', start: atDay(1, 7, 30), place: 'japanese', km: 6, paces: ['6:00'], level: 'all', org: '06', desc: 'Morning easy run before work.' },
  { title: 'Gafur Gulom Intervals', type: 'training', start: atDay(5, 19), place: 'gafur', km: 7, paces: ['4:45', '5:15'], level: 'intermediate', cap: 4, org: '12', desc: '6 × 800 m around the lake. Small group.' },
  { title: 'National Park Plogging Morning', type: 'plogging', start: atDay(6, 8, 30), place: 'milliy', km: 5, paces: ['6:30'], level: 'all', org: '03', club: 'c1', desc: 'Clean the park with us.', supplies: 'Bring gloves; bags provided', dropoff: 'Park service point near the metro exit' },
];
const runIds: string[] = [];
for (const r of runs) {
  const p = places[r.place];
  const row = await one(
    `insert into runs (organizer_id, club_id, title, description, type, start_at, meeting_lat, meeting_lng, meeting_address, district, route, distance_km, pace_groups, level, capacity, women_only, requires_approval, recurrence_rule, plogging_supplies, plogging_dropoff, featured)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) returning id`,
    [U(r.org), r.club === 'c1' ? club1!.id : r.club === 'c2' ? club2!.id : null, r.title, r.desc, r.type, r.start, p.lat, p.lng, p.address,
      people.find((x) => x.phone.endsWith(r.org))!.district, JSON.stringify(loop(p, 0.004 + r.km * 0.0006)), r.km, r.paces, r.level, r.cap ?? null,
      r.women ?? false, r.approval ?? false, r.recurring ? 'WEEKLY' : null, r.supplies ?? null, r.dropoff ?? null, r.featured ?? false],
  );
  runIds.push(row!.id);
  if (r.recurring) {
    await q('update runs set series_id = id where id = $1', [row!.id]);
    const { extendSeries } = await import('./routes/runs.ts');
    await extendSeries(row!.id);
  }
  await q(`insert into participations (run_id, user_id, status) values ($1, $2, 'joined')`, [row!.id, U(r.org)]);
}
const join = (run: number, users: string[], status = 'joined') =>
  Promise.all(users.map((u) => q(`insert into participations (run_id, user_id, status) values ($1,$2,$3) on conflict do nothing`, [runIds[run], U(u), status])));
await join(0, ['06', '07', '08', '11']);
await join(1, ['06', '08', '11', '09']);
await join(2, ['09', '10', '07', '11', '06']);
await join(3, ['07', '09', '11']);
await join(4, ['06'], 'pending');
await join(6, ['08', '06', '11']);
await join(6, ['09'], 'waitlist');

// A past plogging run with a check-in so plogging submissions can be tried right away
const past = await one(
  `insert into runs (organizer_id, club_id, title, description, type, start_at, meeting_lat, meeting_lng, meeting_address, district, distance_km, level, status, plogging_supplies, plogging_dropoff)
   values ($1,$2,'Morning Plogging — Novza (earlier today)','Earlier today: run + litter pickup.','plogging', now() - interval '3 hours', $3, $4, $5, 'Chilonzor', 4, 'all', 'scheduled', 'Bags provided', 'Novza recycling point') returning id`,
  [U('05'), club2!.id, places.chilonzor.lat, places.chilonzor.lng, places.chilonzor.address],
);
for (const u of ['05', '09', '10', '07']) {
  await q(`insert into participations (run_id, user_id, status, check_in_at, check_in_method) values ($1,$2,'checked_in', now() - interval '3 hours', 'geo')`, [past!.id, U(u)]);
  await award({ userId: U(u), reason: 'group_attendance', amount: 10, sourceType: 'run', sourceId: past!.id });
}

// Messages
await q(`insert into messages (run_id, user_id, body, is_announcement) values ($1,$2,'Meet at the main fountain. Look for the green flag!', true), ($1,$3,'See you there!', false), ($1,$4,'Is 6:30 pace group available?', false), ($1,$2,'Yes — Timur leads 6:30.', false)`, [
  runIds[0], U('03'), U('07'), U('11'),
]);

// Activities with synthetic GPS tracks
function track(center: { lat: number; lng: number }, km: number, paceSec: number, startMs: number): Pt[] {
  const pts: Pt[] = [];
  const lapM = 2000;
  const r = lapM / (2 * Math.PI) / 111000;
  const n = Math.round((km * 1000) / 25);
  let t = startMs;
  for (let i = 0; i <= n; i++) {
    const a = ((i * 25) / lapM) * 2 * Math.PI;
    if (i > 0) t += 0.025 * paceSec * 1000 * (0.95 + Math.random() * 0.1);
    pts.push({ lat: center.lat + r * Math.sin(a), lng: center.lng + (r * Math.cos(a)) / Math.cos((center.lat * Math.PI) / 180), t: Math.round(t) });
  }
  return pts;
}
const runners = ['03', '05', '06', '07', '08', '09', '10', '11', '12', '01'];
const pList = Object.values(places);
for (const [i, r] of runners.entries()) {
  const person = people.find((x) => x.phone.endsWith(r))!;
  for (let d = 1; d <= 6; d++) {
    if ((i + d) % 3 === 0) continue;
    const km = 3 + ((i * 7 + d * 3) % 9);
    const start = Date.now() - d * 86400_000 - (i % 4) * 3600_000;
    const tr0 = track(pList[(i + d) % pList.length], km, person.pace, start);
    await saveActivity({ userId: U(r), startedAt: new Date(start).toISOString(), durationS: Math.round((tr0.at(-1)!.t! - start) / 1000), track: tr0, isCommute: d === 2 && i % 2 === 0, source: 'app' });
  }
}
// One cheating attempt so the anti-cheat flag shows up in admin
{
  const start = Date.now() - 2 * 86400_000;
  const tr0 = track(places.bodomzor, 15, 100, start);
  await saveActivity({ userId: U('10'), startedAt: new Date(start).toISOString(), durationS: Math.round((tr0.at(-1)!.t! - start) / 1000), track: tr0, isCommute: false, source: 'app' });
}

// Eco actions & dirty spots
const ecoApproved = await one(
  `insert into eco_actions (user_id, run_id, bags_small, bags_large, waste_types, lat, lng, status, reviewed_at, reviewed_by)
   values ($1,$2,2,1,'{plastic,mixed}',$3,$4,'approved', now(), $5) returning id`,
  [U('09'), past!.id, places.chilonzor.lat, places.chilonzor.lng, U('05')],
);
await award({ userId: U('09'), reason: 'plogging_bag', amount: (2 + 2) * 15, sourceType: 'eco_action', sourceId: ecoApproved!.id });
const ecoPending = await one(
  `insert into eco_actions (user_id, bags_small, bags_large, waste_types, lat, lng, status, verification)
   values ($1, 1, 1, '{plastic,glass}', 41.3305, 69.2862, 'pending', '{"note":"solo plogging, demo"}') returning id`,
  [U('07')],
);
await award({ userId: U('07'), reason: 'plogging_bag', amount: 45, sourceType: 'eco_action', sourceId: ecoPending!.id, status: 'pending' });
for (const [lat, lng, desc, status, reporter] of [
  [41.2921, 69.2104, 'Plastic bottles along the canal bank', 'approved', '10'],
  [41.3301, 69.3012, 'Construction waste near the running path', 'reported', '07'],
  [41.3469, 69.3402, 'Overflowing bins after weekend picnic', 'approved', '06'],
] as const) {
  const s = await one(`insert into dirty_spots (reporter_id, lat, lng, description, status) values ($1,$2,$3,$4,$5) returning id`, [U(reporter), lat, lng, desc, status]);
  await award({ userId: U(reporter), reason: 'dirty_spot', amount: 5, sourceType: 'dirty_spot', sourceId: s!.id, status: status === 'approved' ? 'confirmed' : 'pending' });
}

// Partners & rewards (fictional demo businesses)
const partner = await one(
  `insert into partners (name, description, contacts, branches, contract_status) values ('Green Bean Coffee', 'Specialty coffee, oat milk, zero-waste cups.', $1, $2, 'active') returning id`,
  [JSON.stringify({ phone: '+998 90 000 00 04', person: 'Partner manager' }), JSON.stringify([{ name: 'Yakkasaroy', address: 'Shota Rustaveli st.' }, { name: 'City Park', address: 'Tashkent City Park' }])],
);
const partner2 = await one(`insert into partners (name, description, contract_status, branches) values ('StrideUp Sport Shop', 'Running shoes and gear.', 'active', $1) returning id`, [JSON.stringify([{ name: 'Mirobod', address: 'Amir Temur ave.' }])]);
const partner3 = await one(`insert into partners (name, description, contract_status) values ('Pulse Gym', 'Gym and recovery studio.', 'active') returning id`);
await q(`insert into partner_users (partner_id, user_id) values ($1, $2)`, [partner!.id, U('04')]);
const rewardsSeed = [
  [partner!.id, 'Free cappuccino', 'Any size cappuccino or flat white.', 'One per visit. Show the QR to the barista.', 'cafe', 60, 40, ['Yakkasaroy', 'City Park']],
  [partner!.id, '20% off any drink', 'Discount on the whole menu of drinks.', 'Not combined with other offers.', 'cafe', 30, 100, ['Yakkasaroy', 'City Park']],
  [partner2!.id, '15% off running shoes', 'Any running shoe model.', 'Valid for one pair.', 'sport', 400, 15, ['Mirobod']],
  [partner2!.id, 'Free running socks', 'Technical running socks.', 'While stock lasts.', 'sport', 150, 25, ['Mirobod']],
  [partner3!.id, 'Day pass to Pulse Gym', 'Full-day access incl. sauna.', 'Book 24h ahead.', 'gym', 250, 20, []],
  [partner3!.id, 'Recovery massage −30%', '30-minute sports massage.', 'Book by phone.', 'gym', 300, 10, []],
  [partner!.id, 'Reusable bamboo cup', 'Eco cup with our logo.', 'Pick up at any branch.', 'eco', 200, 12, ['Yakkasaroy']],
] as const;
for (const r of rewardsSeed) {
  await q(`insert into rewards (partner_id, title, description, terms, category, points_price, stock, branches, valid_until) values ($1,$2,$3,$4,$5,$6,$7,$8, current_date + 90)`, r as any);
}
// Give demo runner (07) enough points to try a reward
await award({ userId: U('07'), reason: 'admin_adjust', amount: 120, sourceType: 'admin', sourceId: 'seed-bonus', note: 'Welcome bonus (demo)' });

// Challenges (this month)
const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, -5)).toISOString();
const monthEnd = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() + 1, 1, -5) - 1000).toISOString();
const ch = [
  [tr('Oyiga 50 km', '50 км за месяц', '50 km this month'), tr('Shu oy davomida 50 km yuguring', 'Пробегите 50 км за месяц', 'Run 50 km during this month'), 'km', 50, 100, 'october_50', null],
  [tr('4 ta guruh yugurishi', '4 групповые пробежки', '4 group runs'), tr('4 ta guruh yugurishida check-in qiling', 'Отметьтесь на 4 групповых пробежках', 'Check in at 4 group runs'), 'group_runs', 4, 60, null, null],
  [tr('3 ta plogging', '3 плоггинга', '3 plogging runs'), tr('3 ta tasdiqlangan plogging', '3 подтверждённых плоггинга', '3 approved plogging actions'), 'plogging_runs', 3, 80, null, partner!.id],
] as const;
for (const c of ch) {
  const row = await one(
    `insert into challenges (title, description, metric, target, reward_points, badge_code, sponsor_partner_id, starts_at, ends_at, reward_text) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [c[0], c[1], c[2], c[3], c[4], c[5], c[6], monthStart, monthEnd, c[6] ? tr('Bonus: bepul kofe', 'Бонус: бесплатный кофе', 'Bonus: a free coffee') : null],
  );
  for (const u of ['06', '07', '08', '09', '11']) await q('insert into challenge_participants (challenge_id, user_id) values ($1, $2) on conflict do nothing', [row!.id, U(u)]);
}

// Donation project
await q(`insert into donation_projects (title, description, sponsor, points_goal, unit_label, points_per_unit) values ($1, $2, 'Green Bean Coffee', 20000, $3, 500)`, [
  tr('Toshkentda 100 ta daraxt', '100 деревьев в Ташкенте', '100 trees for Tashkent'),
  tr('Har 500 ball — homiy tomonidan bitta ko‘chat', 'Каждые 500 баллов — один саженец от спонсора', 'Every 500 points = one sapling planted by the sponsor'),
  tr('ko‘chat', 'саженец', 'sapling'),
]);

// Events
await q(
  `insert into events (organizer_id, title, description, type, start_at, location, lat, lng, distances, registration_closes_at)
   values ($1, 'Tashkent Green Run 2026', 'City eco race with plogging zone. Finisher medals made of recycled metal.', 'eco_run', $2, 'Yangi O‘zbekiston Park', 41.3489, 69.3378, $3, $4),
          ($1, 'Virtual 10K — November', 'Run 10 km anywhere, track it in EcoRun.', 'virtual', $5, 'Anywhere', null, null, $6, null)`,
  [U('12'), atDay(20, 8), JSON.stringify([{ km: 5, price: 0, limit: 500 }, { km: 10, price: 0, limit: 300 }, { km: 21.1, price: 150000, limit: 200 }]), atDay(18, 23), atDay(14, 0), JSON.stringify([{ km: 10, price: 0 }])],
);

// Content
await q(`insert into content (kind, title, body, sort) values
  ('banner', $1, $2, 0),
  ('faq', $3, $4, 1), ('faq', $5, $6, 2), ('faq', $7, $8, 3), ('faq', $9, $10, 4),
  ('terms', $11, $12, 0), ('privacy', $13, $14, 0)`, [
  tr('Plogging shanbaligi', 'Субботник-плоггинг', 'Plogging Saturday'), tr('Shanba kuni Novza bog‘ida — x2 eko-ball', 'В субботу в парке Новза — x2 эко-баллов', 'Saturday at Novza park — double the eco impact'),
  tr('Plogging nima?', 'Что такое плоггинг?', 'What is plogging?'), tr('Yugurish paytida axlat yig‘ish. Har bir qop uchun eko-ball olasiz.', 'Сбор мусора во время пробежки. За каждый мешок — эко-баллы.', 'Picking up litter while running. Every bag earns eco-points.'),
  tr('Eko-ballarni qanday olaman?', 'Как получить эко-баллы?', 'How do I earn eco-points?'), tr('GPS bilan yugurish, guruhda check-in, plogging va do‘stlarni taklif qilish.', 'GPS-пробежки, отметка на групповых пробежках, плоггинг и приглашения друзей.', 'GPS-tracked runs, group run check-ins, plogging and inviting friends.'),
  tr('Check-in qanday ishlaydi?', 'Как работает отметка?', 'How does check-in work?'), tr('Boshlanishdan 30 daqiqa oldin uchrashuv joyidan 150 m ichida yoki tashkilotchi QR kodi orqali.', 'За 30 минут до старта в радиусе 150 м от места встречи или по QR-коду организатора.', 'From 30 minutes before start, within 150 m of the meeting point or by scanning the organizer’s QR code.'),
  tr('Joylashuvim xavfsizmi?', 'Безопасно ли моё местоположение?', 'Is my location safe?'), tr('Uyingiz manzili hech qachon ko‘rsatilmaydi. Marshrut boshi va oxiridagi 200 m yashiriladi.', 'Домашний адрес никогда не показывается. 200 м в начале и конце маршрута скрыты.', 'Your home location is never shown. The first and last 200 m of routes are hidden.'),
  tr('Foydalanish shartlari', 'Условия использования', 'Terms of use'), tr('[YURIDIK MATN — mahsulot egasi tomonidan tasdiqlanadi]', '[ЮРИДИЧЕСКИЙ ТЕКСТ — утверждается владельцем продукта]', '[LEGAL TEXT — to be provided by the product owner]'),
  tr('Maxfiylik siyosati', 'Политика конфиденциальности', 'Privacy policy'), tr('[YURIDIK MATN — «Shaxsiy ma’lumotlar to‘g‘risida»gi qonunga muvofiq]', '[ЮРИДИЧЕСКИЙ ТЕКСТ — в соответствии с законом «О персональных данных»]', '[LEGAL TEXT — per the Law “On Personal Data”]'),
]);

// Reports for the moderation queue
await q(`insert into reports (reporter_id, target_type, target_id, reason, details) values ($1, 'user', $2, 'spam', 'Sends promo links in run chats')`, [U('07'), U('10')]);

// Let async badge/challenge evaluations settle.
await new Promise((r) => setTimeout(r, 1500));
console.log('seed complete');
console.log('Demo logins (dev OTP shown in app):');
for (const p of people) console.log(`  ${p.phone}  ${p.name}  [${p.role ?? 'runner'}]`);
await pool.end();
