# D-06 · Smart Alert Center

| | |
|---|---|
| **Phase** | Doctor dashboard |
| **Priority** | P1 — stretch |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | D-01 |
| **Blocks** | — |

## Goal
Every unresolved alert across all the doctor's patients, most severe first, with
a one-tap triage action. (BRD FR-024, FR-025, AC-007)

## API
```
GET   /alerts/my-patients?page=&limit=
      -> NEW and ACKNOWLEDGED alerts across the doctor's patients,
         sorted by severity desc then createdAt desc, including patient name + MRN
PATCH /alerts/{id}/status   {status}     -> ACKNOWLEDGED | RESOLVED | DISMISSED
```

## Scope
- [ ] Alert list: severity chip, patient name and MRN, title, relative time, type icon
- [ ] Filter by severity and by type (`VITAL_ANOMALY`, `MEDICATION_ADHERENCE`,
      `AI_RISK`, `EMERGENCY`, ...)
- [ ] Detail sheet with the full description and what triggered it
- [ ] Actions: Acknowledge, Resolve, Dismiss
- [ ] Jump to the patient record (D-02) from any alert
- [ ] A badge on the shell nav item with the open count
- [ ] Auto-refresh on screen focus

## Acceptance criteria
- [ ] CRITICAL alerts sort above HIGH, and HIGH above MODERATE
- [ ] Acknowledging keeps the alert in the list but visually de-emphasized
- [ ] Resolving removes it from the open list and sets `resolvedAt`
- [ ] Only alerts for this doctor's own patients appear
- [ ] Recording an abnormal vital on the patient device (P-08) makes a new alert
      appear here within one refresh — that is the live demo
- [ ] Trying to act on a non-patient's alert returns 403 (not reachable via UI)

## Gotchas
- Open means `status IN (NEW, ACKNOWLEDGED)`. `ACTIVE` is not an alert status.
- A CRITICAL alert is escalated by the backend into an `EmergencyEvent` and the
  SMS chain, so it may already be handled by a caregiver. Show the emergency link
  when `alert.emergencyEvents` exists.
