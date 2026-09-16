# SHIFAA — ERD alignment

The backend has been re-aligned with the project's baseline design documents:

- `ERD/SHIFAA ERD.drawio`
- `ERD/shifaa_data_dictionary_bw.pdf` — the 31-entity specification (§4 entity specs, §5 design notes)
- `ERD/SHIFAA_BRD.pdf` — business rules BR-001..BR-013, FR-001..FR-027, TR-001..TR-006

All 31 ERD entities now exist as Prisma models with the dictionary's attribute
names, and every "VARCHAR / ENUM" attribute is a real Postgres enum. This is a
**breaking change for API clients** — the sections below list exactly what moved.

---

## 1. Entity coverage

| # | ERD entity | Model | Status |
|---|---|---|---|
| 1 | User | `User` | reshaped — account data only |
| 2 | Patient | `PatientProfile` | + names, DOB, gender, emergency contact, status |
| 3 | Doctor | `DoctorProfile` | + names, status |
| 4 | Caregiver | `CaregiverProfile` | + names, status; `relationship` now required |
| 5 | Hospital | `Hospital` | `type`/`status` are enums, `address` required |
| 6 | Department | `Department` | `status` enum |
| 7 | PatientCaregiver | `PatientCaregiver` | `permissionLevel`, `status` enum |
| 8 | Appointment | `Appointment` | Date + StartTime + EndTime |
| 9 | Visit | `Visit` | appointment link now mandatory (BR-004) |
| 10 | Assessment | `Assessment` | `date` |
| 11 | Diagnosis | `Diagnosis` | `date`, `status` enum |
| 12 | MedicalDocument | `MedicalDocument` | **new API** — `/medical-documents` |
| 13 | MedicalTest | `MedicalTest` | `doctorId` required, `type` enum |
| 14 | TestResult | `TestResult` | `date` |
| 15 | MedicalImage | `MedicalImage` | `doctorId` required, `type`/`status` enums |
| 16 | VitalSign | `VitalSign` | links to its `DeviceReading` |
| 17 | TreatmentPlan | `TreatmentPlan` | `description` required; no `title`/`visitId` |
| 18 | Prescription | `Prescription` | treatment plan now mandatory (BR-007) |
| 19 | Medicine | `Medicine` | + genericName, description, status; `form` enum |
| 20 | PrescriptionItem | `PrescriptionItem` | `route` enum |
| 21 | MedicineTracking | `MedicineTracking` | renamed from `MedicationDose` |
| 22 | Device | `Device` | **new API** — `/devices`; enums for type/status |
| 23 | DeviceReading | `DeviceReading` | **new entity + API** |
| 24 | Alert | `Alert` | + `type`; `description` required; `NEW` replaces `ACTIVE` |
| 25 | Notification | `Notification` | `message` replaces `body`; + `status` |
| 26 | OnlineVisit | `OnlineVisit` | **new entity + API** — `/online-visits` |
| 27 | Chat | `Chat` | `status` enum |
| 28 | ChatParticipant | `ChatParticipant` | `status` enum |
| 29 | Message | `Message` | `messageText` replaces `text`; + `readAt`, `status` |
| 30 | Consent | `Consent` | unchanged |
| 31 | AuditLog | `AuditLog` | unchanged |

Kept beyond the 31-entity baseline (BRD §20.1 permits added entities):
`EmergencyEvent`, `EmergencyContact`, `FirstAidGuide`, `FileObject`,
`DeviceToken`, `OtpCode`, `RefreshToken`.

---

## 2. Breaking API changes

### 2.1 Identity moved off the account (data dictionary §5)

`User` no longer has `firstName`, `lastName`, `dateOfBirth` or `gender`. They
live on the role profile, and every user payload now carries a resolved
`fullName`.

```jsonc
// before
{ "id": 3, "email": "omar@x.dev", "firstName": "Omar", "lastName": "Youssef", "gender": "MALE" }

// after
{
  "id": 3, "email": "omar@x.dev", "fullName": "Omar Youssef",
  "status": "ACTIVE",
  "patientProfile": {
    "firstName": "Omar", "lastName": "Youssef",
    "dateOfBirth": "1990-02-02T00:00:00.000Z", "gender": "MALE",
    "bloodType": "O_POS", "emergencyContact": "Mona Youssef",
    "emergencyPhone": "+201001112223", "status": "ACTIVE"
  }
}
```

