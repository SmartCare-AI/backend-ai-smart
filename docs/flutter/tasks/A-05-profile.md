# A-05 · Profile view & edit (role-aware)

| | |
|---|---|
| **Phase** | Auth & identity |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev B |
| **Depends on** | A-02, F-06 |
| **Blocks** | C-02 |

## Goal
Every role can see and edit their own profile. The form shows the fields that
belong to that role and nothing else.

## User story
> As a patient I maintain my demographics, blood type, emergency contact and
> medical background so the doctor and the AI have accurate context.
> (BRD FR-003, FR-005)

## API
```
GET   /users/me      -> user with patientProfile | doctorProfile | caregiverProfile
PATCH /users/me      -> partial update, fields routed by role
PUT   /users/me/avatar   multipart file (jpeg/png/webp, max 5 MB)
```

`PATCH /users/me` accepted fields, by role:

| Field | Applies to |
|---|---|
| `firstName`, `lastName` | all roles (written to the profile) |
| `phone` | all roles (the account) |
| `dateOfBirth`, `gender`, `bloodType`, `emergencyContact`, `emergencyPhone`, `chronicDiseases`, `allergies`, `insuranceProvider`, `insuranceNumber` | PATIENT |
| `address` | PATIENT and CAREGIVER |
| `relationship` | CAREGIVER |
| `bio`, `yearsOfExperience` | DOCTOR |

Send only changed fields. Unknown fields are rejected with a 400.

## Scope
- [ ] Profile screen showing `fullName`, avatar, email, role badge, and the
      role-specific detail card (patient shows MRN, blood type, allergies)
- [ ] Edit screen with only the fields valid for the caller's role
- [ ] Avatar picker (`image_picker`) with a client-side size check before upload
- [ ] Refresh `authProvider` after a successful save so the whole app sees the new name
- [ ] Settings entries: language switcher (F-04), theme mode, logout

## Acceptance criteria
- [ ] The patient form shows blood type and allergies; the doctor form shows bio
      and years of experience; the caregiver form shows relationship
- [ ] Saving one field sends only that field
- [ ] The medical record number is displayed but **read-only**
- [ ] Uploading a 6 MB image is rejected client-side with a clear message, not a 400
- [ ] Changing the name updates the greeting on the home screen without a restart
- [ ] `dateOfBirth` is sent as an ISO date and renders correctly in both locales

## Gotchas
- An ADMIN or HOSPITAL_ADMIN account has no profile entity, so
  `PATCH /users/me` with a name returns 400. Hide the name fields for those roles.
- `fullName` is computed by the backend from the profile. After a rename, re-fetch
  `/users/me` rather than patching the cached string.
