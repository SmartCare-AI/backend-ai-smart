# SHIFAA API — Flutter integration guide

The contract cheat sheet. Every task file assumes you have read this.
Live, always-correct reference: **Swagger at `https://artsoraback.tech/docs`**.

---

## 1. Base URLs

| Environment | REST base | Socket.IO host |
|---|---|---|
| Production | `https://artsoraback.tech/api/v1` | `https://artsoraback.tech` |
| Local (desktop/web) | `http://localhost:3050/api/v1` | `http://localhost:3050` |
| Local (Android emulator) | `http://10.0.2.2:3050/api/v1` | `http://10.0.2.2:3050` |
| Local (iOS simulator) | `http://localhost:3050/api/v1` | `http://localhost:3050` |

> **Socket.IO does not use the `/api/v1` prefix.** The WebSocket gateway is
> mounted on the host root. Getting this wrong is the #1 cause of "the socket
> never connects".

Android release builds: `http` to `10.0.2.2` needs a network-security config or
a debug flavor. Handle it in F-01.

---

## 2. Authentication

### The flow

```
POST /auth/register   {email,password,firstName,lastName,phone?}  -> {message}   (6-digit code emailed)
POST /auth/verify-email {email, code}                             -> AuthResponse
POST /auth/login      {email, password}                           -> AuthResponse
POST /auth/refresh    {refreshToken}                              -> AuthResponse  (rotates!)
POST /auth/logout     {refreshToken}                              -> {message}
POST /auth/forgot-password {email}                                -> {message}
POST /auth/reset-password  {email, code, newPassword}             -> {message}
POST /auth/social/firebase {idToken}                              -> AuthResponse
POST /auth/resend-verification {email}                            -> {message}
```

`AuthResponse`:

```jsonc
{
  "user": { /* see §4 */ },
  "accessToken": "eyJhbGci...",   // JWT, 15 minutes
  "refreshToken": "9a1f0e3b..."   // opaque hex, 7 days, SINGLE USE
}
```

### Rules you must implement (F-05, A-02)

- Send `Authorization: Bearer <accessToken>` on every request except the public
  ones listed in §3.
- **Refresh tokens are rotated and single-use.** Every successful `/auth/refresh`
  invalidates the old one and returns a new pair. Store the new one immediately.
- **Serialize refresh.** If five requests 401 at once and you fire five refreshes,
  four of them will fail and log the user out. Use one in-flight refresh future
  that all waiters await.
- If `/auth/refresh` itself fails → wipe tokens, route to login.
- Optional `X-Platform: ios | android | web` header. The backend records it on
  the session; unknown values are ignored. Send it.
- Store `refreshToken` in `flutter_secure_storage`, never in SharedPreferences.

### Errors that are not bugs

| Status | Meaning | What the UI should do |
|---|---|---|
| 403 `Email not verified...` | Registered but never verified | Route to the OTP screen, offer resend |
| 403 `This account has been deactivated.` / `suspended.` | `User.status` is not ACTIVE | Show a terminal message, do not retry |
| 401 on `/auth/login` | Wrong credentials | Generic "invalid email or password" |
| 400 `Code is invalid or has expired.` | Bad/expired OTP, **or unknown email** | Same message — deliberate, no account enumeration |

---

## 3. Public endpoints (no token)

`GET /health` · `POST /auth/*` · `GET /first-aid` · `GET /first-aid/{slug}`

**Everything else requires a valid access token.** The backend is secure by
default.

---

## 4. The user payload — identity lives on the profile

The ERD separates the account from personal identity. `user.firstName` **does
not exist**. Read `fullName`, or the matching profile.

```jsonc
{
  "id": 3,
  "email": "patient@shifaa.dev",
  "fullName": "Omar Youssef",          // always present, safe to render
  "phone": "+201001110002",
  "avatarUrl": null,
  "role": "PATIENT",                    // drives which shell to open
  "status": "ACTIVE",
  "provider": "EMAIL",
  "isEmailVerified": true,
  "lastLoginAt": "2026-09-16T09:30:00.000Z",
  "createdAt": "...", "updatedAt": "...",
  "patientProfile": {                   // present only for PATIENT
    "id": 1,                            // <-- patientId used by most endpoints
    "firstName": "Omar", "lastName": "Youssef",
    "medicalRecordNo": "SH-2026-000003",
    "dateOfBirth": "1985-03-21T00:00:00.000Z",
    "gender": "MALE", "bloodType": "O_POS",
    "address": "Nasr City, Cairo",
    "emergencyContact": "Mona Youssef", "emergencyPhone": "+201001110003",
    "registrationDate": "...", "status": "ACTIVE",
    "chronicDiseases": "Type 2 diabetes", "allergies": "Penicillin",
    "insuranceProvider": null, "insuranceNumber": null
  },
  "doctorProfile": null,
  "caregiverProfile": null
}
```

