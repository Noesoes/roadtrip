import { useEffect, useMemo, useRef, useState } from 'react';
import { project, detourMinutes, type LatLng } from '../lib/geo';
import { clock, distance, duration, minutes } from '../lib/format';
import { appleMapsUrl, googleMapsUrl, GOOGLE_MAX_STOPS } from '../lib/handoff';
import { interestById, type InterestId } from '../lib/interests';
import { rank, type Suggestion } from '../lib/rank';
import type { SavedTrip } from '../lib/store';
import { MapView } from './MapView';

/** How far from the route you can be and still count as "on it" for live tracking. */
const ON_ROUTE_KM = 8;

function Card(props: { s: Suggestion; added: boolean; selected: boolean; onSelect: () => void; onToggle: () => void }) {
  const { s } = props;
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (props.selected) ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [props.selected]);

  return (
    <li ref={ref} className={`card ${props.selected ? 'selected' : ''}`} onClick={props.onSelect}>
      <div className="card-head">
        <h3>{s.name}</h3>
        <span className="detour">+{minutes(s.detourMin)}</span>
      </div>
      <p className="meta">
        {s.named ? `${s.kind} · ` : ''}
        {distance(s.km)} in · there about {clock(s.etaMs)}
      </p>
      <div className="tags">
        {s.matched.map((id) => (
          <span key={id} className="tag" style={{ background: interestById[id].color }}>
            {interestById[id].emoji} {interestById[id].label}
          </span>
        ))}
        {s.reasons.map((r) => (
          <span key={r} className="tag why">{r}</span>
        ))}
        {s.warning && <span className="tag warn">⚠ {s.warning}</span>}
      </div>
      {s.tags.description && <p className="blurb">{s.tags.description}</p>}
      <div className="actions">
        <button
          className={props.added ? 'added' : 'primary small'}
          onClick={(e) => {
            e.stopPropagation();
            props.onToggle();
          }}
        >
          {props.added ? '✓ Added — remove' : 'Add stop'}
        </button>
        {s.tags.website && (
          <a href={s.tags.website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
            Website ↗
          </a>
        )}
      </div>
    </li>
  );
}

