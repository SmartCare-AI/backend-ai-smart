# D-02 · My patients & unified record

| | |
|---|---|
| **Phase** | Doctor dashboard |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 2 days |
| **Owner** | Dev A |
| **Depends on** | D-01 |
| **Blocks** | D-03, D-05 |

## Goal
The BRD's "unified patient record": one screen where the doctor sees the whole
history without hunting through tabs. This is what "reduces doctor review time"
in the project pitch.

## API
```
GET /appointments/my?limit=100            -> derive the patient list (see below)
GET /visits/my?page=&limit=               -> this doctor's encounters
GET /visits/{id}                          -> the full record
GET /vitals/patients/{patientId}?type=&from=&to=
GET /medications/adherence/patients/{patientId}?days=30
GET /alerts/patients/{patientId}?status=NEW
GET /assessments/patients/{patientId}     -> includes the AI triage results
GET /ai/patients/{patientId}/risk         -> explainable risk snapshot
GET /medical-documents/patients/{patientId}
GET /treatment-plans/patients/{patientId}
GET /prescriptions/patients/{patientId}
```

## Building the patient list (backend gap B-03)
There is no `GET /doctors/me/patients` yet. Until there is:
fetch `GET /appointments/my?limit=100`, group by `patient.id`, keep the most
recent `startTime` per patient, sort descending. Cache it in a provider so you do
not refetch on every tab.

## Scope
- [ ] Patient list: name, MRN, last visit date, open-alert count, adherence score
- [ ] Client-side search by name or MRN
- [ ] Patient record screen with tabs:
      **Summary** (risk snapshot + factors, open alerts, adherence, latest vitals) ·
      **Timeline** (visits newest first) · **Vitals** (charts) ·
      **Medications** · **Documents** · **AI assessments**
- [ ] The Summary tab is the default and must be readable in one screen
- [ ] Reuse the P-08 chart and P-10 adherence widgets, parameterized by `patientId`
- [ ] Show the patient's `chronicDiseases` and `allergies` prominently — allergies
      especially, above any prescribing action

## Acceptance criteria
- [ ] The list contains every patient the doctor has an appointment with, deduplicated
- [ ] Opening a patient loads the Summary in under two seconds on the demo data
- [ ] AI triage assessments (`type = AI_INITIAL`) are visibly distinguished from
      doctor-authored ones, with the risk level and the reasons shown
- [ ] Allergies are visible before the doctor can reach the prescribing flow
- [ ] A patient with no data in a tab shows an empty state, not a spinner
- [ ] Opening a patient the doctor has no relationship with returns 403 and is
      handled cleanly (should not be reachable through the UI)

## Gotchas
- The doctor's access is derived from having an appointment with the patient. No
  appointment means 403 on every clinical endpoint — that is the consent rule.
- `Visit` has no `patientId`; group visits by `visit.appointment.patientId`.
