# Backend gaps that block the Flutter team

Found while mapping the 112 existing endpoints against the four surfaces.
These are **backend tasks**, not Flutter tasks. B-01 and B-02 are hard blockers
for the Family Portal and the Hospital Dashboard — schedule them in week 1.

Total estimated backend effort: **about 1 day.**

---

## B-01 · No API for caregiver links or consent — **hard blocker**

**Priority: must, week 1. Blocks C-01, C-02, C-03, C-04.**

The `PatientCaregiver` (ERD #7) and `Consent` (ERD #30) tables exist, the access
rules read them on every request (`ConsentService`), and the seed writes one row.
But there is **no controller** — nothing can create, list, or revoke a link
through the API.

Consequence: the Family Portal can only ever show the one caregiver link created
by `npm run db:seed`. A patient cannot invite a family member, and a caregiver
cannot be granted or refused access. That is FR-006 and FR-007 in the BRD, plus
SEC-003 ("explicit patient consent shall be required before sharing protected
patient data").

**Suggested endpoints** (`src/caregivers/`):

```
POST   /caregivers/invite            patient invites by email  {email, permissionLevel, endDate?}
GET    /caregivers/my                patient: my caregivers and their permission
GET    /caregivers/patients          caregiver: patients I may access
PATCH  /caregivers/{id}              patient: change permissionLevel / endDate
DELETE /caregivers/{id}              patient: revoke (status -> REVOKED)

POST   /consents                     patient grants {grantedToUserId, type, expiresAt?}
GET    /consents/my                  patient: consents I have granted
PATCH  /consents/{id}/revoke         patient revokes (status -> REVOKED, revokedAt)
```

Business rules already implied by the schema: max one active link per
(patient, caregiver) pair — the unique constraint enforces it; `endDate` in the
past should be treated as expired; revoking sets `status = REVOKED` rather than
deleting, for auditability.

**Flutter workaround if this slips:** demo the Family Portal with the seeded
`family@shifaa.dev` account and build C-01 as a read-only list. Ugly, but it
still shows the surface. Tell the examiners the invite flow is the next sprint.

---

## B-02 · No way to create a CAREGIVER or HOSPITAL_ADMIN account — **hard blocker**

**Priority: must, week 1. Blocks C-01 and H-01 login.**

`POST /auth/register` always creates a `PATIENT` with a patient profile. The only
role-changing endpoint is `POST /users/{id}/doctor-profile` (admin → DOCTOR).
There is no path to `CAREGIVER` or `HOSPITAL_ADMIN`, so two of the four surfaces
have no accounts to log into beyond what the seed creates.

**Suggested endpoints:**

```
POST  /users/{id}/caregiver-profile   ADMIN: promote to CAREGIVER
                                      {firstName?, lastName?, relationship, address?}
PATCH /users/{id}/role                ADMIN: set HOSPITAL_ADMIN (+ hospitalId)
```

`ProfilesService.promoteToDoctor` is the template — copy its shape, including
carrying names over from an existing profile.

Cleaner alternative, if B-01 lands first: accepting a caregiver invitation
promotes the invited account to `CAREGIVER` and creates its profile
automatically. That removes the admin step entirely and is the better product
flow. Prefer this if there is time.

---

## B-03 · Doctor has no "my patients" endpoint — workaround exists

**Priority: should. D-02 is buildable without it.**

A doctor's patient list must currently be derived client-side from
`GET /appointments/my`, de-duplicating by `patient.id` across pages. That is
correct but wasteful: the doctor pulls every appointment to build a list of
maybe 20 patients, and pagination makes "all my patients" impossible to get in
one call.

**Suggested:** `GET /doctors/me/patients?page=&limit=&q=` returning distinct
patients with `lastVisitDate`, `openAlerts`, `adherenceScore`. One query with
`distinct` on the appointment table.

**Flutter workaround (use this for now):** in D-02, fetch
`GET /appointments/my?limit=100`, group by `patient.id`, sort by most recent
`startTime`. Documented in the D-02 task file.

---

## B-04 · Hospital dashboard analytics are platform-wide, not per hospital

**Priority: could. Cosmetic for the demo.**

`/analytics/*` aggregates across the entire platform. `doctor-load` and
`adherence-by-department` include the hospital name per row, but `overview`,
`readmissions` and `alert-quality` have no hospital scope, and a
`HOSPITAL_ADMIN` is not bound to a hospital anywhere in the schema.

With one seeded hospital this is invisible in the demo. It matters the moment a
second hospital exists.

**Suggested:** add `hospitalId` to `DoctorProfile`-derived scoping and accept
`?hospitalId=` on the analytics endpoints; bind `HOSPITAL_ADMIN` accounts to a
hospital (a `hospitalId` column on `User`, or a small `HospitalStaff` table).

---

## B-05 · No endpoint to list or search patients for admin/doctor onboarding

**Priority: could.**

There is no `GET /patients`. A doctor can only reach a patient who already has an
appointment with them — which is correct and privacy-preserving (the consent
rules depend on it), but it means there is no way to look up a patient by
medical record number at a reception desk.

**Suggested:** `GET /patients?q=<name|MRN>` restricted to `ADMIN` and
`HOSPITAL_ADMIN`, returning identity only (no clinical data), for the front-desk
booking flow.

---

## Summary

| ID | Gap | Priority | Blocks | Backend effort |
|---|---|---|---|---|
| B-01 | Caregiver link + consent API | **Must — week 1** | C-01…C-04 | ~4h |
| B-02 | Create CAREGIVER / HOSPITAL_ADMIN accounts | **Must — week 1** | C-01, H-01 | ~2h |
| B-03 | Doctor "my patients" endpoint | Should | D-02 (workaround exists) | ~1h |
| B-04 | Per-hospital analytics scoping | Could | H-01…H-03 (cosmetic) | ~2h |
| B-05 | Patient search for admin | Could | front-desk booking | ~1h |