export function Trip(props: {
  trip: SavedTrip;
  online: boolean;
  error: string | null;
  onStops: (ids: string[]) => void;
  onEdit: () => void;
  onRetry: () => void;
}) {
  const { plan, profile, pois, stopIds } = props.trip;
  const [now, setNow] = useState(Date.now());
  const [filter, setFilter] = useState<InterestId | 'all'>('all');
  const [sort, setSort] = useState<'best' | 'route'>('best');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);
  const [pos, setPos] = useState<LatLng | null>(null);
  const [geoNote, setGeoNote] = useState('');

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!tracking) {
      setPos(null);
      setGeoNote('');
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => {
        setGeoNote("Couldn't get your location.");
        setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking]);

  // When you're on the route, time everything from where you are right now.
  const progress = useMemo(() => {
    if (!pos) return null;
    const pr = project(profile, pos);
    return pr.offKm <= ON_ROUTE_KM ? pr : null;
  }, [pos, profile]);

  const suggestions = useMemo(
    () =>
      rank(pois, profile, {
        interests: plan.interests,
        budgetMin: plan.budgetMin,
        startMs: progress ? now : (plan.departMs ?? now),
        fromKm: progress?.km,
      }),
    [pois, profile, plan, progress, now],
  );

  const shown = useMemo(() => {
    const list = filter === 'all' ? suggestions : suggestions.filter((s) => s.matched.includes(filter));
    return sort === 'route' ? [...list].sort((a, b) => a.km - b.km) : list;
  }, [suggestions, filter, sort]);

  const stops = useMemo(
    () =>
      pois
        .filter((p) => stopIds.includes(p.id))
        .map((p) => ({ ...p, pr: project(profile, p) }))
        .sort((a, b) => a.pr.km - b.pr.km),
    [pois, stopIds, profile],
  );
  const addedMin = stops.reduce((sum, s) => sum + detourMinutes(s.pr.offKm), 0);
  const ahead = progress ? stops.filter((s) => s.pr.km >= progress.km) : stops;
  const navOrigin = tracking && pos ? null : plan.origin.label === 'My location' ? null : plan.origin;

  const toggle = (id: string) => props.onStops(stopIds.includes(id) ? stopIds.filter((x) => x !== id) : [...stopIds, id]);

  return (
    <div className="trip">
      <header className="trip-head">
        <div>
          <h2>
            {plan.origin.label.split(',')[0]} → {plan.dest.label.split(',')[0]}
          </h2>
          <p>
            {distance(profile.totalKm)} · {duration(profile.totalSec)} · stops up to +{plan.budgetMin} min
          </p>
        </div>
        <button className="ghost" onClick={props.onEdit}>Edit</button>
      </header>

      {!props.online && <p className="banner">Offline — showing your saved trip. Map areas you haven't viewed may be blank.</p>}

      {props.online && (props.trip.partial || props.error) && (
        <p className="banner">
          {props.error ?? "Some stretches of the route couldn't be searched, so stops may be missing."}{' '}
          <button className="link" onClick={props.onRetry}>Retry</button>
        </p>
      )}

      <div className="map-wrap">
        <MapView profile={profile} suggestions={shown} stopIds={stopIds} selectedId={selectedId} live={pos} onSelect={setSelectedId} />
        {'geolocation' in navigator && (
          <button className={`live ${tracking ? 'on' : ''}`} onClick={() => setTracking((t) => !t)} aria-pressed={tracking}>
            {tracking ? '● Live' : '◎ Go live'}
          </button>
        )}
      </div>

      <section className="list">
        {(geoNote || (tracking && pos && !progress)) && (
          <p className="hint">{geoNote || "You're not on the route yet — showing the whole trip."}</p>
        )}
        <div className="toolbar">
          <div className="chips scroll">
            <button className={`chip ${filter === 'all' ? 'on' : ''}`} onClick={() => setFilter('all')}>
              All {suggestions.length}
            </button>
            {plan.interests.map((id) => (
              <button key={id} className={`chip ${filter === id ? 'on' : ''}`} onClick={() => setFilter(id)}>
                {interestById[id].emoji} {suggestions.filter((s) => s.matched.includes(id)).length}
              </button>
            ))}
          </div>
          <div className="segmented small">
            <button className={sort === 'best' ? 'on' : ''} onClick={() => setSort('best')}>Best</button>
            <button className={sort === 'route' ? 'on' : ''} onClick={() => setSort('route')}>In order</button>
          </div>
        </div>

        {shown.length === 0 ? (
          <p className="empty">
            {progress
              ? 'No more matching stops ahead on this route.'
              : `Nothing within ${plan.budgetMin} minutes of this route for those interests. Try a bigger detour budget or more interests.`}
          </p>
        ) : (
          <ul className="cards">
            {shown.map((s) => (
              <Card
                key={s.id}
                s={s}
                added={stopIds.includes(s.id)}
                selected={s.id === selectedId}
                onSelect={() => setSelectedId(s.id)}
                onToggle={() => toggle(s.id)}
              />
            ))}
          </ul>
        )}
      </section>

      {stops.length > 0 && (
        <footer className="handoff">
          <p>
            <strong>
              {stops.length} stop{stops.length > 1 ? 's' : ''}
            </strong>{' '}
            · about +{minutes(addedMin)} driving
            {ahead.length > GOOGLE_MAX_STOPS && <span className="hint"> · Google Maps takes the first {GOOGLE_MAX_STOPS}</span>}
          </p>
          <div>
            <a className="primary small" href={googleMapsUrl(navOrigin, plan.dest, ahead)} target="_blank" rel="noreferrer">
              Google Maps
            </a>
            <a className="primary small alt" href={appleMapsUrl(navOrigin, plan.dest, ahead)} target="_blank" rel="noreferrer">
              Apple Maps
            </a>
          </div>
        </footer>
      )}
    </div>
  );
}
