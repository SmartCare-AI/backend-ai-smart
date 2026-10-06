# Backend changes for the MVP: Phases 0–3

> **For:** the Flutter and web frontend team.
> **Backend state:** `master` at commit `df1feea` (6 October 2026).
> **Swagger:** `/docs` on any running backend. There are three new tags:
> **Doctors**, **Family Portal** and **Care Team**.
> **Background:** [../SYSTEM-WORKFLOW.md](../SYSTEM-WORKFLOW.md) §19 has the
> MVP plan. Phases 0–3 are done. Phases 4–6 come next (see the last
> section).

All paths below are relative to `/api/v1`. Error bodies keep the usual shape
(`{statusCode, message, error}`, where `message` is a string **or** a list of
strings). See [API-GUIDE.md](API-GUIDE.md).

---

## TL;DR: what you must change

| # | Change | Breaking? | Your tasks |
|---|---|---|---|
| 1 | Register has an **account type** (Patient / Doctor). Doctors fill in professional details at sign-up. | No (defaults to PATIENT) | A-01, A-04, A-05 |
| 2 | **Doctor directory** `GET /doctors` with search by specialization or name. This replaces browsing hospital by hospital. | No (old endpoint still works) | P-03, P-04, P-02 |
| 3 | **Specializations are lowercase keys** (`cardiology`, not `Cardiology`). The app shows translated labels. | **Yes** if you compare strings | P-03, D-01, A-05 |
| 4 | A doctor can **only open a patient's record after confirming** their appointment. Pending requests show the booking only. | **Yes** (403s on record screens) | D-02, D-03, D-06 |
| 5 | **Family Portal is real:** invitations, care circle, permissions, consents | New | C-01…C-04, P-01 |
| 6 | **Care team and access history** for patients, and **"my patients"** for doctors | New | P-06, D-02 |
| 7 | Triage response has `emergencyAlertId` and `doctorSearch` | No (additive) | P-02 |
| 8 | Patient profile has a **timezone**; medication doses follow it | No (additive) | A-05, P-10 |
| 9 | `POST /users/{id}/doctor-profile` was **removed** | **Yes** (admin only) | — |

---

## 1. Registration with an account type (Phase 1)

### `POST /auth/register`

```json
{
  "email": "sara@example.com",
  "password": "Passw0rd!",
  "firstName": "Sara",
  "lastName": "Nabil",
  "phone": "+201001234567",
  "accountType": "DOCTOR",
  "doctor": {
    "specialization": "cardiology",
    "yearsOfExperience": 9,
    "licenseNumber": "EG-MED-123456",
    "bio": "Heart failure clinic.",
    "hospitalId": 1,
    "departmentId": 2
  }
}
```

- `accountType`: `PATIENT` (default when omitted) or `DOCTOR`. There is **no
  caregiver option**: people become caregivers by accepting an invitation
  (§5).
- `doctor` is **required when `accountType = DOCTOR`** and ignored otherwise.
  - `specialization`: one key from `GET /doctors/specializations` (§2).
  - `yearsOfExperience`: integer from 0 to 70.
  - `licenseNumber`: 3–50 characters; letters, digits, space, `-`, `/`. It must
    be unique across the platform and can't be changed later.
  - `bio`, `hospitalId` and `departmentId` are optional. The department must
    belong to the hospital.
- The response is unchanged: `{message}`, and a code is emailed. Verify with
  the existing `POST /auth/verify-email`.
- After verification, the returned user has `role: "DOCTOR"` and a filled
  `doctorProfile` (with `isVerified: true`). **The doctor appears in search
  and can be booked immediately.** There is no admin approval in the MVP.

| Status | Meaning | UI |
|---|---|---|
| 400 | Missing `doctor` block, unknown specialization, bad hospital or department | Show field errors |
| 409 | Email already verified **or license number already registered** | Show the message as returned |

**UI suggestion (A-01):** step 1 is "I am a… Patient / Doctor". If Doctor, add
a second step with specialization (dropdown from §2), years of experience,
license number, bio, and an optional hospital/department picker (from
`GET /hospitals`).

### Google / Apple sign-in for doctors: `POST /doctors/me/profile`

