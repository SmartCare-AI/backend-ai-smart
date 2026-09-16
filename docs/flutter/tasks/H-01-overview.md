# H-01 · Hospital shell & overview KPIs

| | |
|---|---|
| **Phase** | Hospital dashboard |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev B |
| **Depends on** | F-07, **backend B-02** |
| **Blocks** | H-02, H-03 |

> Needs a `HOSPITAL_ADMIN` account to log in with. There is no API to create one
> — see [BACKEND-GAPS B-02](../BACKEND-GAPS.md). Until then, develop against the
> seeded `admin@shifaa.dev` (ADMIN can reach every analytics endpoint).

## Goal
The operational landing screen the BRD asks for: headline numbers at a glance.
This is a **web-first, read-only** surface. (BRD section 16.2)

## API
```
GET /analytics/overview?days=30
```
```jsonc
{
  "windowDays": 30,
  "users": { "patients": 42, "doctors": 7, "caregivers": 11 },
  "appointments": { "PENDING": 3, "CONFIRMED": 12, "COMPLETED": 30, "CANCELLED": 2 },
  "visits": 28,
  "onlineVisits": 6,
  "openAlerts": 4,
  "activeEmergencies": 0,
  "adherence": { "taken": 210, "missed": 18, "score": 0.92 }
}
```
Requires `HOSPITAL_ADMIN` or `ADMIN`.

## Scope
- [ ] Hospital shell with a `NavigationRail`, designed for 1280 px and wider
- [ ] Window selector: 7 / 30 / 90 days, driving `?days=`
- [ ] KPI tiles: patients, doctors, caregivers, visits, online visits, open alerts,
      active emergencies
- [ ] Appointment status breakdown as a donut chart (`fl_chart`)
- [ ] Adherence gauge showing the score with taken and missed underneath
- [ ] Highlight `activeEmergencies > 0` in danger colour — it is the one number
      that needs immediate action
- [ ] Graceful narrow layout so it is at least usable on a tablet

## Acceptance criteria
- [ ] Logging in as an admin lands in the hospital shell
- [ ] Changing the window re-queries and every tile updates
- [ ] A `null` adherence score renders "no data", not 0%
- [ ] An enum key returned by the backend that the UI does not know is ignored, not crashed on
- [ ] The layout is readable at 1280 px in Chrome and does not overflow at 900 px
- [ ] A patient or doctor account cannot reach these routes (403 and a redirect)

## Gotchas
- `appointments` is a **map keyed by status**, not a list. Missing statuses are
  simply absent — default them to 0.
- These aggregates are platform-wide, not per hospital (backend gap B-04).
  Invisible with one seeded hospital; mention it if asked in the defense.
