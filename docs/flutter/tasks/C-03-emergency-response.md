# C-03 · Emergency response

| | |
|---|---|
| **Phase** | Family / Caregiver portal |
| **Priority** | P1 — stretch |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | C-01, P-13 |
| **Blocks** | — |

> This is the other half of the best demo moment: the patient presses SOS, and
> this screen lights up on the caregiver's phone.

## Goal
The caregiver is alerted to an emergency, sees where the patient is, and taps
"I'm on it" to stop the SMS escalation.

## API
```
GET   /emergency/patients/{patientId}?status=ACTIVE
PATCH /emergency/{id}/acknowledge      -> ACKNOWLEDGED, stops escalation
PATCH /emergency/{id}/resolve          {falseAlarm?}
```
Requires `RECEIVE_ALERTS` or `FULL_ACCESS` on the link.

## Scope
- [ ] Full-screen emergency alert when an EMERGENCY push arrives, over any screen
- [ ] Show patient name, emergency type, description, elapsed time
- [ ] If `latitude`/`longitude` are present: a static map preview plus an
      "Open in Maps" action (`https://maps.google.com/?q=lat,lng`)
- [ ] A large **"I'm on it"** button calling acknowledge
- [ ] After acknowledging, show that the patient has been told help is coming
- [ ] Emergency history list per patient
- [ ] Resolve / mark false alarm

## Acceptance criteria
- [ ] An SOS from the patient device shows the alert on the caregiver device
      within seconds, even with the app in the background
- [ ] Acknowledging stops the SMS escalation — verify the backend log shows no SMS
      after acknowledgement inside the window
- [ ] The patient receives the "help is on the way" notification naming the responder
- [ ] With no location shared, the screen still works and says location is unavailable
- [ ] Acknowledging an already-resolved emergency shows the backend's 400 message
- [ ] The alert sound is distinct from a normal notification

## Gotchas
- The default escalation window is 2 minutes (`EMERGENCY_ESCALATION_MINUTES`).
  For a live demo, shorten it on the backend so escalation is visible, or lengthen
  it so it does not fire mid-presentation. Decide before the defense.
- Test with the app **killed**, not just backgrounded. That is the real scenario.
