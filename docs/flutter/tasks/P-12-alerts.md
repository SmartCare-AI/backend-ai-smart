# P-12 · Alerts feed

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | P1 — stretch |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | F-08 |
| **Blocks** | C-02 |

## Goal
The patient sees the health alerts the system raised about them, and why.

## API
```
GET /alerts/patients/{patientId}?status=&page=&limit=   -> Paginated<Alert>
```
Alert fields: `type`, `severity` (`RiskLevel`), `title`, `description`,
`status` (`NEW` | `ACKNOWLEDGED` | `RESOLVED` | `DISMISSED`), `createdAt`,
`resolvedAt`, `source`, `vitalSignId`.

## Scope
- [ ] Filter chips: All / Needs attention (`NEW`) / Resolved
- [ ] Row: severity chip, title, relative time, type icon
- [ ] Detail sheet: full description, what triggered it, and — when `vitalSignId`
      is present — a link into the P-08 chart for that vital type
- [ ] Group by day
- [ ] An unread count badge on the shell nav item

## Acceptance criteria
- [ ] Severity colours match the F-03 clinical palette everywhere
- [ ] Filtering by `NEW` returns only unresolved alerts
- [ ] A CRITICAL alert is visually unmistakable
- [ ] Tapping a vital-anomaly alert opens the right chart
- [ ] A patient with no alerts sees a reassuring empty state, not an error

## Gotchas
- **The patient cannot change alert status.** `PATCH /alerts/{id}/status` is
  doctor-only (D-06); the backend returns 403 for a patient. Do not show the action.
- Filter on `status=NEW`, never `ACTIVE`.
