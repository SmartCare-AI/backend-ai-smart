# X-03 · Demo dataset & defense script

| | |
|---|---|
| **Phase** | Quality & release |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Both |
| **Depends on** | Milestone M4 |
| **Blocks** | — |

> A working app with empty screens demos badly. A rehearsed 10-minute story on
> realistic data is what gets marks. Do not skip this task.

## Goal
A seeded, believable dataset and a rehearsed script that shows all four surfaces
and both AI modules in about 10 minutes, on real devices.

## Scope
- [ ] Extend the backend seed (`prisma/seed.ts`) or write a script that creates:
      - 3 patients with 3+ months of vitals history (so charts have shape)
      - 2 doctors across 2 departments
      - 1 caregiver linked to the main patient with `FULL_ACCESS`
      - past visits with diagnoses, tests with results, and one radiology image
      - an active treatment plan with a prescription and partly-completed doses
        (some TAKEN, some MISSED) so the adherence score is not 0% or 100%
      - a handful of resolved alerts so the quality charts (H-03) are not empty
- [ ] Two physical devices, or one device plus Chrome, both pre-logged-in
- [ ] A written script with timings, below
- [ ] **Rehearse it twice, end to end, on the real backend**

## Suggested 10-minute script
| Min | Surface | What you show |
|---|---|---|
| 0–1 | — | The problem, and the four connected surfaces |
| 1–3 | Patient | Register or log in, AI triage **in Arabic** returning CRITICAL with red flags and reasons, tap through to book |
| 3–4 | Patient | Book an appointment with the suggested specialty |
| 4–6 | Doctor (web) | Schedule, confirm, open the patient record showing the AI assessment, run a visit, diagnose, prescribe |
| 6–7 | Patient | The prescription arrives as a push, doses appear, mark one taken, adherence updates |
| 7–8 | Patient | Record an abnormal vital, alert is raised, it appears in the doctor's Alert Center live |
| 8–9 | Patient + Caregiver | Press SOS, the caregiver device lights up, tap "I'm on it", the patient sees help is coming |
| 9–10 | Hospital (web) | Overview KPIs, doctor load, adherence by department |

## Acceptance criteria
- [ ] The full script runs end to end without a crash, twice in a row
- [ ] Every chart has enough data to look meaningful
- [ ] Push notifications arrive reliably on the demo devices
- [ ] A backup plan exists: recorded video of each segment, in case the venue
      Wi-Fi fails
- [ ] Demo accounts and passwords are written on a card, not recalled from memory
- [ ] Airplane-mode first aid is demonstrated (it is a memorable 20 seconds)

## Gotchas
- Medication reminders fire 15 minutes before a dose. Seed a dose that lands
  during your slot, or the reminder will not appear on cue.
- The emergency SMS escalation is 2 minutes by default. Either shorten it so the
  escalation is visible, or lengthen it so it does not fire mid-demo. Decide.
- Venue Wi-Fi blocks WebSockets more often than you would think. Test the chat and
  the socket on the actual network, or fall back to mobile data.
