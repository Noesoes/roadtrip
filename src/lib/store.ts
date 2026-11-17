import type { Place } from './api';
import type { RouteProfile } from './geo';
import type { InterestId } from './interests';
import type { Poi } from './rank';

export interface Plan {
  origin: Place;
  dest: Place;
  /** null = leave now */
  departMs: number | null;
  interests: InterestId[];
  budgetMin: number;
}

export interface SavedTrip {
  plan: Plan;
  profile: RouteProfile;
  pois: Poi[];
  stopIds: string[];
  /** True when part of the route couldn't be searched for places. */
  partial?: boolean;
  savedAt: number;
}

const KEY = 'roadtrip.trip.v1';
const PREFS = 'roadtrip.prefs.v1';

/** Keep the current trip on the device so it still opens with no signal. */
export function saveTrip(trip: SavedTrip): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(trip));
  } catch {
    try {
      // Over quota on a very long trip: keep the route and chosen stops at least.
      const pois = trip.pois.filter((p) => trip.stopIds.includes(p.id));
      localStorage.setItem(KEY, JSON.stringify({ ...trip, pois }));
    } catch {
      /* storage unavailable */
    }
  }
}

export function loadTrip(): SavedTrip | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedTrip) : null;
  } catch {
    return null;
  }
}

export function clearTrip(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export interface Prefs {
  interests: InterestId[];
  budgetMin: number;
}

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS);
    if (raw) return JSON.parse(raw) as Prefs;
  } catch {
    /* ignore */
  }
  return { interests: [], budgetMin: 15 };
}

export function savePrefs(prefs: Prefs): void {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}
