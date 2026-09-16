# P-11 · Prescriptions & treatment plans

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | P1 — stretch |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | P-10 |
| **Blocks** | — |

## Goal
Read-only view of what the doctor prescribed and the plan it belongs to.

## API
```
GET /treatment-plans/patients/{patientId}?page=&limit=
    -> plans with prescriptions summary, diagnosis, doctor
GET /prescriptions/patients/{patientId}?page=&limit=
    -> prescriptions with items, medicine, and the parent treatmentPlan
GET /prescriptions/{id}
```

## Scope
- [ ] Treatment plan list: description, status chip, start and end dates, doctor
- [ ] Plan detail: goals, notes, linked diagnosis, and its prescriptions
- [ ] Prescription detail: issue date, status, general instructions, and each item
      with medicine name, strength, form, dose, frequency, route, duration and
      item instructions
- [ ] Link each prescription item to its doses in P-10

## Acceptance criteria
- [ ] Every prescription shows its parent treatment plan (the backend guarantees one)
- [ ] Route and form render as localized labels, not raw enum values
- [ ] A completed plan is visually distinct from an active one
- [ ] Empty states for a patient with no plans
- [ ] Long instruction text wraps correctly in Arabic

## Gotchas
- Prescriptions are listed through the treatment plan
  (`where: treatmentPlan.patientId`). `Prescription` itself no longer carries
  `patientId` or `doctorId` — read them from `treatmentPlan`.
- This screen is read-only for patients. Creating prescriptions is D-05.
