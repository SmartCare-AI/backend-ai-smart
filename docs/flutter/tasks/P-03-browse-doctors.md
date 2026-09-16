# P-03 · Browse hospitals & doctors

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | F-08 |
| **Blocks** | P-04 |

## Goal
Find a hospital, see its departments, and pick a verified doctor to book with.

## API
```
GET /hospitals                  -> active hospitals, each with active departments
GET /hospitals/{id}             -> one hospital with departments
GET /hospitals/{id}/doctors     -> verified, active doctors
```
Doctor rows return `{id, firstName, lastName, specialization, yearsOfExperience,
bio, departmentId, user: {id, avatarUrl}}`.

> `id` here is the **doctorProfile id** — that is what `POST /appointments` wants.
> `user.id` is the account id, used only for chat.

## Scope
- [ ] Hospital list with name, type badge, address
- [ ] Hospital detail: departments as filter chips, doctor list below
- [ ] Doctor card: avatar, `firstName lastName`, specialization, years of experience
- [ ] Doctor detail sheet: bio, department, hospital, and a "Book appointment" CTA
- [ ] Client-side search over doctor name and specialization
- [ ] Accept an optional incoming `specialty` argument from P-02 and pre-filter

## Acceptance criteria
- [ ] Only `ACTIVE` hospitals and departments appear (the backend already filters)
- [ ] Only verified, active doctors are listed
- [ ] Arriving from AI triage with `specialty = cardiology` pre-filters the list
- [ ] An empty department shows an empty state, not a blank screen
- [ ] Doctor names render from the profile fields, not from `user.fullName`
- [ ] Search works with Arabic input

## Gotchas
- These endpoints are **not paginated** — they return all rows. Fine at demo
  scale; do not build infinite scroll here.
- A doctor with `hospitalId: null` is not in any hospital list. Those exist; they
  are reachable only if you add a global doctor search later.