> **`user.id` ≠ `patientProfile.id`.** Almost every clinical endpoint takes the
> **profile id** (`patientId`, `doctorId`), not the account id. Chat is the
> exception — it takes `userId`. Cache both after login.

---

## 5. Conventions across every endpoint

### Pagination

Query `?page=1&limit=20` (limit max **100**). Response:

```jsonc
{ "items": [...], "total": 42, "page": 1, "limit": 20 }
```

**Chat messages are the exception** — cursor-based, newest first:

```jsonc
{ "items": [...], "nextCursor": 118 }   // pass ?cursor=118 for the next page
```

### Dates and times

Everything is **UTC ISO 8601**. Parse with `DateTime.parse(s).toLocal()` for
display; send with `dateTime.toUtc().toIso8601String()`. Appointment `date` is a
calendar day (`2026-10-01T00:00:00.000Z`) — never render it in local time or it
will show the previous day for negative offsets.

### Error shape (NestJS default)

```jsonc
{ "statusCode": 400, "message": ["startTime must be a valid ISO 8601 date string"], "error": "Bad Request" }
```

`message` is **either a string or a list of strings**. Handle both (F-05).
Validation is strict: unknown fields are rejected with 400, so never send extra
keys.

### Rate limits

100 req/min per IP globally. Stricter on: auth endpoints (3–5/min), avatar
upload (5/min), AI triage (10/min), device sync and vitals batch (20/min).
A 429 means back off, not retry in a loop.

### File uploads

Two steps, always:

```
1. POST /uploads          multipart: file=<binary>, purpose=<FilePurpose>   -> { id, url, mimeType, size, purpose }
2. use the returned `id` as fileId on the resource you are creating
```

