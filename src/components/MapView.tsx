import L from 'leaflet';
import { useEffect, useRef } from 'react';
import type { LatLng, RouteProfile } from '../lib/geo';
import { interestById } from '../lib/interests';
import type { Suggestion } from '../lib/rank';

export function MapView(props: {
  profile: RouteProfile;
  suggestions: Suggestion[];
  stopIds: string[];
  selectedId: string | null;
  live: LatLng | null;
  onSelect: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const markers = useRef<L.LayerGroup | null>(null);
  const liveDot = useRef<L.CircleMarker | null>(null);
  const onSelect = useRef(props.onSelect);
  onSelect.current = props.onSelect;

  useEffect(() => {
    const m = L.map(el.current!, { zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(m);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    markers.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current!;
    const pts = props.profile.pts;
    const line = L.polyline(pts.map((p) => [p.lat, p.lng] as [number, number]), { color: '#1f6f5c', weight: 5, opacity: 0.85 }).addTo(m);
    const ends = [pts[0], pts[pts.length - 1]].map((p, i) =>
      L.circleMarker([p.lat, p.lng], { radius: 7, color: '#fff', weight: 3, fillColor: i ? '#c2452d' : '#1f6f5c', fillOpacity: 1 }).addTo(m),
    );
    m.fitBounds(line.getBounds(), { padding: [24, 24] });
    return () => {
      line.remove();
      ends.forEach((e) => e.remove());
    };
  }, [props.profile]);

  useEffect(() => {
    const group = markers.current!;
    group.clearLayers();
    // Draw lowest-ranked first so the best suggestions sit on top.
    [...props.suggestions].reverse().forEach((s) => {
      const isStop = props.stopIds.includes(s.id);
      const isSel = s.id === props.selectedId;
      L.circleMarker([s.lat, s.lng], {
        radius: isSel ? 11 : isStop ? 9 : 6,
        color: isSel ? '#111' : '#fff',
        weight: isSel || isStop ? 3 : 1.5,
        fillColor: interestById[s.matched[0]].color,
        fillOpacity: 0.95,
      })
        .bindTooltip(`${isStop ? '✓ ' : ''}${s.name}`)
        .on('click', () => onSelect.current(s.id))
        .addTo(group);
    });
  }, [props.suggestions, props.stopIds, props.selectedId]);

  useEffect(() => {
    const s = props.suggestions.find((x) => x.id === props.selectedId);
    const m = map.current!;
    if (s && !m.getBounds().pad(-0.15).contains([s.lat, s.lng])) m.panTo([s.lat, s.lng]);
    // Only react to a new selection, not to re-ranking.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedId]);

  useEffect(() => {
    liveDot.current?.remove();
    liveDot.current = props.live
      ? L.circleMarker([props.live.lat, props.live.lng], { radius: 8, color: '#fff', weight: 3, fillColor: '#1a73e8', fillOpacity: 1 }).addTo(map.current!)
      : null;
  }, [props.live]);

  return <div ref={el} className="map" aria-label="Map of the route and suggested stops" />;
}
