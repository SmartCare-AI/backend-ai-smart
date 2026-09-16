# P-16 · Online visit (telemedicine)

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | P2 — only if ahead |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | P-05 |
| **Blocks** | — |

> **Recommended scope cut: do not build WebRTC.** The backend already creates an
> `OnlineVisit` with a `meetingLink` for every VIDEO/CHAT appointment. Open that
> link. You demonstrate telemedicine in a day instead of losing a week to
> signalling, TURN servers and platform permissions.

## Goal
The patient joins their scheduled online consultation. (BRD TR-001, TR-005)

## API
```
GET   /online-visits/my?status=&page=&limit=
GET   /online-visits/{id}          -> includes meetingLink, appointment, doctor
PATCH /online-visits/{id}/cancel
```
Status flow: `SCHEDULED` to `ACTIVE` (the doctor starts it) to `COMPLETED`.
When the doctor starts the session the patient receives a push with
`data.screen = "online-visit"` and the meeting link.

## Scope
- [ ] Online visits list with status chips and scheduled time
- [ ] Waiting room: doctor name, scheduled time, and a live status message
      ("Waiting for the doctor to start")
- [ ] Join button enabled only while status is `ACTIVE`; opens `meetingLink`
      with `url_launcher` in an external browser
- [ ] Push handler routing straight to the waiting room
- [ ] Post-session state showing the session as completed with its notes
- [ ] Chat entry point into P-15 for document and message exchange during the call

## Acceptance criteria
- [ ] Booking a VIDEO appointment (P-04) creates an online visit visible here
- [ ] Join is disabled while `SCHEDULED` and enabled when the doctor starts it
- [ ] The doctor pressing Start (D-07) sends a push that opens the waiting room
- [ ] Cancelling an appointment also cancels its online visit
- [ ] The meeting link opens correctly on Android and on web

## If you do build real video later
Use `flutter_webrtc` with the existing `call:*` socket events — the backend
already relays offer, answer and ICE between participants. You will still need a
STUN/TURN server; a free public STUN works on the same network, but a demo across
mobile networks needs TURN.
