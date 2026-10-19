export type LatLng = { lat: number; lng: number };
export const TASHKENT: LatLng = { lat: 41.3111, lng: 69.2797 };

export function distanceM(a: LatLng, b: LatLng) {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const dLat = r(b.lat - a.lat);
  const dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const pathLength = (pts: [number, number][]) =>
  pts.reduce((s, p, i) => (i ? s + distanceM({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: p[0], lng: p[1] }) : 0), 0);

export function getPosition(timeout = 12000): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('geo_unavailable'));
    navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout, maximumAge: 15000 });
  });
}

let cached: LatLng | null = null;
export async function approxPosition(): Promise<LatLng | null> {
  if (cached) return cached;
  try {
    const p = await getPosition(6000);
    cached = { lat: p.coords.latitude, lng: p.coords.longitude };
    return cached;
  } catch {
    return null;
  }
}

/** Parses a GPX file into [lat, lng] points (track points, then route points). */
export function parseGpx(xml: string): [number, number][] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const nodes = [...doc.querySelectorAll('trkpt'), ...doc.querySelectorAll('rtept')];
  const pts = nodes.map((n) => [Number(n.getAttribute('lat')), Number(n.getAttribute('lon'))] as [number, number]).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pts.length <= 1500) return pts;
  const step = Math.ceil(pts.length / 1500);
  return pts.filter((_, i) => i % step === 0);
}