Allowed: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`.
Max 10 MB (5 MB for avatars). `purpose`: `AVATAR`, `MEDICAL_REPORT`,
`LAB_RESULT`, `RADIOLOGY`, `FIRST_AID_MEDIA`, `OTHER`.

Avatar is the one exception — `PUT /users/me/avatar` takes the file directly.

---

## 6. Enums — send the value, never free text

Validation rejects anything else with a 400. Generate these as Dart enums in
F-06 and never hand-write a string.

| Enum | Values |
|---|---|
| `Role` | PATIENT · DOCTOR · CAREGIVER · HOSPITAL_ADMIN · ADMIN |
| `UserStatus`, `ProfileStatus` | ACTIVE · INACTIVE · SUSPENDED |
| `Gender` | MALE · FEMALE |
| `BloodType` | A_POS · A_NEG · B_POS · B_NEG · AB_POS · AB_NEG · O_POS · O_NEG |
| `AppointmentType` | IN_PERSON · VIDEO · CHAT |
| `AppointmentStatus` | PENDING · CONFIRMED · CANCELLED · COMPLETED · NO_SHOW |
| `VisitType` | IN_PERSON · ONLINE · FOLLOW_UP · EMERGENCY |
| `VisitStatus` | OPEN · CLOSED · FOLLOW_UP_REQUIRED |
| `AssessmentType` | AI_INITIAL · DOCTOR · FOLLOW_UP |
| `RiskLevel` | LOW · MODERATE · HIGH · CRITICAL |
| `Severity` | MILD · MODERATE · SEVERE · CRITICAL |
| `DiagnosisStatus` | ACTIVE · RESOLVED · CHRONIC · RULED_OUT |
| `TestType` | BLOOD · URINE · STOOL · IMAGING · BIOPSY · GENETIC · MICROBIOLOGY · OTHER |
| `TestStatus` | REQUESTED · IN_PROGRESS · COMPLETED · CANCELLED |
| `ImagingType` | XRAY · CT · MRI · ULTRASOUND · MAMMOGRAPHY · PET · ECHO · OTHER |
| `ImageStatus` | PENDING · AVAILABLE · REVIEWED · ARCHIVED |
| `DocumentType` | REPORT · PRESCRIPTION · RECORD · LAB_RESULT · INSURANCE · REFERRAL · DISCHARGE_SUMMARY · OTHER |
| `DocumentStatus` | ACTIVE · ARCHIVED · DELETED |
| `VitalType` | HEART_RATE · BLOOD_PRESSURE_SYSTOLIC · BLOOD_PRESSURE_DIASTOLIC · BLOOD_SUGAR · TEMPERATURE · OXYGEN_SATURATION · RESPIRATORY_RATE · WEIGHT · SLEEP_HOURS · PAIN_LEVEL · STEPS · OTHER |
| `VitalSource` | MANUAL · DEVICE |
| `DeviceType` | SMARTWATCH · FITNESS_BAND · GLUCOSE_MONITOR · BP_MONITOR · PULSE_OXIMETER · SMART_SCALE · THERMOMETER · ECG_MONITOR · OTHER |
| `DeviceStatus` | CONNECTED · DISCONNECTED · INACTIVE |
| `TreatmentPlanStatus` | ACTIVE · COMPLETED · PAUSED · CANCELLED |
| `PrescriptionStatus` | ACTIVE · COMPLETED · CANCELLED |
| `MedicineForm` | TABLET · CAPSULE · SYRUP · INJECTION · CREAM · OINTMENT · DROPS · INHALER · PATCH · SUPPOSITORY · OTHER |
| `AdministrationRoute` | ORAL · INTRAVENOUS · INTRAMUSCULAR · SUBCUTANEOUS · TOPICAL · INHALATION · RECTAL · OPHTHALMIC · NASAL · OTHER |
| `MedicineTrackingStatus` | SCHEDULED · TAKEN · MISSED · SKIPPED |
| `AlertType` | VITAL_ANOMALY · MEDICATION_ADHERENCE · AI_RISK · APPOINTMENT · EMERGENCY · SYSTEM |
| `AlertStatus` | **NEW** · ACKNOWLEDGED · RESOLVED · DISMISSED |
| `NotificationType` | APPOINTMENT · MEDICATION_REMINDER · ALERT · EMERGENCY · CHAT · SYSTEM |
| `NotificationStatus` | UNREAD · READ · ARCHIVED |
| `OnlineVisitType` | VIDEO · AUDIO · CHAT |
| `OnlineVisitStatus` | SCHEDULED · ACTIVE · COMPLETED · CANCELLED |
| `ChatType` | DIRECT · VISIT · SUPPORT |
| `ChatStatus` | ACTIVE · ARCHIVED · CLOSED |
| `ParticipantStatus` | ACTIVE · LEFT |
| `MessageStatus` | SENT · DELIVERED · READ · DELETED |
| `ConsentType` | VIEW_RECORDS · MANAGE_APPOINTMENTS · RECEIVE_ALERTS · FULL_ACCESS |
| `EmergencyType` | SOS_BUTTON · VITAL_ANOMALY · MEDICATION_CRITICAL · FALL_DETECTED · OTHER |
| `EmergencyStatus` | ACTIVE · ACKNOWLEDGED · RESOLVED · FALSE_ALARM |
| `DevicePlatform` | IOS · ANDROID · WEB |
| `FilePurpose` | AVATAR · MEDICAL_REPORT · LAB_RESULT · RADIOLOGY · FIRST_AID_MEDIA · OTHER |

> An alert that needs attention is `NEW`, **not** `ACTIVE`. `ACTIVE` is an
> *emergency* status. Mixing them up will make the alert badge always read zero.

---

## 7. Endpoint map by surface

### Patient
```
GET    /users/me                                  profile + patientProfile
PATCH  /users/me                                  edit (fields routed by role)
PUT    /users/me/avatar                           multipart file
POST   /ai/triage                                 symptom triage
GET    /ai/patients/{patientId}/risk              risk snapshot
GET    /hospitals · /hospitals/{id} · /hospitals/{id}/doctors
POST   /appointments · GET /appointments/my · GET /appointments/{id}
GET    /appointments/doctors/{doctorId}/schedule?date=YYYY-MM-DD
PATCH  /appointments/{id}/cancel
GET    /visits/my · GET /visits/{id}
GET    /assessments/patients/{patientId} · POST /assessments
GET    /medical-documents/patients/{patientId} · POST /medical-documents
POST   /vitals · POST /vitals/batch · GET /vitals/patients/{patientId}
POST   /devices · GET /devices/my · POST|GET /devices/{id}/readings
GET    /medications/doses/upcoming · PATCH /medications/doses/{id}/take|skip
GET    /medications/adherence/patients/{patientId}
GET    /prescriptions/patients/{patientId} · GET /treatment-plans/patients/{patientId}
GET    /alerts/patients/{patientId}
POST   /emergency/sos · PATCH /emergency/{id}/resolve
GET|POST /emergency/contacts · PATCH|DELETE /emergency/contacts/{id}
GET    /first-aid · GET /first-aid/{slug}                    (public)
GET    /notifications · /notifications/unread-count
PATCH  /notifications/{id}/read · /notifications/read-all · /notifications/{id}/archive
POST|DELETE /notifications/tokens                            FCM registration
POST   /chats · GET /chats/my · GET|POST /chats/{id}/messages
GET    /online-visits/my · GET /online-visits/{id}
```

### Doctor
```
GET    /appointments/my                 today's schedule + the patient list source
PATCH  /appointments/{id}/confirm|cancel
POST   /visits · GET /visits/my · GET /visits/{id} · PATCH /visits/{id}/close
POST   /visits/{id}/diagnoses · /tests · /images
PATCH  /diagnoses/{id}/status · POST /tests/{id}/result
POST   /treatment-plans · PATCH /treatment-plans/{id}/status
POST   /prescriptions · GET /prescriptions/patients/{patientId}
GET    /medicines?q=                    catalog type-ahead
GET    /alerts/my-patients · PATCH /alerts/{id}/status
PATCH  /online-visits/{id}/start|end|cancel
```

### Caregiver  *(needs backend B-01/B-02 first)*
```
GET    /alerts/patients/{patientId} · /vitals/patients/{patientId}
GET    /medications/adherence/patients/{patientId}
PATCH  /emergency/{id}/acknowledge · GET /emergency/patients/{patientId}
POST   /appointments                    with MANAGE_APPOINTMENTS permission
```

### Hospital admin
```
GET    /analytics/overview?days=30
GET    /analytics/doctor-load?days=30
GET    /analytics/adherence-by-department?days=30
GET    /analytics/readmissions?days=90
GET    /analytics/alert-quality?days=30
```

---

## 8. Socket.IO (P-15)

```dart
final socket = io('https://artsoraback.tech', OptionBuilder()
    .setTransports(['websocket'])
    .setAuth({'token': accessToken})      // access token, NOT refresh
    .build());
