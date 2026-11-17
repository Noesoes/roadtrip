const MILES = /-(US|GB|LR|MM)$/i.test(typeof navigator === 'undefined' ? 'en-US' : navigator.language);

export function distance(km: number): string {
  const v = MILES ? km * 0.621371 : km;
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${MILES ? 'mi' : 'km'}`;
}

export function duration(sec: number): string {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

export function clock(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
}

export const minutes = (min: number) => `${Math.max(1, Math.round(min))} min`;
