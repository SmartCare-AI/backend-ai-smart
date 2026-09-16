# P-10 · Medication tracking & adherence

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 2 days |
| **Owner** | Dev B |
| **Depends on** | F-08 |
| **Blocks** | P-11, C-02 |

## Goal
The patient sees what to take and when, marks it taken or skipped, and both they
and their doctor can see the adherence score. This is the BRD's
"Medication Adherence Analysis" AI module. (FR-019, FR-020, AC-005)

## API
```
GET   /medications/doses/upcoming?hours=24        -> MedicineTracking[] with prescriptionItem.medicine
PATCH /medications/doses/{id}/take                -> status TAKEN, takenTime set
PATCH /medications/doses/{id}/skip   {notes?}     -> status SKIPPED
GET   /medications/adherence/patients/{patientId}?days=30
      -> { patientId, windowDays, taken, missed, skipped, upcoming, score }
```
`score` is `taken / (taken + missed)`, 0..1, or `null` when nothing has settled.
A **skip does not count against the score** — it is a recorded decision. A
**missed** dose does.

## Scope
- [ ] Today view grouped by time slot (morning / afternoon / evening / night),
      each row: medicine name, strength, dose, scheduled time
- [ ] Take and Skip actions; Skip opens a short reason sheet
- [ ] A dose is takeable from 1 hour before until 1 hour after its scheduled time;
      after that the backend marks it MISSED automatically — show that state
- [ ] Adherence card: the score as a ring or bar, plus taken / missed / skipped counts
- [ ] Window selector: 7 / 30 / 90 days
- [ ] Weekly calendar strip showing per-day adherence
- [ ] Explain the score in one line so it is not a mystery number

## Acceptance criteria
- [ ] Taking a dose moves it to a Taken section and updates the score without a reload
- [ ] Skipping asks for a reason and the dose shows as skipped, not missed
- [ ] A dose more than an hour overdue shows as MISSED and cannot be taken
- [ ] Trying to take an already-taken dose shows the backend's 400 message
- [ ] With no prescriptions, the screen shows an empty state, not a zero score
- [ ] A `null` score renders as "not enough data", not as 0%
- [ ] Three consecutive missed doses raises an alert visible in P-12 (the backend
      scheduler does this within a minute — good demo moment)

## Gotchas
- The model is `MedicineTracking`, with `scheduledTime` and `takenTime` — not
  `scheduledAt`/`takenAt`. See [ERD-ALIGNMENT section 2.5](../../ERD-ALIGNMENT.md).
- The backend cron marks doses MISSED 60 minutes past schedule and sends reminder
  pushes 15 minutes before. Do not implement local scheduling; it is server-side.