- `POST /auth/register` still takes `firstName`/`lastName` — they are written to
  the patient profile it creates.
- `PATCH /users/me` routes each field to the right place: `phone` to the account,
  everything else to the caller's profile. Fields that do not apply to the
  caller's role are ignored.
- `POST /users/{id}/doctor-profile` accepts `firstName`/`lastName`; when omitted
  they are copied from the account's existing profile.
- Accounts with no role profile (ADMIN / HOSPITAL_ADMIN — the ERD defines no
  profile entity for them) fall back to the email local part for `fullName`.

`User.isActive` is replaced by `User.status` (`ACTIVE` / `INACTIVE` /
`SUSPENDED`). A suspended account now gets a distinct login error.

### 2.2 Appointments carry Date + StartTime + EndTime

`scheduledAt`/`endsAt` are gone.

```jsonc
// POST /appointments  — before
{ "patientId": 1, "doctorId": 1, "scheduledAt": "2026-10-01T10:00:00Z", "durationMinutes": 30 }
// after
{ "patientId": 1, "doctorId": 1, "startTime": "2026-10-01T10:00:00Z", "durationMinutes": 30 }
```

Responses return `date` (calendar day), `startTime` and `endTime`.
`GET /appointments/doctors/{id}/schedule` returns `busy: [{ startTime, endTime }]`.

### 2.3 A visit always belongs to an appointment (BR-004)

`POST /visits` now **requires** `appointmentId`; `patientId` is no longer
accepted and the walk-in path is gone. For a walk-in, book an immediate
appointment first, then open the visit on it. Visit payloads expose patient and
doctor through `appointment`.

### 2.4 A prescription always belongs to a treatment plan (BR-007)

`POST /prescriptions` now takes `treatmentPlanId` (required) instead of
`patientId`; the patient and prescribing doctor are read from the plan, which
must be `ACTIVE` and owned by the requesting doctor.

`POST /treatment-plans` dropped `title` and `visitId`; `description` is now
required.

### 2.5 Renamed fields

| Resource | Before | After |
|---|---|---|
| Notification | `body` | `message` |
| Message | `text` | `messageText` |
| Medication dose | `scheduledAt` / `takenAt` | `scheduledTime` / `takenTime` |
| Patient profile | `registeredAt` | `registrationDate` |
| Device | `connectedAt` / `lastSyncAt` | `connectedDate` / `lastSync` |
| Medical test | `requestedAt` / `requestedById` | `requestedDate` / `doctorId` |
| Medical image | `takenAt` / `orderedById` | `date` / `doctorId` |
| Test result | `resultedAt` | `date` |
| Prescription | `issuedAt` | `date` |
| Assessment | `createdAt` | `date` |
| Diagnosis | `diagnosedAt` | `date` |
| Medical document | `uploadedAt` | `uploadDate` |
| PatientCaregiver | `permission` | `permissionLevel` |
| Socket.IO `chat:send` | `{ chatId, text }` | `{ chatId, messageText }` |

### 2.6 Booleans became ERD status enums

| Resource | Before | After |
|---|---|---|
| User | `isActive` | `status`: ACTIVE / INACTIVE / SUSPENDED |
| Patient/Doctor/Caregiver profile | — | `status`: ACTIVE / INACTIVE / SUSPENDED |
| Hospital / Department / Medicine | `isActive` | `status`: ACTIVE / INACTIVE |
| PatientCaregiver | `isActive` | `status`: ACTIVE / ENDED / REVOKED |
| Diagnosis | `isActive` | `status`: ACTIVE / RESOLVED / CHRONIC / RULED_OUT |
| Device | `isActive` | `status`: CONNECTED / DISCONNECTED / INACTIVE |
| Chat | `isActive` | `status`: ACTIVE / ARCHIVED / CLOSED |
| Message | `deletedAt` | `status`: SENT / DELIVERED / READ / DELETED |
| Alert | `status: ACTIVE` | `status: NEW` |

Free-text columns that became enums: `Hospital.type`, `MedicalTest.type`,
`MedicalImage.type`, `MedicalDocument.type`, `Medicine.form`,
`PrescriptionItem.route`, `Device.type`. Send the enum value, not prose.

### 2.7 New endpoints

