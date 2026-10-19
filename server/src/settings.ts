import { q } from './db.ts';

export const DEFAULT_SETTINGS = {
  points: {
    run_km: 1,
    group_attendance: 10,
    plogging_bag: 15,
    plogging_large_bag_multiplier: 2,
    dirty_spot: 5,
    organize_run: 20,
    organize_min_checkins: 5,
    invite: 25,
    commute_km: 2,
  },
  caps: { daily: 300, weekly: 1200, solo_plogging_auto_approve_bags_per_day: 0 },
  impact: { co2_g_per_km: 170, kg_per_small_bag: 2, kg_per_large_bag: 5, co2_kg_per_tree_year: 21 },
  checkin: { radius_m: 150, window_before_min: 30, window_after_min: 90 },
  anticheat: { max_avg_kmh: 25, max_segment_kmh: 45 },
  eco: { max_distance_from_run_m: 3000, max_hours_after_run: 24 },
  rewards: { code_valid_days: 14 },
  levels: [0, 100, 300, 700, 1500, 3000, 6000, 10000],
};

export type Settings = typeof DEFAULT_SETTINGS;
type Section = keyof Settings;

let cache: Settings | null = null;

export async function getSettings(): Promise<Settings> {
  if (cache) return cache;
  const rows = await q<{ key: Section; value: any }>('select key, value from settings');
  const merged: any = structuredClone(DEFAULT_SETTINGS);
  for (const r of rows) {
    if (!(r.key in merged)) continue;
    merged[r.key] = Array.isArray(merged[r.key]) ? r.value : { ...merged[r.key], ...r.value };
  }
  cache = merged;
  return merged;
}

export async function updateSettings(patch: Partial<Record<Section, any>>) {
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_SETTINGS)) continue;
    const def: any = (DEFAULT_SETTINGS as any)[key];
    let clean: any;
    if (Array.isArray(def)) {
      clean = (value as unknown[]).map(Number).filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    } else {
      clean = {};
      for (const k of Object.keys(def)) {
        if (value?.[k] === undefined) continue;
        const n = Number(value[k]);
        if (Number.isFinite(n) && n >= 0) clean[k] = n;
      }
    }
    await q(
      `insert into settings (key, value, updated_at) values ($1, $2, now())
       on conflict (key) do update set value = settings.value || excluded.value, updated_at = now()`,
      [key, JSON.stringify(clean)],
    );
    if (Array.isArray(def)) await q('update settings set value = $2 where key = $1', [key, JSON.stringify(clean)]);
  }
  cache = null;
  return getSettings();
}

export function levelFor(points: number, levels: number[]) {
  let level = 1;
  for (let i = 0; i < levels.length; i++) if (points >= levels[i]) level = i + 1;
  const next = levels[level] ?? null;
  return { level, current: levels[level - 1] ?? 0, next };
}
