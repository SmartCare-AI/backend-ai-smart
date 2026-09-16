# D-05 · Treatment plan & prescription

| | |
|---|---|
| **Phase** | Doctor dashboard |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 2 days |
| **Owner** | Dev A |
| **Depends on** | D-03 |
| **Blocks** | — |

> This task closes the demo loop: the doctor prescribes, and the patient's phone
> starts getting reminders. Make sure it works end to end before the defense.

## Goal
Create a treatment plan, prescribe medicines under it, and have the backend
generate the whole intake schedule automatically. (BRD FR-016 to FR-020, AC-005)

## API — order matters
```
1. POST /treatment-plans   {patientId, diagnosisId?, description, goals?, endDate?, notes?}
                           -> TreatmentPlan
2. GET  /medicines?q=metfor&form=&page=&limit=     -> catalog type-ahead
3. POST /prescriptions
   {
     treatmentPlanId,                   // REQUIRED — BR-007
     instructions?, notes?,
     items: [ { medicineName, genericName?, form?, strength?,
                dose, timesPerDay, durationDays, route?, instructions? } ]
   }
   -> the prescription with items, and MedicineTracking rows generated
PATCH /treatment-plans/{id}/status   {status}
```

**A prescription cannot exist without a treatment plan.** If the doctor just
wants to prescribe, create a minimal plan first — do it silently in the UI rather
than forcing two explicit steps.

The backend generates `timesPerDay × durationDays` `MedicineTracking` rows per
item, which drive the patient's reminders and the adherence score. A 2× daily,
7-day prescription creates 14 scheduled doses.

## Scope
- [ ] Treatment plan form: description (required), goals, end date, linked diagnosis
- [ ] Plan list per patient with status management
- [ ] Prescription builder under a plan:
      - medicine search against `GET /medicines` with a debounced type-ahead
      - allow a medicine not in the catalog (the backend creates it)
      - per item: dose, times per day (1–6), duration in days (1–180), route, instructions
      - **show the generated schedule preview** before submitting
        ("2× daily for 7 days = 14 doses, first at 09:00 tomorrow")
- [ ] Show the patient's allergies on this screen, always visible
- [ ] Confirmation showing what the patient will receive

## Acceptance criteria
- [ ] Creating a plan then a prescription with one item, 2× daily for 7 days,
      produces 14 doses visible in the patient's P-10 screen
- [ ] The patient receives a "new prescription" push immediately
- [ ] Prescribing on a non-`ACTIVE` plan shows the backend's 400 message
- [ ] Prescribing on another doctor's plan returns 403 and is not reachable in the UI
- [ ] `timesPerDay` outside 1–6 and `durationDays` outside 1–180 are blocked client-side
- [ ] The medicine type-ahead returns results from the seeded catalog
- [ ] The schedule preview matches what the patient actually sees

## Gotchas
- `route` and `form` are enums (`ORAL`, `TABLET`, ...), not free text.
- The generated schedule starts **the next day** at fixed UTC hours
  (1× = 09:00; 2× = 09:00 and 21:00; 3× = 08:00, 14:00, 20:00; and so on). Your
  preview must match that, or the doctor will think it is broken.
- For the demo, a dose hours away is useless. Prescribe something with a slot that
  lands during the presentation, or seed one directly.
