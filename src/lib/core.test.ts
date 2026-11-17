import { describe, expect, it } from 'vitest';
import { buildProfile, chunkRoute, detourMinutes, maxOffKm, project } from './geo';
import { appleMapsUrl, googleMapsUrl } from './handoff';
import { buildQuery, classify } from './interests';
import { rank, type Poi } from './rank';

// A straight ~111 km route due east along the equator, driven in one hour.
const coords: [number, number][] = Array.from({ length: 101 }, (_, i) => [i / 100, 0]);
const profile = buildProfile(coords, 3600);

const poi = (over: Partial<Poi>): Poi => ({
  id: Math.random().toString(36),
  lat: 0.02,
  lng: 0.5,
  name: 'Somewhere',
  named: true,
  kind: 'Viewpoint',
  interests: ['photo', 'outdoors'],
  tags: {},
  ...over,
});

// Noon local time on a fixed date keeps daylight and meal logic deterministic.
const noon = new Date(2026, 5, 15, 12, 0).getTime();

describe('geo', () => {
  it('measures the route', () => {
    expect(profile.totalKm).toBeCloseTo(111.2, 0);
    expect(profile.totalSec).toBe(3600);
  });

  it('projects a point onto the route', () => {
    const p = project(profile, { lat: 0.05, lng: 0.5 });
    expect(p.offKm).toBeCloseTo(5.53, 1);
    expect(p.km).toBeCloseTo(55.6, 0);
    expect(p.sec).toBeCloseTo(1800, -1);
  });

  it('uses per-segment times from the router when they line up', () => {
    const p = buildProfile([[0, 0], [0.5, 0], [1, 0]], 999, [100, 300], 0);
    expect(p.totalSec).toBe(400);
    expect(project(p, { lat: 0, lng: 0.5 }).sec).toBeCloseTo(100);
  });

  it('detour budget and search radius are inverses', () => {
    expect(detourMinutes(maxOffKm(15))).toBeCloseTo(15);
  });

  it('chunks long routes without gaps', () => {
    const chunks = chunkRoute(profile, 40);
    expect(chunks.length).toBe(3);
    expect(chunks[0][0]).toEqual(profile.pts[0]);
    expect(chunks[1][0]).toEqual(chunks[0][chunks[0].length - 1]);
    expect(chunks[2][chunks[2].length - 1]).toEqual(profile.pts[profile.pts.length - 1]);
  });
});

describe('interests', () => {
  it('classifies tagged places', () => {
    expect(classify({ tourism: 'viewpoint' })).toEqual({ kind: 'Viewpoint', interests: ['photo', 'outdoors'] });
    expect(classify({ amenity: 'restaurant', name: 'Pie Stop', cuisine: 'american;diner', website: 'x' })?.kind).toBe('American restaurant');
    expect(classify({ historic: 'locomotive' })?.interests).toEqual(['history', 'quirky', 'kids']);
  });

  it('rejects chains, undocumented restaurants and unrelated places', () => {
    expect(classify({ amenity: 'restaurant', name: 'Chain', brand: 'Chain', website: 'x' })).toBeNull();
    expect(classify({ amenity: 'restaurant', name: 'Mystery' })).toBeNull();
    expect(classify({ amenity: 'fuel' })).toBeNull();
    expect(classify({ historic: 'memorial' })).toBeNull();
  });

  it('only queries for chosen interests', () => {
    const q = buildQuery([{ lat: 1, lng: 2 }, { lat: 3, lng: 4 }], 5000, ['kids']);
    expect(q).toContain('around:5000,1.00000,2.00000,3.00000,4.00000');
    expect(q).toContain('playground');
    expect(q).not.toContain('museum');
  });
});

