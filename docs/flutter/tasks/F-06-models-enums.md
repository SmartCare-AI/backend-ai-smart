# F-06 · API models & enums

| | |
|---|---|
| **Phase** | Foundations |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev B |
| **Depends on** | F-02 |
| **Blocks** | Every feature |

## Goal
Typed, immutable Dart models for every payload the app touches, and Dart enums
for all 38 backend enums, so a typo becomes a compile error instead of a 400.

## Scope
- [ ] `models/enums/` — one file per enum group, each value annotated with
      `@JsonValue('SCREAMING_SNAKE')`. Copy the values verbatim from
      [API-GUIDE section 6](../API-GUIDE.md#6-enums--send-the-value-never-free-text).
- [ ] Add an `unknown` fallback value with `@JsonValue(null)` / `unknownEnumValue`
      so a future backend enum addition does not crash the app.
- [ ] `models/` freezed models for: `UserModel`, `PatientProfile`, `DoctorProfile`,
      `CaregiverProfile`, `AuthResponse`, `Hospital`, `Department`, `Appointment`,
      `Visit`, `Assessment`, `Diagnosis`, `MedicalTest`, `TestResult`,
      `MedicalImage`, `MedicalDocument`, `TreatmentPlan`, `Prescription`,
      `PrescriptionItem`, `Medicine`, `MedicineTracking`, `VitalSign`, `Device`,
      `DeviceReading`, `Alert`, `Notification`, `OnlineVisit`, `Chat`,
      `ChatParticipant`, `Message`, `EmergencyEvent`, `EmergencyContact`,
      `FirstAidGuide`, `FileObject`, `TriageResult`, `RiskSnapshot`,
      `AdherenceSummary`.
- [ ] A generic `Paginated<T>` for `{items, total, page, limit}`.
- [ ] A `CursorPage<T>` for `{items, nextCursor}` (chat only).
- [ ] Parse all timestamps to `DateTime` (they arrive as UTC ISO 8601).

## Acceptance criteria
- [ ] `dart run build_runner build --delete-conflicting-outputs` succeeds with no warnings
- [ ] A unit test round-trips a real captured JSON response for **at least 10**
      models. Capture the JSON from Swagger against the seeded database.
- [ ] Deserializing an unknown enum value yields `unknown` instead of throwing
- [ ] `user.fullName` is used for display; nothing reads `user.firstName`

## Gotchas
- **`user.id` is not `patientProfile.id`.** Most clinical endpoints take the
  **profile** id. Name the fields so they cannot be confused: `userId` vs `patientId`.
- `Appointment.date` is a calendar day at UTC midnight. Keep it separate from
  `startTime`, and never render it with a local-time formatter.
- Split the work with Dev A by feature so you are not both editing `models/`.
