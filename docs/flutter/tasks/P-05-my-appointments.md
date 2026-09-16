# P-05 · My appointments

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | P-04 |
| **Blocks** | P-06, P-16 |

## Goal
See upcoming and past appointments, open one, and cancel if needed.

## API
```
GET   /appointments/my?status=&upcoming=&page=&limit=   -> Paginated<Appointment>
GET   /appointments/{id}                                -> full record incl. visit + onlineVisit
PATCH /appointments/{id}/cancel   {reason?}             -> the updated appointment
```
List rows include `patient`, `doctor`, `onlineVisit` and `visit` summaries, so the
list does not need extra calls.

## Scope
- [ ] Two tabs: Upcoming (`upcoming=true`) and History
- [ ] Row: doctor name, specialization, date and time, type icon, status badge
- [ ] Use `PaginatedListView` from F-08
- [ ] Detail screen: full info, the linked visit if one exists (link to P-06),
      the online-visit section if present (link to P-16)
- [ ] Cancel with a confirm dialog and an optional reason
- [ ] Only allow cancel when status is `PENDING` or `CONFIRMED`

## Acceptance criteria
- [ ] Status badges use the localized enum labels from F-04
- [ ] Cancelling moves the appointment to History and shows `CANCELLED`
- [ ] Cancelling an already `COMPLETED` appointment is not offered; if the backend
      returns 400 anyway, the message is shown, not a crash
- [ ] Pagination loads page 2 when scrolling past 20 rows
- [ ] Pull to refresh works on both tabs
- [ ] An appointment with a visit shows a "View visit record" action

## Gotchas
- The `upcoming` filter compares against `startTime`. An appointment earlier today
  that has already passed is **not** upcoming — that is correct, do not "fix" it.
- Cancelling also cancels the linked online visit server-side. Reflect that in the UI.
