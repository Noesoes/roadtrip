import { buildProfile, chunkRoute, type LatLng, type RouteProfile } from './geo';
import { buildQuery, classify, type InterestId, type Tags } from './interests';
import type { Poi } from './rank';

export interface Place extends LatLng {
  label: string;
}

async function getJson(url: string, init?: RequestInit, timeoutMs = 30_000) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} responded ${res.status}`);
  return res.json();
}

/** Place search: Photon first, Nominatim if it's down (both built on OpenStreetMap). */
export async function searchPlaces(q: string): Promise<Place[]> {
  try {
    const data = await getJson(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=5&lang=en`, undefined, 8_000);
    return (data.features ?? []).map((f: any) => {
      const p = f.properties ?? {};
      const parts = [p.name, p.city, p.state, p.country].filter(Boolean);
      return { label: [...new Set(parts)].join(', '), lng: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] };
    });
  } catch {
    const data = await getJson(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(q)}`, undefined, 8_000);
    return data.map((r: any) => ({ label: r.display_name, lat: +r.lat, lng: +r.lon }));
  }
}

/** Driving route (OSRM public demo server). */
export async function fetchRoute(a: LatLng, b: LatLng): Promise<RouteProfile> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}` +
    `?overview=full&geometries=geojson&annotations=duration`;
  const data = await getJson(url);
  const route = data.routes?.[0];
  if (!route) throw new Error('No driving route found between those places.');
  return buildProfile(route.geometry.coordinates, route.duration, route.legs?.[0]?.annotation?.duration);
}

const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
let preferred = 0;
/** Servers that couldn't be reached at all this session; skipped while another one works. */
const unreachable = new Set<number>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Public Overpass servers are free and often busy: fail over between them,
 * and retry "busy" responses a few times before giving up.
 */
async function overpass(query: string): Promise<any> {
  let lastErr: unknown;
  for (let round = 0; round < 4; round++) {
    if (round) await sleep(2500 * round);
    if (unreachable.size === OVERPASS.length) unreachable.clear();
    for (let i = 0; i < OVERPASS.length; i++) {
      const idx = (preferred + i) % OVERPASS.length;
      if (unreachable.has(idx)) continue;
      try {
        const res = await fetch(OVERPASS[idx], {
          method: 'POST',
          body: new URLSearchParams({ data: query }),
          signal: AbortSignal.timeout(90_000),
        });
        if (!res.ok) throw new Error(`places server is busy (${res.status})`);
        const data = await res.json();
        preferred = idx;
        return data;
      } catch (err) {
        lastErr = err;
        // No HTTP response at all (blocked, down, timed out): stop asking this server.
        if (!(err instanceof Error && err.message.startsWith('places server'))) unreachable.add(idx);
      }
    }
  }
  const why = lastErr instanceof Error && lastErr.message.startsWith('places server') ? ` The ${lastErr.message}.` : '';
  throw new Error(`Couldn't load places along the route.${why} Please try again in a minute.`);
}

// Only the tags the app reads are kept, so a saved trip stays small.
const KEEP = ['name', 'description', 'opening_hours', 'website', 'wikidata', 'wikipedia', 'cuisine', 'heritage', 'ele'];

function toPoi(el: any): Poi | null {
  const tags: Tags = el.tags ?? {};
  const lat = el.lat ?? el.center?.lat;
  const lng = el.lon ?? el.center?.lon;
  const cls = classify(tags);
  if (!cls || lat == null || lng == null) return null;
  const name = tags.name ?? tags['name:en'];
  const kept: Tags = {};
  for (const k of KEEP) if (tags[k]) kept[k] = tags[k];
  if (kept.description && kept.description.length > 200) kept.description = kept.description.slice(0, 197) + '…';
  return { id: `${el.type}/${el.id}`, lat, lng, name: name ?? cls.kind, named: !!name, ...cls, tags: kept };
}

/**
 * Every candidate stop in a corridor around the route. Long routes are
 * searched in stretches; `missed` counts stretches that couldn't be loaded.
 */
export async function fetchPois(
  profile: RouteProfile,
  interests: InterestId[],
  radiusKm: number,
  onProgress?: (done: number, total: number) => void,
): Promise<{ pois: Poi[]; missed: number }> {
  const chunks = chunkRoute(profile);
  const byId = new Map<string, Poi>();
  let done = 0;
  let next = 0;
  let missed = 0;
  let lastErr: unknown;
  onProgress?.(0, chunks.length);
  const worker = async () => {
    while (next < chunks.length) {
      const chunk = chunks[next++];
      try {
        const data = await overpass(buildQuery(chunk, radiusKm * 1000, interests));
        for (const el of data.elements ?? []) {
          const poi = toPoi(el);
          if (poi) byId.set(poi.id, poi);
        }
      } catch (err) {
        missed++;
        lastErr = err;
      }
      onProgress?.(++done, chunks.length);
    }
  };
  await Promise.all([worker(), worker()]);
  if (missed === chunks.length) throw lastErr;
  return { pois: [...byId.values()], missed };
}
