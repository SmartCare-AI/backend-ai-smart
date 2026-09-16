# P-04 · Book an appointment

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 2 days |
| **Owner** | Dev B |
| **Depends on** | P-03 |
| **Blocks** | P-05, P-06, C-04 |

## Goal
Pick a day, see which slots the doctor still has free, book one, and get a
confirmation. (BRD FR-008, AC-002)

## API
```
GET  /appointments/doctors/{doctorId}/schedule?date=YYYY-MM-DD
     -> { doctorId, date, busy: [ {startTime, endTime} ] }

POST /appointments
     { patientId, doctorId, startTime, durationMinutes?, type?, reason?, notes? }
     -> the created Appointment
```
- `startTime` is a **UTC ISO 8601 instant**, not a local string.
- `durationMinutes` defaults to 30, allowed 10–180.
- `type`: `IN_PERSON` | `VIDEO` | `CHAT`. **VIDEO and CHAT automatically create an
  Online Visit with a meeting link** — surface that in the confirmation.
- The backend returns **409** if the slot overlaps an existing PENDING/CONFIRMED
  appointment for that doctor.

## Scope
- [ ] Date picker limited to today and the next 30 days
- [ ] Build the free-slot grid yourself: generate candidate slots (say 09:00–17:00
      every 30 minutes in the clinic's local time), then subtract everything in
      `busy`. The backend returns busy ranges, not free ones.
- [ ] Appointment type selector with an explanation of what VIDEO means
- [ ] Reason field (max 500 characters)
- [ ] Review step showing doctor, date, time, type, duration
- [ ] Confirmation screen; if an online visit was created, show "a video link will
      be available when the doctor starts the session"
- [ ] Handle 409 by refreshing the schedule and telling the user the slot was taken

## Acceptance criteria
- [ ] Slots already booked do not appear as selectable
- [ ] Booking a slot in the past is blocked client-side (the backend also rejects it)
- [ ] Two devices booking the same slot: the second gets a clear "slot no longer
      available" message and a refreshed grid, not a crash
- [ ] Booking a `VIDEO` appointment produces an appointment whose detail screen
      shows an online-visit section
- [ ] The created appointment appears immediately in P-05
- [ ] Times are displayed in the device's local timezone and sent as UTC
- [ ] Booking works in Arabic with an Arabic date format

## Gotchas
- **Timezone is where this task goes wrong.** Build the slot in local time, then
  `.toUtc().toIso8601String()` before sending. Display with `.toLocal()`.
- `patientId` is the patient **profile** id from `authProvider`, not `user.id`.
- A caregiver booking for someone else needs `MANAGE_APPOINTMENTS` permission; the
  backend enforces it. That is C-04, not this task.
