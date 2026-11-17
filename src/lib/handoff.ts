import type { LatLng } from './geo';

const ll = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;

/** Google Maps accepts at most 9 waypoints in a directions link. */
export const GOOGLE_MAX_STOPS = 9;

/** Directions through the stops (already in route order), opened in Google Maps. */
export function googleMapsUrl(origin: LatLng | null, dest: LatLng, stops: LatLng[]): string {
  const params = new URLSearchParams({ api: '1', destination: ll(dest), travelmode: 'driving' });
  if (origin) params.set('origin', ll(origin)); // omitted = start from current location
  if (stops.length) params.set('waypoints', stops.slice(0, GOOGLE_MAX_STOPS).map(ll).join('|'));
  return `https://www.google.com/maps/dir/?${params}`;
}

/** Directions through the stops, opened in Apple Maps. */
export function appleMapsUrl(origin: LatLng | null, dest: LatLng, stops: LatLng[]): string {
  const daddr = [...stops, dest].map(ll).join('+to:');
  const saddr = origin ? `saddr=${ll(origin)}&` : '';
  return `https://maps.apple.com/?${saddr}daddr=${daddr}&dirflg=d`;
}