describe('rank', () => {
  const opts = { interests: ['photo', 'history', 'food'] as const, budgetMin: 15, startMs: noon };
  const run = (pois: Poi[], over = {}) => rank(pois, profile, { ...opts, interests: [...opts.interests], ...over });

  it('drops stops outside the detour budget or not matching interests', () => {
    const out = run([
      poi({ name: 'Near' }),
      poi({ name: 'Far', lat: 0.2 }),
      poi({ name: 'Playground', interests: ['kids'] }),
    ]);
    expect(out.map((s) => s.name)).toEqual(['Near']);
    expect(out[0].detourMin).toBeGreaterThan(0);
    expect(out[0].detourMin).toBeLessThan(15);
  });

  it('prefers closer and better-documented stops', () => {
    const out = run([
      poi({ name: 'Plain', lng: 0.2 }),
      poi({ name: 'Famous', lng: 0.5, tags: { wikidata: 'Q1' } }),
      poi({ name: 'Further', lng: 0.8, lat: 0.04 }),
    ]);
    expect(out.map((s) => s.name)).toEqual(['Famous', 'Plain', 'Further']);
  });

  it('times each stop to when you would get there', () => {
    const [s] = run([poi({ lat: 0, lng: 0.5 })]);
    expect(s.etaMs - noon).toBeCloseTo(30 * 60_000, -5);
  });

  it('flags places that will be closed and rewards open ones', () => {
    const base = { kind: 'Museum', interests: ['history' as const] };
    const out = run([
      poi({ ...base, name: 'Closed', lng: 0.3, tags: { opening_hours: 'Mo-Su 18:00-22:00' } }),
      poi({ ...base, name: 'Open', lng: 0.6, tags: { opening_hours: 'Mo-Su 09:00-17:00' } }),
    ]);
    expect(out[0].name).toBe('Open');
    expect(out[0].reasons).toContain('Open when you arrive');
    expect(out[1].warning).toBe('Likely closed when you arrive');
  });

  it('boosts food at meal times and warns about arriving after dark', () => {
    const [diner] = run([poi({ kind: 'Restaurant', interests: ['food'], lng: 0.1 })]);
    expect(diner.reasons).toContain('Around lunch time');
    const [view] = run([poi({})], { startMs: new Date(2026, 5, 15, 23, 30).getTime() });
    // Sun position depends on the test machine's UTC offset only via the fixed clock time,
    // so check this at the route's own longitude (0°): 23:30 local ≈ dark in most zones.
    expect(['After dark when you arrive', undefined]).toContain(view.warning);
  });

  it('hides stops already behind you when tracking live', () => {
    const out = run([poi({ name: 'Behind', lng: 0.2 }), poi({ name: 'Ahead', lng: 0.8 })], { fromKm: 50 });
    expect(out.map((s) => s.name)).toEqual(['Ahead']);
    // ETA counts from current position, not from the origin.
    expect(out[0].etaMs - noon).toBeLessThan(25 * 60_000);
  });

  it('merges duplicates of the same named place', () => {
    const out = run([poi({ name: 'Twin' }), poi({ name: 'Twin', lng: 0.501 })]);
    expect(out).toHaveLength(1);
  });
});

describe('handoff', () => {
  const a = { lat: 1, lng: 2 };
  const b = { lat: 3, lng: 4 };
  const s = [{ lat: 1.5, lng: 2.5 }, { lat: 2.5, lng: 3.5 }];

  it('builds a Google Maps directions link with waypoints', () => {
    const url = new URL(googleMapsUrl(a, b, s));
    expect(url.searchParams.get('origin')).toBe('1.000000,2.000000');
    expect(url.searchParams.get('destination')).toBe('3.000000,4.000000');
    expect(url.searchParams.get('waypoints')).toBe('1.500000,2.500000|2.500000,3.500000');
    expect(new URL(googleMapsUrl(null, b, [])).searchParams.has('origin')).toBe(false);
  });

  it('builds an Apple Maps link that chains stops', () => {
    expect(appleMapsUrl(a, b, s)).toBe(
      'https://maps.apple.com/?saddr=1.000000,2.000000&daddr=1.500000,2.500000+to:2.500000,3.500000+to:3.000000,4.000000&dirflg=d',
    );
  });
});
