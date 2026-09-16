# P-01 · Patient home

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | F-07, A-02 |
| **Blocks** | P-02 |

## Goal
The first screen a patient sees: what is happening today and the two actions they
most likely came for.

## Layout
```
Good morning, Omar                        [avatar]
+--------------------------------------------+
|  NEXT APPOINTMENT                          |
|  Dr. Ahmed Hassan · Cardiology             |
|  Tomorrow 10:00                [ Details ] |
+--------------------------------------------+
|  TODAY'S MEDICATION      2 of 4 taken      |
|  [====----]  Metformin 500mg  09:00  [Take]|
+--------------------------------------------+
|  ACTIVE ALERTS (1)                         |
|  High heart rate · 130 bpm       [ View ]  |
+--------------------------------------------+
[  Check my symptoms (AI)  ]   [  SOS  ]
```

## API
```
GET /appointments/my?upcoming=true&limit=1
GET /medications/doses/upcoming?hours=24
GET /alerts/patients/{patientId}?status=NEW&limit=3
```
`patientId` comes from `authProvider.user.patientProfile.id` (F-06 gotcha).

## Scope
- [ ] Greeting using `fullName`, time-of-day aware and localized
- [ ] Next appointment card, or an empty state with a "Book an appointment" action
- [ ] Today's medication progress with an inline Take action (reuse from P-10)
- [ ] Active alerts summary, hidden when there are none
- [ ] Primary action: "Check my symptoms" to the AI triage (P-02)
- [ ] Persistent SOS button (P-13)
- [ ] Pull to refresh reloading all three calls in parallel

## Acceptance criteria
- [ ] A brand-new account with no data shows friendly empty states, never a spinner forever
- [ ] The three calls run in parallel, not sequentially
- [ ] A failure in one card does not blank the whole screen — each card owns its state
- [ ] Taking a dose from here updates the progress bar without a full reload
- [ ] The SOS button is reachable with one thumb on a small phone
- [ ] Renders correctly in Arabic RTL

## Gotchas
- `status=NEW` for alerts, not `ACTIVE`. `ACTIVE` is an emergency status; using it
  makes the badge permanently read zero. See [API-GUIDE section 6](../API-GUIDE.md#6-enums--send-the-value-never-free-text).
