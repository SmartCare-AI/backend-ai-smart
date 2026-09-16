# D-01 · Doctor shell & today's schedule

| | |
|---|---|
| **Phase** | Doctor dashboard |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | F-07 |
| **Blocks** | D-02, D-06, D-07 |

## Goal
The doctor's landing screen: who is coming today, and one tap to start the
consultation. Designed for tablet and desktop width.

## API
```
GET   /appointments/my?upcoming=&status=&page=&limit=   -> Paginated<Appointment>
PATCH /appointments/{id}/confirm                        -> PENDING to CONFIRMED
PATCH /appointments/{id}/cancel   {reason?}
GET   /alerts/my-patients?page=&limit=                  -> open alerts, most severe first
```
List rows already include `patient`, `onlineVisit` and `visit` summaries.

## Scope
- [ ] Doctor shell with a `NavigationRail` at desktop width, bottom nav on mobile
- [ ] Today view: a timeline of today's appointments, each with patient name, MRN,
      time, type icon and status
- [ ] Filter tabs: Today · Upcoming · Pending confirmation
- [ ] Confirm and Cancel actions on pending appointments
- [ ] "Start visit" action on a confirmed appointment, opening D-03
- [ ] A compact open-alerts panel (count plus the three most severe), linking to D-06
- [ ] Day summary counters: total, confirmed, completed, no-show

## Acceptance criteria
- [ ] Logging in as `doctor@shifaa.dev` lands here
- [ ] Today's appointments are correctly filtered by the local day boundary
- [ ] Confirming a pending appointment updates the row and notifies the patient
      (the backend sends the push)
- [ ] Appointments with a visit already recorded show "View visit" instead of "Start visit"
- [ ] At 1280 px wide the rail is visible and the layout uses the space; at 600 px
      it degrades to a bottom bar without overflow
- [ ] Works in Arabic RTL, including the rail position

## Gotchas
- `GET /appointments/my` returns *all* the doctor's appointments, paginated.
  Filter today client-side from `startTime`, or pass `upcoming=true` and slice.
- This endpoint is also the source of the patient list in D-02 — see B-03.
