# Roadtrip

Stops worth the detour, picked for what you're into and timed to when you'll get there.

Most road-trip apps are planners you use before the trip. This is the v1 of an
"along the way" companion: tell it where you're going and what you like, and it
ranks stops inside a detour budget you set.

## What v1 does

1. **Origin, destination, interests** — six interests (history, local food,
   hikes & nature, weird roadside, photography, kid-friendly), a departure
   time, and a per-stop detour budget (5–45 minutes).
2. **Ranked suggestions on a map and a list** — each stop shows the added
   driving time, how far into the trip it is, when you'd get there, and why it
   was picked.
3. **One-tap "Add stop" and hand-off** — chosen stops open as a multi-stop
   route in Google Maps or Apple Maps. The app does no navigation itself.
4. **Offline** — the current trip (route, candidate stops, your picks) is kept
   on the device, and the app shell and any map tiles you've already viewed are
   cached, so a saved trip reopens in a dead zone.

Also in: **Go live**, which uses your location to hide stops you've passed and
re-time everything from where you are now.

Not in v1 (by design): bookings, social, turn-by-turn, RV features, audio
cards, group voting, accounts, payments.

## How suggestions are ranked

`src/lib/rank.ts` scores every candidate in the route corridor:

| Signal | Effect |
| --- | --- |
| Interest match | Base score; more for places that hit several of your interests |
| Evidence the place is real and notable | Wikipedia/Wikidata entry, website, heritage listing, opening hours |
| Detour | Penalty proportional to how much of your budget it uses |
| Opening hours at your ETA | Bonus if open, heavy penalty and a warning if closed |
| Daylight at your ETA | Golden-hour bonus for photo stops; warning for outdoor stops after dark |
| Meal times | Bonus for food stops you'd reach around breakfast, lunch or dinner |
| Variety | Dampens runs of the same kind of stop in the same stretch |

Detour time is an estimate from straight-line distance off the route (out and
back, at side-road speeds), not a routed time.

## Data

No API keys or accounts are needed. Everything comes from free public services
built on OpenStreetMap:

| Need | Service |
| --- | --- |
| Place search | [Photon](https://photon.komoot.io) |
| Driving route | [OSRM demo server](https://project-osrm.org) |
| Places along the route | [Overpass API](https://overpass-api.de), with fallback mirrors |
| Map tiles | [OpenStreetMap](https://www.openstreetmap.org/copyright) |

These are shared community servers with fair-use policies and no uptime
guarantee. They're right for a prototype and for validating the idea; a
public launch needs hosted or commercial equivalents (and that's where the
per-request costs start).

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for geometry, matching, ranking, hand-off links
npm run build    # static site in dist/ — host anywhere
```

It's a static React + TypeScript app (Vite, Leaflet). The offline service
worker only registers in a production build (`npm run build && npm run preview`).

## Known limits

- **No LLM layer yet.** Matching is a hand-written table from OpenStreetMap
  tags to interests (`src/lib/interests.ts`), and descriptions are whatever
  mappers wrote. An LLM pass for matching and blurbs is the obvious next step
  and needs a small backend to hold the API key.
- **Data is only as good as OpenStreetMap** in that area. Rural coverage is
  thin, and closures lag. Restaurants are only suggested when independent and
  documented (hours or a website).
- **Times assume your device's time zone**, so opening-hours checks can be off
  by an hour on trips that cross zones.
- **ETAs ignore time spent at earlier stops.**
- **No weather, fuel-gap or traffic signals.**
- Google Maps links carry at most 9 stops.

## Safety

Built for the passenger seat. Drivers: hand the phone over.
