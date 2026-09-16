# H-02 · Doctor load & department adherence

| | |
|---|---|
| **Phase** | Hospital dashboard |
| **Priority** | P1 — stretch |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | H-01 |
| **Blocks** | — |

## Goal
Who is overloaded, who is idle, and which departments have patients actually
taking their medication. (BRD section 16.2: staff performance, adherence monitoring)

## API
```
GET /analytics/doctor-load?days=30
  -> { windowDays, doctors: [ {doctorId, name, specialization, department,
                               hospital, appointments, visits} ] }   busiest first

GET /analytics/adherence-by-department?days=30
  -> { windowDays, departments: [ {departmentId, department, hospital,
                                   taken, missed, score} ] }
```

## Scope
- [ ] Doctor load: horizontal bar chart of appointments per doctor, plus a sortable
      table (name, specialization, department, appointments, visits)
- [ ] A derived "conversion" column: visits divided by appointments, flagging
      doctors with many bookings but few recorded visits
- [ ] Department adherence: bar chart of score per department, with taken and
      missed as tooltips
- [ ] Colour bands on adherence: below 0.5 danger, 0.5 to 0.8 warning, above 0.8 success
- [ ] Shared window selector with H-01

## Acceptance criteria
- [ ] Doctors are sorted busiest first, matching the API order
- [ ] A doctor with zero appointments in the window still appears, with 0
- [ ] A department with no doses shows "no data", not a 0% bar
- [ ] Charts have accessible labels and readable values in both locales
- [ ] Tables scroll horizontally on narrow screens rather than overflowing

## Gotchas
- Adherence is attributed through the **prescribing doctor's** department, not the
  patient's. Say so in a tooltip or the number will be questioned in the defense.
- `department` and `hospital` can be null for a doctor with no assignment. Render
  "Unassigned".
