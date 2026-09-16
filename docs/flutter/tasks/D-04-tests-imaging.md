# D-04 · Tests, results & imaging

| | |
|---|---|
| **Phase** | Doctor dashboard |
| **Priority** | P1 — stretch |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | D-03 |
| **Blocks** | — |

## Goal
Order lab tests during a visit, record their results, and attach radiology images.
(BRD FR-013, FR-014, FR-015)

## API
```
POST /visits/{id}/tests    {name, type?, notes?}                 -> MedicalTest
POST /tests/{id}/result    {value, unit?, normalRange?, interpretation?, fileId?, notes?}
                           -> marks the test COMPLETED
POST /uploads              multipart -> {id}                      (purpose RADIOLOGY / LAB_RESULT)
POST /visits/{id}/images   {type, bodyPart?, fileId, report?}      -> MedicalImage
```
`type` on a test is a `TestType`; on an image it is an `ImagingType`
(`XRAY` | `CT` | `MRI` | `ULTRASOUND` | ...). Both are enums — no free text.

## Scope
- [ ] Order test: name with a suggestion list, type picker, instruction notes
- [ ] Ordered tests list within the visit, with status chips
- [ ] Record result: value, unit, normal range, interpretation, optional report upload
- [ ] Attach image: pick or capture, choose imaging type and body part, optional
      radiology report text
- [ ] Image viewer with pinch zoom
- [ ] Both flows only available while the visit is `OPEN`

## Acceptance criteria
- [ ] Ordering a test creates it with status `REQUESTED` and the ordering doctor set
- [ ] Recording a result flips the test to `COMPLETED` and the value is visible to
      the patient in P-06
- [ ] Trying to record a second result for the same test shows the 400 message
      (a test has at most one result)
- [ ] An image upload of an unsupported type is rejected before the API call
- [ ] An image with a report saves with status `REVIEWED`; without one, `AVAILABLE`
- [ ] The uploaded file is viewable by the patient in their visit record

## Gotchas
- Upload the file first, then attach the returned `fileId`. There is no
  single-call combined endpoint.
- You can only attach a `fileId` you uploaded yourself in this session.
