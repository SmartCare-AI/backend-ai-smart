# D-07 · Online visit control

| | |
|---|---|
| **Phase** | Doctor dashboard |
| **Priority** | P2 — only if ahead |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | D-01 |
| **Blocks** | — |

## Goal
The doctor starts the telemedicine session, consults, then ends it with notes.
(BRD TR-001, TR-005)

## API
```
GET   /online-visits/my?status=&page=&limit=
GET   /online-visits/{id}
PATCH /online-visits/{id}/start          -> ACTIVE, sets startTime, pushes the patient
PATCH /online-visits/{id}/end   {notes?} -> COMPLETED, sets endTime, completes the appointment
PATCH /online-visits/{id}/cancel
POST  /online-visits                     {appointmentId, type?, meetingLink?, notes?}
```

## Scope
- [ ] Today's online sessions list with status chips
- [ ] Session screen: patient context panel (reuse D-02's), the meeting link, and
      Start / End controls
- [ ] Start opens `meetingLink` via `url_launcher` and marks it `ACTIVE`
- [ ] Session notes field saved on End
- [ ] "Add online session" for an in-person appointment that needs to become remote
- [ ] Chat entry point (P-15) for exchanging documents during the consultation

## Acceptance criteria
- [ ] Pressing Start sends a push to the patient, whose app opens the waiting room (P-16)
- [ ] Ending sets `COMPLETED` and marks the appointment `COMPLETED`
- [ ] Notes entered on End are visible afterwards on both sides
- [ ] Starting an already-completed session shows the backend's 400 message
- [ ] Only the appointment's patient and doctor can reach the session (403 otherwise)

## Gotchas
- Booking a `VIDEO` or `CHAT` appointment already creates the online visit
  automatically. `POST /online-visits` is only for converting an in-person one.
- Ending the session completes the appointment server-side — refresh the schedule
  in D-01 afterwards or it will look stale.