```

Authentication happens on the handshake. An expired access token ⇒ immediate
`error` + disconnect, so refresh before connecting and reconnect after a refresh.

| Direction | Event | Payload |
|---|---|---|
| → | `chat:join` / `chat:leave` | `{chatId}` |
| → | `chat:send` | `{chatId, messageText?, fileId?}` |
| → | `chat:typing` | `{chatId, isTyping}` |
| → | `chat:read` | `{chatId}` |
| → | `call:invite` | `{chatId, callType: 'video'\|'audio'}` |
| → | `call:accept` / `call:decline` / `call:end` | `{chatId}` |
| → | `call:signal` | `{chatId, signal}` |
| ← | `chat:message` | the created message |
| ← | `chat:typing` | `{chatId, userId, isTyping}` |
| ← | `chat:read` | `{chatId, userId, at}` |
| ← | `call:*` | relayed with `{from: userId, ...}` |
| ← | `error` | `{message}` |

The field is **`messageText`**, not `text`. You must `chat:join` before any
`call:*` relay will reach the other side.

---

## 9. Push notifications (P-14)

1. After login: `POST /notifications/tokens {token, platform}` with the FCM token.
2. On logout: `DELETE /notifications/tokens {token}` — otherwise the next user on
   that device gets the previous user's alerts.
3. Re-register on `onTokenRefresh`.
4. Payload `data` carries the deep link, e.g.
   `{"screen": "medications", "doseIds": "12,13"}` or
   `{"screen": "emergency", "id": "7"}`. Route on it.

`screen` values in use: `appointments`, `medications`, `prescriptions`,
`alerts`, `emergency`, `chat`, `call`, `online-visit`.

---

## 10. Seeded demo accounts

Password for all: `Demo1234`

| Email | Role |
|---|---|
| `patient@shifaa.dev` | PATIENT (Omar Youssef) |
| `doctor@shifaa.dev` | DOCTOR (Ahmed Hassan, Cardiology) |
| `family@shifaa.dev` | CAREGIVER (Mona Youssef, FULL_ACCESS) |
| `admin@shifaa.dev` | ADMIN |

Run `npm run db:seed` on the backend to create them.