- `GET/POST/PATCH/DELETE /medical-documents` — ERD #12 document library (FR-011/FR-012)
- `POST /devices`, `GET /devices/my`, `GET /devices/patients/{id}`,
  `PATCH|DELETE /devices/{id}`, `POST|GET /devices/{id}/readings` — ERD #22/#23 (FR-021/FR-022)
- `POST /online-visits`, `GET /online-visits/my`, `GET /online-visits/{id}`,
  `PATCH /online-visits/{id}/start|end|cancel` — ERD #26 (TR-001..TR-005)
- `GET /medicines` — catalog search for the prescribing screen (ERD #19)
- `PATCH /diagnoses/{id}/status` — ERD Diagnosis.Status transitions
- `PATCH /medications/doses/{id}/skip` — ERD MedicineTracking SKIPPED
- `PATCH /notifications/{id}/archive` — ERD Notification.Status ARCHIVED
- `PATCH /chats/{id}/leave`, `DELETE /chats/messages/{id}` — ERD participant/message status
- `GET /appointments/{id}` — full appointment record
- `GET /analytics/alert-quality` — alert volume + mean time-to-resolution (BRD §16.2)

---

## 3. Documented deviations from the ERD

Each is annotated in `prisma/schema.prisma` at the model it affects.

| Deviation | Reason |
|---|---|
| `Assessment.visitId` nullable, `patientId` kept | The dictionary marks VisitID NOT NULL, but the BRD patient journey (stage 2, "Initial Assessment") has the AI Health Assistant produce an assessment **before** any appointment exists. Doctor-authored assessments always set `visitId`. |
| `AuditLog.userId` nullable | Pre-authentication events (failed login, anonymous request) must still be recorded rather than dropped (SEC-004). |
| `VitalSign.value` / `DeviceReading.value` are `DOUBLE`, not VARCHAR | Thresholds, trends and time-series charts need a numeric type. The dictionary §5 explicitly allows adapting types to the DBMS. |
| `ConsentType` reused as `PatientCaregiver.permissionLevel` | One comparable permission vocabulary for both a caregiver link and an explicit consent row, instead of two identical enums. |
| `RiskLevel` used for `Alert.severity` | Same four-level scale as `Assessment.RiskLevel`, so triage, thresholds and alerts stay directly comparable. `MODERATE` is this schema's spelling of the dictionary's "Medium". |
| `User.phone` / `User.avatarUrl` kept on the account | Account-level contact/presentation data shared by every role; keeping one copy avoids duplicating the ERD's `Caregiver.Phone` across three profiles. |
| `Appointment.bookedById` | Not in the ERD, but the caregiver booking flow (FR-006/FR-007) needs an auditable "who booked this". |
| `Alert.source`, `MedicineTracking.reminderSentAt` | Operational columns for alert de-duplication and reminder idempotency. |

---

## 4. Database migration

`prisma/migrations/20260916120000_shifaa_erd_alignment` is data-preserving:
every tightened column is backfilled first, and rows that would otherwise
violate a new NOT NULL constraint get a migrated parent row rather than being
deleted.

- Names/demographics are copied from `users` onto the profiles before the
  columns are dropped.
- Legacy walk-in visits get a generated appointment (`reason = 'Walk-in
  encounter (migrated)'`) so `Visit.appointmentId` can become mandatory.
- Prescriptions with no plan get a generated treatment plan
  (`description = 'Migrated: prescription issued before treatment plans were mandatory'`).
- `MedicalTest.doctorId` / `MedicalImage.doctorId` are backfilled from the
  visit's doctor.
- Device-sourced vital signs get a `DeviceReading` row created from their
  values and are linked to it.
- Free-text values are mapped onto the new enums (unrecognised values → `OTHER`).
- Dangling `bookedById` / `acknowledgedById` / `chats.visitId` values are nulled
  before the new foreign keys are added.

Apply it with `npm run prisma:deploy` (or `npm run deploy` on the server).

> **Verification:** the migration was executed against a real Postgres engine
> starting from a database seeded with legacy-shaped data. The resulting catalog
> was compared against `prisma migrate diff --from-empty --to-schema-datamodel`:
> 327 columns, 104 indexes, 97 constraints and 49 enum values matched exactly,
> and 36 data assertions confirmed the backfills.
