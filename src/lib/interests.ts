export type InterestId = 'history' | 'food' | 'outdoors' | 'quirky' | 'photo' | 'kids';

export interface Interest {
  id: InterestId;
  label: string;
  emoji: string;
  color: string;
}

export const INTERESTS: Interest[] = [
  { id: 'history', label: 'History', emoji: '🏛️', color: '#8a5a2b' },
  { id: 'food', label: 'Local food', emoji: '🥧', color: '#c2452d' },
  { id: 'outdoors', label: 'Hikes & nature', emoji: '🥾', color: '#2e7d4f' },
  { id: 'quirky', label: 'Weird roadside', emoji: '🦖', color: '#8e44ad' },
  { id: 'photo', label: 'Photography', emoji: '📷', color: '#1f6fb5' },
  { id: 'kids', label: 'Kid-friendly', emoji: '🎠', color: '#d4880f' },
];

export const interestById = Object.fromEntries(INTERESTS.map((i) => [i.id, i])) as Record<InterestId, Interest>;

/**
 * One rule maps an OpenStreetMap tag to the interests it serves. The same
 * table drives both the corridor query and the classification of results.
 */
interface Rule {
  key: string;
  values: string[];
  interests: InterestId[];
  /** Extra tag filters that must also be present (keeps noisy categories in check). */
  require?: string[];
  /** Tags that disqualify a place (e.g. chains). */
  exclude?: string[];
  /** Display name; defaults to the tag value, tidied up. */
  kind?: string;
}

const RULES: Rule[] = [
  { key: 'tourism', values: ['museum'], interests: ['history'] },
  { key: 'historic', values: ['castle', 'ruins', 'archaeological_site', 'battlefield', 'fort', 'monument', 'mine', 'city_gate', 'manor'], interests: ['history'] },
  { key: 'historic', values: ['memorial'], interests: ['history'], require: ['wikidata'] },
  { key: 'historic', values: ['ship', 'aircraft', 'locomotive', 'tank', 'wreck'], interests: ['history', 'quirky', 'kids'] },
  { key: 'man_made', values: ['lighthouse'], interests: ['photo', 'history'] },
  { key: 'tourism', values: ['viewpoint'], interests: ['photo', 'outdoors'] },
  { key: 'waterway', values: ['waterfall'], interests: ['photo', 'outdoors'] },
  { key: 'natural', values: ['hot_spring', 'cave_entrance', 'arch', 'geyser'], interests: ['outdoors', 'photo'] },
  { key: 'natural', values: ['beach'], interests: ['outdoors', 'kids'], require: ['name'] },
  { key: 'highway', values: ['trailhead'], interests: ['outdoors'] },
  { key: 'leisure', values: ['nature_reserve'], interests: ['outdoors'], require: ['name'] },
  { key: 'tourism', values: ['attraction'], interests: ['quirky'], require: ['name'] },
  { key: 'tourism', values: ['artwork'], interests: ['quirky', 'photo'], require: ['name'], kind: 'Public art' },
  { key: 'tourism', values: ['zoo', 'aquarium', 'theme_park'], interests: ['kids'] },
  { key: 'leisure', values: ['water_park', 'miniature_golf'], interests: ['kids'] },
  { key: 'leisure', values: ['playground'], interests: ['kids'], require: ['name'] },
  { key: 'amenity', values: ['ice_cream'], interests: ['food', 'kids'], require: ['name'], kind: 'Ice cream' },
  // Independent places only, and only ones someone has bothered to document.
  { key: 'amenity', values: ['restaurant', 'cafe'], interests: ['food'], require: ['name', 'opening_hours'], exclude: ['brand'] },
  { key: 'amenity', values: ['restaurant', 'cafe'], interests: ['food'], require: ['name', 'website'], exclude: ['brand'] },
  { key: 'shop', values: ['bakery', 'farm'], interests: ['food'], require: ['name'], exclude: ['brand'] },
];

export type Tags = Record<string, string>;

const tidy = (v: string) => (v.charAt(0).toUpperCase() + v.slice(1)).replace(/_/g, ' ');

const matches = (r: Rule, tags: Tags) =>
  r.values.includes(tags[r.key]) &&
  (r.require ?? []).every((k) => k in tags) &&
  !(r.exclude ?? []).some((k) => k in tags);

/** Which interests a tagged place serves, or null if it isn't a stop we suggest. */
export function classify(tags: Tags): { kind: string; interests: InterestId[] } | null {
  const hits = RULES.filter((r) => matches(r, tags));
  if (!hits.length) return null;
  const interests = [...new Set(hits.flatMap((r) => r.interests))];
  const first = hits[0];
  let kind = first.kind ?? tidy(tags[first.key]);
  if (tags.amenity === 'restaurant' && tags.cuisine) kind = `${tidy(tags.cuisine.split(';')[0])} restaurant`;
  return { kind, interests };
}

/** Overpass QL for everything along `line` (within `radiusM`) that serves the chosen interests. */
export function buildQuery(line: { lat: number; lng: number }[], radiusM: number, interests: InterestId[], limit = 800): string {
  const coords = line.map((p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`).join(',');
  const around = `(around:${Math.round(radiusM)},${coords})`;
  const statements = RULES.filter((r) => r.interests.some((i) => interests.includes(i))).map((r) => {
    const req = (r.require ?? []).map((k) => `["${k}"]`).join('');
    const exc = (r.exclude ?? []).map((k) => `[!"${k}"]`).join('');
    return `nw${around}["${r.key}"~"^(${r.values.join('|')})$"]${req}${exc};`;
  });
  return `[out:json][timeout:60];(${statements.join('')});out center tags ${limit};`;
}
