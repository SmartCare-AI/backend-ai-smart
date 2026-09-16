# P-13 · Emergency hub (SOS, contacts, first aid)

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 2 days |
| **Owner** | Dev B |
| **Depends on** | F-08 |
| **Blocks** | C-03 |

> Second-best demo moment after AI triage: press SOS on one phone, watch the
> caregiver's phone light up. Make sure that works on stage.

## Goal
One button that alerts the patient's whole care circle with their location, plus
first-aid guidance that works with **no connectivity at all**.

## API
```
POST   /emergency/sos                {latitude?, longitude?, description?}  -> EmergencyEvent
PATCH  /emergency/{id}/resolve       {falseAlarm?}
GET    /emergency/patients/{patientId}?status=&page=&limit=
GET    /emergency/contacts
POST   /emergency/contacts           {name, phone, relationship?, priority?}
PATCH  /emergency/contacts/{id}
DELETE /emergency/contacts/{id}
GET    /first-aid?category=          PUBLIC, returns FULL content of every guide
GET    /first-aid/{slug}             PUBLIC
```
SOS is rate limited to 5 per minute. Pressing it repeatedly within 10 minutes
reuses the active event rather than creating duplicates.

## What happens after SOS (explain this in the UI)
1. Immediate high-priority push to every treating doctor and authorized caregiver.
2. If nobody acknowledges within the escalation window (default 2 minutes), the
   backend sends SMS to the emergency contacts in priority order.
3. Any circle member acknowledging stops the escalation and notifies the patient.

## Scope
- [ ] Large SOS button with a 3-second hold-to-confirm and haptic feedback —
      prevents pocket triggering without adding friction in a real emergency
- [ ] Request location permission at the right moment, and send lat/lng when
      granted; **still send the SOS when it is denied**
- [ ] Active-emergency screen: status, elapsed time, who acknowledged, and a
      Resolve / False alarm action
- [ ] Emergency contacts CRUD, max 5, reorderable by `priority` (1 is called first)
- [ ] First-aid library: category grid, guide detail rendering Markdown
- [ ] **Offline caching**: on first successful load, store every guide in Hive.
      Serve from cache when offline and show a "showing saved guides" banner.
- [ ] Prefetch the guides right after login, not on first open of the screen

## Acceptance criteria
- [ ] Pressing SOS creates an event and the caregiver device receives a push within seconds
- [ ] Pressing SOS three times in a row produces **one** event, not three
- [ ] With location denied, the SOS still succeeds and the UI says location was not shared
- [ ] Turning on airplane mode and opening first aid still shows all guides with full content
- [ ] Resolving as a false alarm sets `FALSE_ALARM` and closes the screen
- [ ] Adding a sixth contact shows the backend's limit message
- [ ] First aid is reachable **without logging in** (the endpoints are public) —
      put an entry point on the login screen
- [ ] Guides render correctly in Arabic

## Gotchas
- `GET /first-aid` deliberately returns the full Markdown body of every guide in
  one response, precisely so you can cache the lot. One call, then offline forever.
- Do not gate first aid behind auth. In an emergency the user may be logged out.
