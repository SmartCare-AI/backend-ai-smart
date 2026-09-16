# C-01 · Caregiver shell & linked patients

| | |
|---|---|
| **Phase** | Family / Caregiver portal |
| **Priority** | P1 — stretch |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | F-07, **backend B-01 + B-02** |
| **Blocks** | C-02, C-03, C-04 |

> **BLOCKED until the backend ships B-01 and B-02.** There is currently no API to
> link a caregiver to a patient or to create a CAREGIVER account. See
> [BACKEND-GAPS.md](../BACKEND-GAPS.md). Raise this in week 1, not week 5.

## Goal
A family member signs in and sees the patients they are authorized to support,
with the permission level each link grants. (BRD FR-006, FR-007, BR-003)

## API — after B-01 lands
```
GET   /caregivers/patients        -> patients I may access, with permissionLevel + status
PATCH /caregivers/{id}            -> (patient side) change permission
```
Permission levels are `ConsentType`: `VIEW_RECORDS`, `MANAGE_APPOINTMENTS`,
`RECEIVE_ALERTS`, `FULL_ACCESS`.

## Scope
- [ ] Caregiver shell nav: Patients · Alerts · Emergency · More
- [ ] Linked-patients list: name, MRN, relationship, permission chip
- [ ] Patient switcher kept in a provider — every caregiver screen reads the
      selected patient from it, so no screen has to ask again
- [ ] Permission-aware UI: hide anything the link does not grant. A
      `VIEW_RECORDS`-only caregiver must not see a Book Appointment button.
- [ ] Empty state when no patient has linked this caregiver, explaining how to be invited

## Acceptance criteria
- [ ] Logging in as `family@shifaa.dev` shows the seeded linked patient
- [ ] The selected patient persists across tab switches
- [ ] A caregiver with only `RECEIVE_ALERTS` sees alerts but not the medical record
- [ ] An expired link (`endDate` in the past) or `status != ACTIVE` does not appear
- [ ] Calling a patient endpoint the caregiver lacks permission for shows the
      backend's 403 message cleanly, never a crash

## Interim workaround if B-01 slips
Build the list read-only against the seeded link and put the invite flow behind a
"coming soon" state. You still demo the surface; be honest about it in the defense.

## Gotchas
- The backend enforces permissions on every call regardless of what the UI hides.
  Hiding a button is UX, not security — never rely on it alone.
