import { useEffect, useRef, useState } from 'react';
import { searchPlaces, type Place } from '../lib/api';
import { INTERESTS, type InterestId } from '../lib/interests';
import type { Plan } from '../lib/store';

function PlaceInput(props: {
  id: string;
  label: string;
  placeholder: string;
  value: Place | null;
  onChange: (p: Place | null) => void;
  allowLocate?: boolean;
}) {
  const [text, setText] = useState(props.value?.label ?? '');
  const [options, setOptions] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const seq = useRef(0);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 3 || q === props.value?.label) {
      setOptions([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      searchPlaces(q)
        .then((r) => {
          if (mine !== seq.current) return;
          setOptions(r);
          setNote(r.length ? '' : 'No matches — try a city or address.');
        })
        .catch(() => mine === seq.current && setNote('Place search is unavailable right now.'));
    }, 300);
    return () => clearTimeout(t);
  }, [text, props.value]);

  const pick = (p: Place) => {
    props.onChange(p);
    setText(p.label);
    setOptions([]);
    setOpen(false);
    setNote('');
  };

  const locate = () => {
    setNote('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => pick({ label: 'My location', lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => setNote("Couldn't get your location — type a place instead."),
      { timeout: 10_000 },
    );
  };

  return (
    <div className="field">
      <label htmlFor={props.id}>{props.label}</label>
      <div className="place">
        <input
          id={props.id}
          type="text"
          autoComplete="off"
          placeholder={props.placeholder}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            if (props.value) props.onChange(null);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
        />
        {props.allowLocate && 'geolocation' in navigator && (
          <button type="button" className="ghost" onClick={locate} title="Use my location" aria-label="Use my location">
            ◎
          </button>
        )}
        {open && options.length > 0 && (
          <ul className="options" role="listbox">
            {options.map((o, i) => (
              <li key={i} role="option" aria-selected={false} onMouseDown={() => pick(o)}>
                {o.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {note && <p className="hint">{note}</p>}
    </div>
  );
}

const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
};

export function Setup(props: {
  initial: Partial<Plan>;
  busy: string | null;
  error: string | null;
  online: boolean;
  onPlan: (plan: Plan) => void;
  onCancel?: () => void;
}) {
  const [origin, setOrigin] = useState<Place | null>(props.initial.origin ?? null);
  const [dest, setDest] = useState<Place | null>(props.initial.dest ?? null);
  const [interests, setInterests] = useState<InterestId[]>(props.initial.interests ?? []);
  const [budgetMin, setBudgetMin] = useState(props.initial.budgetMin ?? 15);
  const [later, setLater] = useState(props.initial.departMs != null);
  const [depart, setDepart] = useState(toLocalInput(props.initial.departMs ?? Date.now() + 3_600_000));

  const toggle = (id: InterestId) =>
    setInterests((cur) => (cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id]));

  const missing = !origin || !dest ? 'Pick a start and a destination from the suggestions.' : !interests.length ? 'Pick at least one interest.' : null;

  return (
    <form
      className="setup"
      onSubmit={(e) => {
        e.preventDefault();
        if (missing || props.busy) return;
        props.onPlan({ origin: origin!, dest: dest!, interests, budgetMin, departMs: later ? new Date(depart).getTime() : null });
      }}
    >
      <header>
        <h1>Roadtrip</h1>
        <p>Stops worth the detour, picked for what you're into and timed to when you'll get there.</p>
      </header>

      <PlaceInput id="from" label="From" placeholder="Starting point" value={origin} onChange={setOrigin} allowLocate />
      <PlaceInput id="to" label="To" placeholder="Destination" value={dest} onChange={setDest} />

      <div className="field">
        <span className="label">Leaving</span>
        <div className="segmented">
          <button type="button" className={!later ? 'on' : ''} onClick={() => setLater(false)}>Now</button>
          <button type="button" className={later ? 'on' : ''} onClick={() => setLater(true)}>Later</button>
        </div>
        {later && <input type="datetime-local" aria-label="Departure time" value={depart} onChange={(e) => setDepart(e.target.value)} />}
      </div>

      <div className="field">
        <span className="label">What are you into?</span>
        <div className="chips">
          {INTERESTS.map((i) => (
            <button
              key={i.id}
              type="button"
              className={`chip ${interests.includes(i.id) ? 'on' : ''}`}
              aria-pressed={interests.includes(i.id)}
              onClick={() => toggle(i.id)}
            >
              <span aria-hidden>{i.emoji}</span> {i.label}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label htmlFor="budget">
          Detour budget per stop: <strong>up to {budgetMin} min</strong>
        </label>
        <input id="budget" type="range" min={5} max={45} step={5} value={budgetMin} onChange={(e) => setBudgetMin(+e.target.value)} />
      </div>

      {props.error && <p className="error" role="alert">{props.error}</p>}
      {!props.online && <p className="error">You're offline. Planning a new trip needs a connection.</p>}

      <button className="primary" type="submit" disabled={!!missing || !!props.busy || !props.online}>
        {props.busy ?? 'Find stops'}
      </button>
      {missing && !props.busy && <p className="hint">{missing}</p>}
      {props.onCancel && (
        <button type="button" className="link" onClick={props.onCancel}>
          Back to current trip
        </button>
      )}

      <footer>
        Made for passengers — drivers, keep your eyes on the road. Places and maps ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors.
      </footer>
    </form>
  );
}
