# H-03 · Readmissions & alert quality

| | |
|---|---|
| **Phase** | Hospital dashboard |
| **Priority** | P2 — only if ahead |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | H-01 |
| **Blocks** | — |

## Goal
The two healthcare-quality indicators the BRD names: readmission rate and how
fast the care team closes alerts.

## API
```
GET /analytics/readmissions?days=90
  -> { windowDays, patientsSeen, readmittedWithin30Days, readmissionRate }

GET /analytics/alert-quality?days=30
  -> { windowDays,
       counts: [ {severity, status, count} ],
       meanResolutionMinutes: [ {severity, resolved, meanMinutes} ] }
```

## Scope
- [ ] Readmission card: the rate as a large percentage, with patients seen and
      readmitted underneath, and a one-line definition
      ("a patient who returned within 30 days of a previous visit")
- [ ] Alert quality: stacked bar of counts by severity and status
- [ ] Mean time-to-resolution per severity, as a bar chart in minutes or hours
- [ ] Flag when CRITICAL alerts take longer to resolve than HIGH ones — that is
      the insight, not the raw number
- [ ] Window selector (90 days default for readmissions, 30 for alert quality)

## Acceptance criteria
- [ ] A `null` readmission rate (no patients in the window) renders "no data"
- [ ] Severity ordering is consistent with the rest of the app
- [ ] `meanMinutes` above 120 is displayed in hours, not 4-digit minutes
- [ ] A severity with no resolved alerts is omitted rather than shown as 0 minutes
- [ ] Charts are readable in dark mode and in Arabic

## Gotchas
- With demo-scale data these numbers are tiny and can look silly (a 100%
  readmission rate from two visits). Seed enough data in X-03 that the charts tell
  a believable story.