Social sign-in always creates a **patient**. A doctor who signed in with
Google then calls:

```json
POST /doctors/me/profile
{ "specialization": "neurology", "yearsOfExperience": 3, "licenseNumber": "EG-444",
  "firstName": "Karim", "lastName": "Adel", "bio": "…", "hospitalId": 1 }
```

- `firstName`/`lastName` are optional and default to the names on the account.
- The response is the full user (`role` is now `DOCTOR`; `patientProfile` is
  kept).
- Returns 409 if the account already has a doctor profile or the license is
  taken.

**Flow (A-04):** after the first social login, ask "Are you a doctor?". If
yes, show the doctor form and call this endpoint.

### Doctor editing their profile

| Endpoint | Notes |
|---|---|
| `GET /doctors/me` | Own profile, **including** `licenseNumber`, `hospital`, `department` |
| `PATCH /doctors/me` | Partial: `firstName`, `lastName`, `specialization`, `yearsOfExperience`, `bio`, `hospitalId`, `departmentId`. **No** `licenseNumber`. Changing hospital without a department clears the department. |

`PATCH /users/me` still works for doctors (`bio`, `yearsOfExperience`, names),
but prefer `/doctors/me` for the professional fields.

---

## 2. Doctor directory (Phase 1)

These endpoints are public, so **no token is needed**. You can show them
before login.

### `GET /doctors/specializations`

```json
{ "items": ["internal medicine", "family medicine", "cardiology", "…"] }
```

These keys are **also** the values AI triage returns in `suggestedSpecialty`.
Store the key and translate it for display:

| Key | English | العربية |
|---|---|---|
| `internal medicine` | Internal medicine | الباطنة |
| `family medicine` | Family medicine | طب الأسرة |
| `cardiology` | Cardiology | القلب |
| `pulmonology` | Pulmonology | الصدر |
| `neurology` | Neurology | المخ والأعصاب |
| `gastroenterology` | Gastroenterology | الجهاز الهضمي |
| `endocrinology` | Endocrinology | الغدد الصماء |
| `nephrology` | Nephrology | الكلى |
| `rheumatology` | Rheumatology | الروماتيزم |
| `hematology` | Hematology | أمراض الدم |
| `oncology` | Oncology | الأورام |
| `infectious disease` | Infectious diseases | الأمراض المعدية |
| `allergy and immunology` | Allergy & immunology | الحساسية والمناعة |
| `dermatology` | Dermatology | الجلدية |
| `orthopedics` | Orthopedics | العظام |
| `urology` | Urology | المسالك البولية |
| `ophthalmology` | Ophthalmology | العيون |
| `otolaryngology` | ENT | الأنف والأذن والحنجرة |
| `psychiatry` | Psychiatry | الطب النفسي |
| `pediatrics` | Pediatrics | الأطفال |
| `obstetrics and gynecology` | Obstetrics & gynecology | النساء والتوليد |
| `general surgery` | General surgery | الجراحة العامة |
| `emergency medicine` | Emergency medicine | الطوارئ |

> ⚠️ Existing doctors were migrated to lowercase (`Cardiology` → `cardiology`).
> If your models or tests compare against `"Cardiology"`, update them.
> Unknown keys should fall back to showing the raw key.

### `GET /doctors?specialization=&q=&hospitalId=&page=&limit=`

- `specialization`: one key from the table (case-insensitive).
- `q`: name search. Each word must match the first or last name, so
  `"sara nabil"` works.
- Sorted by most experienced first. Paginated with the standard envelope.

```json
{
  "items": [
    {
      "id": 4,
      "firstName": "Sara",
      "lastName": "Nabil",
      "specialization": "cardiology",
      "yearsOfExperience": 9,
      "bio": "Heart failure clinic.",
      "avatarUrl": null,
      "hospital": { "id": 1, "name": "SHIFAA Hospital" },
      "department": null
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
```

`id` is the **doctor profile id**. Pass it as `doctorId` when booking
(`POST /appointments`, unchanged). The license number is not public.

### `GET /doctors/{id}`

