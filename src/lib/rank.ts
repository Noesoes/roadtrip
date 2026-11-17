import * as OpeningHoursNs from 'opening_hours';
import * as SunCalcNs from 'suncalc';
import { detourMinutes, project, type RouteProfile } from './geo';
import type { InterestId, Tags } from './interests';

export interface Poi {
  id: string;
  lat: number;
  lng: number;
  name: string;
  /** False when the place has no name of its own and we fall back to its kind. */
  named: boolean;
  kind: string;
  interests: InterestId[];
  tags: Tags;
}

export interface Suggestion extends Poi {
  /** Distance along the route where you'd turn off. */
  km: number;
  /** Estimated round-trip driving time added by the stop. */
  detourMin: number;
  /** When you'd reach it, given departure time and progress. */
  etaMs: number;
  score: number;
  matched: InterestId[];
  reasons: string[];
  warning?: string;
}

export interface RankOptions {
  interests: InterestId[];
  budgetMin: number;
  /** Clock time at `fromKm` (departure time, or now when tracking live). */
  startMs: number;
  /** Progress along the route; stops behind this are dropped. */
  fromKm?: number;
  limit?: number;
}

// Both libraries are CommonJS; depending on the bundler the export is the
// namespace itself or its `default`.
const interop = <T,>(ns: T): T => (ns as { default?: T }).default ?? ns;
const SunCalc = interop(SunCalcNs);
const OpeningHours = interop(OpeningHoursNs) as unknown as new (value: string) => { getState(at: Date): boolean };

const MIN = 60_000;

function openState(tags: Tags, at: Date): 'open' | 'closed' | 'unknown' {
  if (!tags.opening_hours) return 'unknown';
  try {
    // Evaluated in the device's time zone; fine unless the trip crosses zones.
    return new OpeningHours(tags.opening_hours).getState(at) ? 'open' : 'closed';
  } catch {
    return 'unknown'; // unparseable or needs holiday data we don't have
  }
}

function daylight(p: { lat: number; lng: number }, at: Date): 'golden' | 'dark' | 'day' {
  const t = SunCalc.getTimes(at, p.lat, p.lng);
  // Times are missing near the poles; NaN makes every comparison false ("day").
  const on = (d: Date | null) => (d ? d.getTime() : NaN);
  const ms = at.getTime();
  if (ms < on(t.dawn) || ms > on(t.dusk)) return 'dark';
  const evening = ms >= on(t.goldenHour) && ms <= on(t.sunset) + 20 * MIN;
  const morning = ms >= on(t.sunrise) - 20 * MIN && ms <= on(t.goldenHourEnd);
  return evening || morning ? 'golden' : 'day';
}

function mealAt(at: Date): string | null {
  const h = at.getHours() + at.getMinutes() / 60;
  if (h >= 7 && h < 9.5) return 'breakfast';
  if (h >= 11.5 && h < 13.5) return 'lunch';
  if (h >= 17.5 && h < 19.75) return 'dinner';
  return null;
}

/** How much evidence there is that a place is real, documented and worth knowing about. */
function notability(tags: Tags): number {
  let n = 0;
  if (tags.wikidata || tags.wikipedia) n += 0.35;
  if (tags.website) n += 0.1;
  if (tags.heritage || tags['heritage:operator']) n += 0.1;
  if (tags.description) n += 0.05;
  if (tags.opening_hours) n += 0.05;
  return n;
}

export function rank(pois: Poi[], profile: RouteProfile, opts: RankOptions): Suggestion[] {
  const fromKm = opts.fromKm ?? 0;
  const fromSec = fromKm > 0 ? project(profile, pointAtKm(profile, fromKm)).sec : 0;
  const scored: Suggestion[] = [];

  for (const poi of pois) {
    const matched = poi.interests.filter((i) => opts.interests.includes(i));
    if (!matched.length) continue;
    const pr = project(profile, poi);
    const detourMin = detourMinutes(pr.offKm);
    if (detourMin > opts.budgetMin || pr.km < fromKm) continue;

    const etaMs = opts.startMs + (pr.sec - fromSec) * 1000 + (detourMin / 2) * MIN;
    const eta = new Date(etaMs);
    const reasons: string[] = [];
    let warning: string | undefined;

    let score = 0.5 + 0.25 * Math.min(2, matched.length - 1);
    score += notability(poi.tags);
    score -= 0.3 * (detourMin / opts.budgetMin);
    if (!poi.named) score -= 0.15;
    if (poi.tags.wikidata || poi.tags.wikipedia) reasons.push('Well documented');

    const open = openState(poi.tags, eta);
    if (open === 'open') {
      score += 0.1;
      reasons.push('Open when you arrive');
    } else if (open === 'closed') {
      score -= 0.6;
      warning = 'Likely closed when you arrive';
    }

    if (poi.interests.includes('photo') || poi.interests.includes('outdoors')) {
      const light = daylight(poi, eta);
      if (light === 'golden' && matched.includes('photo')) {
        score += 0.25;
        reasons.push('Golden hour when you arrive');
      } else if (light === 'dark') {
        score -= 0.4;
        warning ??= 'After dark when you arrive';
      }
    }

    if (matched.includes('food') && open !== 'closed') {
      const meal = mealAt(eta);
      if (meal) {
        score += 0.2;
        reasons.push(`Around ${meal} time`);
      }
    }

    scored.push({ ...poi, km: pr.km, detourMin, etaMs, score, matched, reasons, warning });
  }

  return diversify(dedupe(scored)).slice(0, opts.limit ?? 150);
}

/** The same place is often mapped twice (a point and an outline). Keep the better one. */
function dedupe(list: Suggestion[]): Suggestion[] {
  const best = new Map<string, Suggestion>();
  for (const s of list) {
    const key = s.named ? `${s.name.toLowerCase()}@${Math.round(s.km / 2)}` : s.id;
    const cur = best.get(key);
    if (!cur || s.score > cur.score) best.set(key, s);
  }
  return [...best.values()];
}

/** Dampen runs of the same kind of stop in the same stretch of road. */
function diversify(list: Suggestion[]): Suggestion[] {
  const sorted = [...list].sort((a, b) => b.score - a.score);
  const seen = new Map<string, number>();
  for (const s of sorted) {
    const key = `${s.kind}@${Math.floor(s.km / 25)}`;
    const n = seen.get(key) ?? 0;
    s.score -= 0.08 * n;
    seen.set(key, n + 1);
  }
  return sorted.sort((a, b) => b.score - a.score);
}

function pointAtKm(profile: RouteProfile, km: number) {
  return profile.pts.find((p) => p.km >= km) ?? profile.pts[profile.pts.length - 1];
}
