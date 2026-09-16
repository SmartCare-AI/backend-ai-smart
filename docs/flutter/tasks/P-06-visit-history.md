# P-06 · Visit history & full record

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | P1 — stretch |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | P-05 |
| **Blocks** | — |

## Goal
The "unified patient record" the BRD promises: everything that happened in one
clinical encounter, in one screen.

## API
```
GET /visits/my?page=&limit=   -> Paginated<Visit> with appointment/patient/doctor
GET /visits/{id}              -> the full record
```
`GET /visits/{id}` returns, in one payload: `appointment` (with patient, doctor,
onlineVisit), `assessments`, `diagnoses` (each with its `treatmentPlans`),
`medicalTests` (each with `result` and the result's `file`), and `medicalImages`
(each with its `file`).

## Scope
- [ ] Visit list grouped by year, newest first
- [ ] Detail screen as collapsible sections:
      Summary (date, doctor, type, status, main complaint) ·
      Assessments · Diagnoses · Tests & results · Imaging · Treatment plans
- [ ] Diagnoses show name, ICD-10 `code`, `severity` chip and `status`
- [ ] Test rows show status; completed ones show value, unit, normal range and
      interpretation, with a "view report" action when `result.file` exists
- [ ] Imaging rows open the file (`cached_network_image` for images, external
      viewer for PDFs)
- [ ] Empty sections are hidden, not shown as empty boxes

## Acceptance criteria
- [ ] A visit with no tests hides the Tests section entirely
- [ ] A test result that is out of its normal range is visually flagged
- [ ] Patient and doctor names come from `visit.appointment.patient/doctor`
- [ ] Opening a PDF report works on Android and on web
- [ ] The screen renders a fully populated visit without overflow in Arabic RTL

## Gotchas
- **`Visit` no longer carries `patientId` or `doctorId`.** They live on
  `visit.appointment`. See [ERD-ALIGNMENT section 2.3](../../ERD-ALIGNMENT.md).
- Treatment plans hang off **diagnoses**, not off the visit directly.