This returns the same object as one search item. It returns **404** if the
doctor doesn't exist, is suspended, or hasn't verified their email. Booking
such a doctor also returns 404 ("Doctor not found or not available").

**P-03 change:** make the doctor list (search box + specialization chips) the
main screen. `GET /hospitals/{id}/doctors` still works if you want a "by
hospital" filter, but hospitals are out of MVP scope.

---

## 3. AI triage response (Phase 0)

`POST /ai/triage` returns two new fields:

```json
{
  "assessmentId": 12,
  "riskLevel": "CRITICAL",
  "suggestedSpecialty": "cardiology",
  "seekEmergencyCare": true,
  "redFlags": ["Chest pain"],
  "reasons": ["…"],
  "advice": "…",
  "engine": "rules",
  "emergencyAlertId": 31,
  "doctorSearch": { "specialization": "cardiology" },
  "disclaimer": "Assistive assessment only — not a medical diagnosis. Always consult a doctor."
}
```

- `doctorSearch`: add a **"Find a {specialty} doctor"** button that opens
  `GET /doctors?specialization=…`. This is the main path from triage to
  booking.
- `emergencyAlertId` is non-null when the result was **CRITICAL**. The backend
  has already raised a critical alert and **opened an emergency**: the care
  circle got an emergency push, and contacts get SMS after 2 minutes unless
  someone acknowledges. Show the emergency/SOS screen
  ("Your family and doctor have been alerted") instead of the normal result.

---

## 4. Doctors only see records of patients they accepted (Phases 0 + 3)

This is the biggest behaviour change for the **doctor app**.

A doctor can read or write a patient's record **only with an active care
relationship**. The relationship:

- **starts** when the doctor **confirms** an appointment
  (`PATCH /appointments/{id}/confirm`),
- is **extended** by every visit (`POST /visits`) and every finished online
  visit, lasting until 12 months after the latest one,
- **shrinks or ends** if appointments are cancelled,
- can be **revoked by the patient** at any time (§6).

A **pending** request gives no record access. The doctor can still read the
booking itself with `GET /appointments/{id}` (name, MRN, reason, time). Record
endpoints (`/vitals/patients/{id}`, `/medical-documents/patients/{id}`,
`/assessments/patients/{id}`, `/ai/patients/{id}/risk`, …) return:

```
403 "You are not a treating doctor for this patient."
```

**UI:** on a pending request, show the booking with **Accept** / **Decline**
buttons and no record tabs. If a record screen returns this 403, show "Accept
the appointment to open this patient's record" rather than a generic error.

The same rule applies to chat (a doctor can only open a chat with a patient
they treat), the alert center (`GET /alerts/my-patients`) and who receives a
patient's alerts.

### New: `GET /doctors/me/patients?q=&page=&limit=` (D-02)

This replaces the workaround of rebuilding the patient list from
`/appointments/my`.

```json
{
  "items": [
    {
      "relationshipId": 7,
      "accessExpiresAt": "2027-10-06T10:00:00.000Z",
      "patient": {
        "id": 3, "userId": 9, "firstName": "Omar", "lastName": "Youssef",
        "medicalRecordNo": "SH-2026-000003", "dateOfBirth": "1960-04-02T00:00:00.000Z",
        "gender": "MALE", "bloodType": "A_POS", "avatarUrl": null
      },
      "openAlerts": 2,
      "adherenceScore30d": 0.83,
      "lastVisitAt": "2026-09-30T09:12:00.000Z",
      "nextAppointment": { "id": 41, "startTime": "2026-10-10T08:00:00.000Z", "status": "CONFIRMED", "patientId": 3 }
    }
  ],
  "total": 1, "page": 1, "limit": 20
}
```

- `q` matches name or MRN.
- `adherenceScore30d` is between 0 and 1, or **null** when no doses were
  taken or missed in the last 30 days. Show "—" in that case, not 0 %.

---

## 5. Family Portal (Phase 2)

### The flow

```
Patient                                   Family member
  │ POST /caregivers/invite ─────────────► email + push ("Omar invited you")
  │                                          │ signs in / registers WITH THAT EMAIL
  │                                          │ GET /invitations/my
  │                                          │ POST /invitations/{id}/accept
  │ ◄──────────── push "Mona joined" ────────┘ (now a caregiver)
  │ GET /caregivers/my  (circle)               GET /caregivers/patients
  │ PATCH / DELETE /caregivers/{linkId}        DELETE /caregivers/{linkId}  (leave)
```

