export type Pt = { lat: number; lng: number; t?: number };

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: Pt, b: Pt) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function pathLengthM(pts: Pt[]) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += distanceM(pts[i - 1], pts[i]);
  return d;
}

export function minDistanceToPath(p: Pt, path: Pt[]) {
  if (!path.length) return Infinity;
  return Math.min(...path.map((x) => distanceM(p, x)));
}

/** Track analysis: per-km splits, best efforts, anti-cheat flags. Points need `t` in ms. */
export function analyzeTrack(pts: Pt[], opts: { maxAvgKmh: number; maxSegmentKmh: number }) {
  const timed = pts.filter((p) => typeof p.t === 'number');
  const cum: number[] = [0];
  for (let i = 1; i < timed.length; i++) cum.push(cum[i - 1] + distanceM(timed[i - 1], timed[i]));

  const splits: { km: number; sec: number }[] = [];
  let nextKm = 1000;
  let lastSplitT = timed[0]?.t ?? 0;
  for (let i = 1; i < timed.length; i++) {
    while (cum[i] >= nextKm) {
      const frac = (nextKm - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      const t = timed[i - 1].t! + frac * (timed[i].t! - timed[i - 1].t!);
      splits.push({ km: nextKm / 1000, sec: Math.round((t - lastSplitT) / 1000) });
      lastSplitT = t;
      nextKm += 1000;
    }
  }

  const bestEfforts: Record<string, number> = {};
  for (const [label, target] of [['1k', 1000], ['5k', 5000], ['10k', 10000], ['21k', 21097.5]] as const) {
    if ((cum.at(-1) ?? 0) < target) continue;
    let best = Infinity;
    let j = 0;
    for (let i = 0; i < timed.length; i++) {
      while (j < timed.length && cum[j] - cum[i] < target) j++;
      if (j >= timed.length) break;
      best = Math.min(best, (timed[j].t! - timed[i].t!) / 1000);
    }
    if (Number.isFinite(best)) bestEfforts[label] = Math.round(best);
  }

  const flags: string[] = [];
  let jumps = 0;
  for (let i = 1; i < timed.length; i++) {
    const dt = (timed[i].t! - timed[i - 1].t!) / 1000;
    const dd = cum[i] - cum[i - 1];
    if (dt > 0 && dd > 200 && (dd / dt) * 3.6 > opts.maxSegmentKmh) jumps++;
  }
  if (jumps > 0) flags.push(`gps_jump x${jumps}`);
  return { distanceM: cum.at(-1) ?? 0, splits, bestEfforts, flags };
}

/** Hide the first/last `zoneM` metres of a track from other viewers (privacy zone). */
export function trimPrivacyZone(pts: Pt[], zoneM = 200) {
  if (pts.length < 3) return [];
  const start = pts[0];
  const end = pts[pts.length - 1];
  return pts.filter((p) => distanceM(p, start) > zoneM && distanceM(p, end) > zoneM);
}

/** Round to ~110 m grid for coarse location storage. */
export const coarse = (v: number) => Math.round(v * 1000) / 1000;
