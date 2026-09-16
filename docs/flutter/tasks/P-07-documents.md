# P-07 · Medical documents library

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | P1 — stretch |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | F-08 |
| **Blocks** | — |

## Goal
The patient keeps their own reports, discharge summaries and insurance papers in
one place, and can upload new ones. (BRD FR-011, FR-012)

## API
```
POST   /uploads                                  multipart: file, purpose   -> {id, url, ...}
POST   /medical-documents  {patientId?, fileId, name, type?, description?}
GET    /medical-documents/patients/{patientId}?type=&status=&page=&limit=
GET    /medical-documents/{id}
PATCH  /medical-documents/{id}   {name?, type?, description?, status?}
DELETE /medical-documents/{id}                   soft delete -> status DELETED
```
Two steps always: upload the file first, then attach the returned `id` as `fileId`.
`type`: `REPORT` | `PRESCRIPTION` | `RECORD` | `LAB_RESULT` | `INSURANCE` |
`REFERRAL` | `DISCHARGE_SUMMARY` | `OTHER`.

## Scope
- [ ] Grid or list with a type filter chip row
- [ ] Upload flow: pick file or camera, choose type, name it, upload with progress
- [ ] Viewer: images inline, PDFs via an external viewer or `flutter_pdfview`
- [ ] Rename / re-classify / delete with confirmation
- [ ] Show `uploadDate` and who uploaded it (the patient or a doctor)

## Acceptance criteria
- [ ] Only jpeg, png, webp and pdf are selectable; anything else is rejected before upload
- [ ] A file above 10 MB is rejected client-side with a clear message
- [ ] Upload shows real progress, and a failed upload can be retried without
      re-picking the file
- [ ] Deleting hides the document from the list but the API still has it (soft delete)
- [ ] A document uploaded by the doctor is visible to the patient and labelled as such
- [ ] Works on web as well as Android (the file picker differs)

## Gotchas
- The backend rejects attaching a `fileId` that you do not own. Upload and attach
  in the same session as the same user.
- Patients may omit `patientId` — the backend defaults to their own record. A
  doctor or caregiver **must** send it.
