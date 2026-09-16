# C-02 · Patient monitoring

| | |
|---|---|
| **Phase** | Family / Caregiver portal |
| **Priority** | P1 — stretch |
| **Estimate** | 1.5 days |
| **Owner** | Dev B |
| **Depends on** | C-01, P-08, P-10 |
| **Blocks** | — |

## Goal
The caregiver sees how the patient is doing: vitals trend, medication adherence,
alerts and upcoming appointments — in one screen.

## API
All existing, all permission-checked server-side:
```
GET /vitals/patients/{patientId}?type=&from=&to=
GET /medications/adherence/patients/{patientId}?days=30
GET /alerts/patients/{patientId}?status=NEW
GET /appointments/my                        (caregiver sees their own; use the
                                             patient detail endpoints instead)
GET /ai/patients/{patientId}/risk           explainable risk snapshot
GET /devices/patients/{patientId}
```

## Scope
- [ ] Reuse the P-08 chart widgets and the P-10 adherence card — **do not rebuild
      them**. Extract them into `shared/` if they are still inside the patient feature.
- [ ] Overview: risk snapshot at the top, then adherence, latest vitals, open alerts
- [ ] The risk snapshot's `factors` list is the explainability story — show it
- [ ] Per-vital drill-down reusing the P-08 trend screen with a patient id parameter
- [ ] A "concerning" summary line, e.g. "2 missed doses this week, heart rate high twice"

## Acceptance criteria
- [ ] All data is read-only for the caregiver; no edit control appears anywhere
- [ ] A caregiver without `VIEW_RECORDS` gets a clear permission message instead
      of a half-loaded screen
- [ ] The vitals chart is the same widget the patient sees, with the same thresholds
- [ ] Adherence below 50% is visually flagged
- [ ] The screen refreshes when the selected patient changes

## Gotchas
- The widgets from P-08 and P-10 currently default to the **logged-in** patient's
  id. Parameterize them by `patientId` before reusing, or the caregiver will see
  their own (empty) data.