The invitation is matched by **email**: the invitee must sign in with the
address the patient typed. The email contains **no link or code**; the
invitation simply appears in the app under `GET /invitations/my`. Call that
endpoint after login, or when a push arrives with `data.screen =
"invitations"`.

### Permission levels (`permissionLevel` / consent `type`)

| Value | The caregiver can… |
|---|---|
| `RECEIVE_ALERTS` (default) | receive alert and emergency pushes, list the patient's alerts (`/alerts/patients/{id}`) and emergencies (`/emergency/patients/{id}`), and acknowledge emergencies. **Cannot read the medical record** (vitals, documents, visits…). |
| `VIEW_RECORDS` | read vitals, documents, visits, prescriptions, adherence |
| `MANAGE_APPOINTMENTS` | book and cancel appointments for the patient (send the patient's `patientId` in `POST /appointments`) |
| `FULL_ACCESS` | all of the above |

### Patient endpoints

| Endpoint | Body / result |
|---|---|
| `POST /caregivers/invite` | `{email, relationship, permissionLevel?, endDate?}` → invitation `{id, email, relationship, permissionLevel, accessEndDate, status:"PENDING", expiresAt, …}` |
| `GET /caregivers/my` | `{maxCompanions: 2, caregivers: [link], pendingInvitations: [invitation]}` |
| `PATCH /caregivers/{linkId}` | `{permissionLevel?, endDate?}`; send `endDate: null` to remove the end date |
| `DELETE /caregivers/{linkId}` | Removes the caregiver → `{id, status:"REVOKED"}`. Access stops immediately. |
| `DELETE /caregivers/invitations/{id}` | Cancels a pending invitation |

A `link` in `caregivers[]` looks like this:

```json
{
  "id": 5, "patientId": 3, "caregiverId": 2,
  "permissionLevel": "RECEIVE_ALERTS", "status": "ACTIVE",
  "startDate": "2026-10-06T…", "endDate": null,
  "caregiver": {
    "id": 2, "firstName": "Mona", "lastName": "Youssef", "relationship": "daughter",
    "user": { "id": 12, "email": "mona@example.com", "phone": null, "avatarUrl": null }
  }
}
```

Rules and errors:

| Status | When |
|---|---|
| 400 | Inviting your own email; `endDate` in the past |
| 409 | Already in the circle; already has a pending invitation (cancel it first); **circle full**: at most **2 companions, counting pending invitations** |

Invitations expire after **7 days**. Expired ones disappear from both lists.

### Invitee endpoints (any logged-in account)

| Endpoint | Result |
|---|---|
| `GET /invitations/my` | `{items: [{id, relationship, permissionLevel, expiresAt, patient: {id, firstName, lastName}, …}]}` |
| `POST /invitations/{id}/accept` | **200** with the full updated user |
| `POST /invitations/{id}/decline` | 200 with the invitation |

Errors: 404 (not addressed to your email), 400 (expired, already answered, or
your own circle).

> ⚠️ **Role switch on accept.** A plain patient account becomes
> `role: "CAREGIVER"` when it accepts. The response is the updated user:
> **reload the session state and route to the Family Portal shell**. A doctor
> who accepts keeps `role: "DOCTOR"`. Until Phase 5 (role switching) ships,
> an account can't switch back to patient mode, so **use separate accounts for
> demo patients and demo caregivers.**

### Caregiver endpoints

`GET /caregivers/patients` (role CAREGIVER):

```json
{
  "items": [
    {
      "linkId": 5,
      "permissionLevel": "RECEIVE_ALERTS",
      "permissions": ["RECEIVE_ALERTS", "VIEW_RECORDS"],
      "startDate": "…", "endDate": null,
      "openAlerts": 1,
      "patient": { "id": 3, "userId": 9, "firstName": "Omar", "lastName": "Youssef",
                   "medicalRecordNo": "SH-2026-000003", "dateOfBirth": null,
                   "gender": "MALE", "bloodType": null, "avatarUrl": null }
    }
  ]
}
```

- `patient.id` is the id to use with `/vitals/patients/{id}`,
  `/alerts/patients/{id}`, `/emergency/patients/{id}`, and so on.
- **`permissions`** is the effective set (link level plus extra consents).
  Use it to show or hide tabs. A record screen without `VIEW_RECORDS` or
  `FULL_ACCESS` returns `403 "The patient has not granted you this
  permission."`
- To leave a circle: `DELETE /caregivers/{linkId}` → `{status: "ENDED"}`.

### Extra consents (optional UI, P1)

These are extra permissions on top of the link level, optionally time-limited.
Example: a caregiver with "alerts only" can view records until Friday.

| Endpoint | Body / result |
|---|---|
| `POST /consents` | `{grantedToUserId, type, expiresAt?}`. `grantedToUserId` = `caregiver.user.id` from `GET /caregivers/my`. 400 if the user is not in the circle; 409 if a duplicate is active. |
| `GET /consents/my` | `{items: [{id, type, status, expiresAt, grantedTo: {id, email, caregiverProfile}}]}`. `status` shows `EXPIRED` once past `expiresAt`. |
| `PATCH /consents/{id}/revoke` | Revokes it |

Removing a caregiver (or the caregiver leaving) also revokes all their extra
consents.

---

## 6. Care team and access history (Phase 3)

These give patients visibility and control over doctor access (role PATIENT).

### `GET /patients/me/care-team`

```json
{
  "items": [
    {
      "id": 7,
      "since": "2026-09-01T…",
      "expiresAt": "2027-09-30T…",
      "doctor": { "id": 4, "userId": 15, "firstName": "Sara", "lastName": "Nabil",
                  "specialization": "cardiology", "avatarUrl": null,
                  "hospital": { "id": 1, "name": "SHIFAA Hospital" } },
      "lastVisitAt": "2026-09-30T…",
      "nextAppointment": { "id": 41, "doctorId": 4, "startTime": "…", "status": "CONFIRMED" }
    }
  ]
}
```

UI: a "Doctors with access to my record" screen, showing "until {expiresAt}"
and a **Remove access** action.

### `DELETE /patients/me/care-team/{id}`

- Returns `{id, status: "REVOKED", revokedAt}`. The doctor loses access **and**
  stops receiving the patient's alerts. The doctor gets a push.
- Returns **409** "You have an upcoming appointment with this doctor. Cancel
  it first." Offer a shortcut to that appointment (`nextAppointment.id`).
- If the patient later books that doctor again and the doctor confirms,
  access comes back.

### `GET /patients/me/access-history?page=&limit=`

```json
{
  "items": [
    { "id": 88, "at": "2026-10-06T10:01:00Z", "outcome": "ALLOWED",
      "role": "DOCTOR", "permission": "VIEW_RECORDS",
      "actor": { "userId": 15, "name": "Sara Nabil" } },
    { "id": 87, "at": "2026-10-06T09:40:00Z", "outcome": "DENIED",
      "role": "DOCTOR", "permission": "VIEW_RECORDS",
      "actor": { "userId": 21, "name": "Nosy Doctor" } }
  ],
  "total": 2, "page": 1, "limit": 20
}
```

- This covers doctors, caregivers and admins; the patient's own reads are not
  listed.
- Repeated reads by the same person within 5 minutes appear once.
- `DENIED` means someone tried and was refused. Show it with a warning colour.
- `permission` is what the screen needed (`VIEW_RECORDS`,
  `MANAGE_APPOINTMENTS`, `RECEIVE_ALERTS`, `FULL_ACCESS`); translate it into
  readable text.

---

## 7. Patient timezone and medication times (Phase 0)

- `patientProfile.timezone` (IANA name, default `"Africa/Cairo"`) is returned
  in `GET /users/me`.
- Update it with `PATCH /users/me {"timezone": "Asia/Riyadh"}`. Invalid names
  return 400.
- **New prescriptions** schedule doses at local hours: once a day at 09:00;
  twice at 09:00 and 21:00; three times at 08:00, 14:00 and 20:00, and so on.
  Daylight-saving changes are handled. Existing doses aren't moved.
- `scheduledTime` stays a UTC ISO string. **Convert it to device local time
  for display** as before.
- Suggestion (A-05): set the timezone once after login from the device
  (`flutter_timezone` or similar) if it differs from the profile.

---

## 8. Smaller changes

| Change | Detail |
|---|---|
| `GET /appointments/{id}` | The appointment's own doctor and patient can always read it (including PENDING). Others need record access. |
| Visits | `POST /visits` from a `NO_SHOW` appointment returns 400 (like `CANCELLED`). |
| Doctor suspension (admin) | `GET /admin/doctors?status=&q=` and `PATCH /admin/doctors/{id}/status {status: "SUSPENDED" \| "ACTIVE", reason?}`. Suspending a doctor hides them from search, blocks record access, **cancels their future appointments** and notifies the patients (`APPOINTMENT` push). Patient apps should simply refresh their appointment list. |
| Removed | `POST /users/{id}/doctor-profile` (admin promotion) → 404 |
| CORS | The backend reads `CORS_ORIGINS`. When it's empty, every origin is allowed (unchanged). If the server sets a list, the **web build's origin must be in it**; wildcards like `http://localhost:*` work. This applies to Socket.IO too. |
| Emergencies | API unchanged. Escalation SMS now survive a server restart. |

---

## 9. New push notifications (`data.screen` values)

These are all `type: "SYSTEM"` unless noted. Route on `data.screen`:

| `data.screen` | Sent to | When |
|---|---|---|
| `invitations` (+ `id`) | Invitee | Invited to a care circle (only if they already have an account) |
| `care-circle` | Patient | A caregiver accepted, declined or left |
| `family` (+ `id` = patient id) | Caregiver | Permission changed, extra consent granted, or removed from a circle |
| `patients` | Doctor | A patient removed their record access |
| `profile` | Doctor | Doctor account suspended or reactivated |
| `appointments` (+ `id`), type `APPOINTMENT` | Patient | Appointment cancelled because the doctor was suspended |
| `emergency` (+ `id`), type `EMERGENCY` | Care circle | Also fired by a CRITICAL AI triage now |

---

## 10. Test accounts and a demo script

`npm run db:seed` still creates `admin@shifaa.dev`, `doctor@shifaa.dev`,
`patient@shifaa.dev` and `family@shifaa.dev` (password `Demo1234`). The seeded
doctor's specialization is now `cardiology`.

A full demo of the new flows:

1. Register a **doctor** in the app (cardiology) and verify the email.
2. Log in as `patient@shifaa.dev` → AI triage with "palpitations, mild" →
   **Find a cardiology doctor** → book the new doctor. (Avoid "chest pain":
   it is a red flag, so it returns CRITICAL and opens a real emergency.)
3. As the doctor: open the request (no record tabs) → **Accept** → the record
   opens and the patient appears in **My patients**.
4. As the patient: **Care circle** → invite a new email as "daughter" with
   *Alerts only*.
5. Register that email → **Invitations** → **Accept** → the app is now the
   Family Portal.
6. As the patient: record a heart rate of 130 → the caregiver and the doctor
   get an alert.
7. As the patient: **Doctors with access** → see the doctor; **Access history**
   shows the doctor's reads.

---

## 11. Not built yet (Phases 4–6)

| Phase | What's coming | What it changes for you |
|---|---|---|
| 4: Scheduling | Doctor working hours, **free-slot endpoint**, appointment reminders (24 h / 1 h), auto-expiry of unconfirmed requests, automatic `NO_SHOW` | P-04 will pick from real free slots instead of computing them from `GET /appointments/doctors/{id}/schedule`. Doctors get an availability screen. |
| 5: Multi-role (stretch) | Switch between patient / doctor / caregiver modes on one account | A mode switcher in the shell; fixes the "accepting an invitation leaves patient mode" limitation |
| 6: Quality | End-to-end tests, demo seed, Swagger polish | A richer demo seed |

Until Phase 4 ships, keep using `GET /appointments/doctors/{id}/schedule`
(busy slots) as today.
