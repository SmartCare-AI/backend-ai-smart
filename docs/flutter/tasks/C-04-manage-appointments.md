# C-04 · Manage appointments for a patient

| | |
|---|---|
| **Phase** | Family / Caregiver portal |
| **Priority** | P2 — only if ahead |
| **Estimate** | 0.5 day |
| **Owner** | Dev B |
| **Depends on** | C-01, P-04 |
| **Blocks** | — |

## Goal
A caregiver with `MANAGE_APPOINTMENTS` books and cancels on the patient's behalf.

## API
Same endpoints as P-04 and P-05, with `patientId` set to the **linked patient**:
```
POST  /appointments        {patientId: <linked patient>, doctorId, startTime, ...}
PATCH /appointments/{id}/cancel
```
The backend checks the caregiver has `MANAGE_APPOINTMENTS` or `FULL_ACCESS` and
returns 403 otherwise. `bookedById` records who actually booked it.

## Scope
- [ ] Reuse the P-04 booking flow with the patient id injected from the C-01 switcher
- [ ] Show a clear banner: "Booking for Omar Youssef" so the caregiver cannot
      mistakenly book for themselves
- [ ] Show the appointment list for the selected patient
- [ ] Hide the entry point entirely unless the link grants the permission

## Acceptance criteria
- [ ] A caregiver with `FULL_ACCESS` can book successfully
- [ ] A caregiver with only `VIEW_RECORDS` never sees the button, and the API
      returns 403 if called directly
- [ ] The booked appointment appears on the **patient's** device
- [ ] The banner naming the patient is visible on every step of the flow

## Gotchas
- Getting the `patientId` wrong here books an appointment for the caregiver's own
  (non-existent) patient profile and fails confusingly. Assert it before sending.
