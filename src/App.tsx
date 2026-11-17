import { useEffect, useState } from 'react';
import { Setup } from './components/Setup';
import { Trip } from './components/Trip';
import { fetchPois, fetchRoute } from './lib/api';
import { maxOffKm } from './lib/geo';
import { loadPrefs, loadTrip, savePrefs, saveTrip, type Plan, type SavedTrip } from './lib/store';

/** Widest corridor we search, however generous the detour budget. */
const MAX_RADIUS_KM = 20;

export function App() {
  const [trip, setTrip] = useState<SavedTrip | null>(loadTrip);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  const plan = async (p: Plan) => {
    setError(null);
    savePrefs({ interests: p.interests, budgetMin: p.budgetMin });
    try {
      setBusy('Finding the route…');
      const profile = await fetchRoute(p.origin, p.dest);
      setBusy('Looking for stops…');
      const radius = Math.min(maxOffKm(p.budgetMin), MAX_RADIUS_KM);
      const { pois, missed } = await fetchPois(profile, p.interests, radius, (done, total) =>
        setBusy(total > 1 ? `Looking for stops… ${Math.round((done / total) * 100)}%` : 'Looking for stops…'),
      );
      const next: SavedTrip = { plan: p, profile, pois, stopIds: [], partial: missed > 0, savedAt: Date.now() };
      saveTrip(next);
      setTrip(next);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(null);
    }
  };

  if (busy && trip && !editing) return <p className="empty">{busy}</p>;

  if (!trip || editing) {
    return (
      <Setup
        initial={trip?.plan ?? loadPrefs()}
        busy={busy}
        error={error}
        online={online}
        onPlan={plan}
        onCancel={trip ? () => setEditing(false) : undefined}
      />
    );
  }

  return (
    <Trip
      trip={trip}
      online={online}
      error={error}
      onEdit={() => setEditing(true)}
      onRetry={() => plan(trip.plan)}
      onStops={(stopIds) => {
        const next = { ...trip, stopIds };
        saveTrip(next);
        setTrip(next);
      }}
    />
  );
}
