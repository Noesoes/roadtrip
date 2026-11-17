export interface LatLng {
  lat: number;
  lng: number;
}

/** A point on the route with cumulative distance and drive time from the origin. */
export interface RoutePoint extends LatLng {
  km: number;
  sec: number;
}

export interface RouteProfile {
  pts: RoutePoint[];
  totalKm: number;
  totalSec: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/**
 * Turn a routed line into a compact profile. `segSec` (per-segment drive
 * times from the router) is used when it lines up with the geometry;
 * otherwise time is spread proportionally to distance.
 */
export function buildProfile(
  coords: [number, number][], // [lng, lat]
  totalSec: number,
  segSec?: number[],
  spacingKm = 0.15,
): RouteProfile {
  const useSeg = !!segSec && segSec.length === coords.length - 1;
  const full: RoutePoint[] = [];
  let km = 0;
  let sec = 0;
  coords.forEach(([lng, lat], i) => {
    if (i > 0) {
      km += haversineKm(full[i - 1], { lat, lng });
      if (useSeg) sec += segSec![i - 1];
    }
    full.push({ lat, lng, km, sec });
  });
  if (!useSeg) for (const p of full) p.sec = km > 0 ? (p.km / km) * totalSec : 0;

  const pts: RoutePoint[] = [];
  full.forEach((p, i) => {
    const last = pts[pts.length - 1];
    if (i === 0 || i === full.length - 1 || p.km - last.km >= spacingKm) pts.push(p);
  });
  return { pts, totalKm: km, totalSec: useSeg ? sec : totalSec };
}

export interface Projection {
  /** Straight-line distance from the point to the route. */
  offKm: number;
  /** Distance along the route to the closest point. */
  km: number;
  /** Drive time from the origin to the closest point. */
  sec: number;
}

/** Closest point on the route, using a local flat-earth approximation. */
export function project(profile: RouteProfile, p: LatLng): Projection {
  const { pts } = profile;
  const kx = Math.cos(rad(p.lat)) * 111.32;
  const ky = 110.57;
  let best = Infinity;
  let bi = 1;
  let bt = 0;
  let ax = (pts[0].lng - p.lng) * kx;
  let ay = (pts[0].lat - p.lat) * ky;
  for (let i = 1; i < pts.length; i++) {
    const bx = (pts[i].lng - p.lng) * kx;
    const by = (pts[i].lat - p.lat) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(1, Math.max(0, -(ax * dx + ay * dy) / len2)) : 0;
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const d2 = cx * cx + cy * cy;
    if (d2 < best) {
      best = d2;
      bi = i;
      bt = t;
    }
    ax = bx;
    ay = by;
  }
  if (pts.length < 2) return { offKm: haversineKm(pts[0], p), km: 0, sec: 0 };
  const a = pts[bi - 1];
  const b = pts[bi];
  return { offKm: Math.sqrt(best), km: a.km + (b.km - a.km) * bt, sec: a.sec + (b.sec - a.sec) * bt };
}

/** Split the route into coarse polylines for corridor searches. */
export function chunkRoute(profile: RouteProfile, chunkKm = 120, stepKm = 2): LatLng[][] {
  const chunks: LatLng[][] = [];
  let cur: RoutePoint[] = [];
  let chunkStart = 0;
  const { pts } = profile;
  pts.forEach((p, i) => {
    const last = cur[cur.length - 1];
    const isEnd = i === pts.length - 1;
    if (!last || isEnd || p.km - last.km >= stepKm) cur.push(p);
    if (!isEnd && p.km - chunkStart >= chunkKm && cur[cur.length - 1] === p) {
      chunks.push(cur);
      cur = [p];
      chunkStart = p.km;
    }
  });
  if (cur.length > 1 || chunks.length === 0) chunks.push(cur);
  return chunks;
}

// Detour time is estimated from straight-line distance off the route:
// out and back, on roads that wind more and run slower than the highway.
const WINDING = 1.4;
const SIDE_ROAD_KMH = 55;

export const detourMinutes = (offKm: number) => ((2 * offKm * WINDING) / SIDE_ROAD_KMH) * 60;
export const maxOffKm = (budgetMin: number) => (budgetMin / 60) * SIDE_ROAD_KMH / (2 * WINDING);
