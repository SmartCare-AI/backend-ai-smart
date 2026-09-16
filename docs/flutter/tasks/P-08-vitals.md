# P-08 · Vitals entry & charts

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 2 days |
| **Owner** | Dev B |
| **Depends on** | F-08 |
| **Blocks** | P-09, C-02 |

## Goal
Record a measurement, see the trend, and understand when a reading is out of
range. This is the data the alert engine and the AI risk module run on, so it
demos the whole monitoring chain. (BRD FR-023)

## API
```
POST /vitals        {type, value, unit, measuredAt?, deviceId?}   -> VitalSign
POST /vitals/batch  {readings: [...]}                             -> {recorded}
GET  /vitals/patients/{patientId}?type=&from=&to=&take=
     -> { patientId, count, items: [{id,type,value,unit,source,measuredAt,deviceReading}] }
```
`type` is a `VitalType` enum. `value` is a **number**. Units by type:
`HEART_RATE` bpm · `BLOOD_PRESSURE_SYSTOLIC`/`DIASTOLIC` mmHg ·
`BLOOD_SUGAR` mg/dL · `TEMPERATURE` °C · `OXYGEN_SATURATION` % ·
`WEIGHT` kg · `SLEEP_HOURS` hours · `STEPS` steps.

## Scope
- [ ] Type picker with sensible per-type input (blood pressure takes two numbers
      and posts two readings: systolic and diastolic)
- [ ] Numeric input with range sanity checks before submitting
- [ ] "Measured at" defaulting to now, editable backwards only
- [ ] Trend screen per type using `fl_chart`: line chart, range selector
      (7 / 30 / 90 days), latest value prominent
- [ ] Draw the clinical safe band on the chart so an out-of-range point is obvious
- [ ] Mark device-sourced points differently from manual ones (`source`)
- [ ] After recording an abnormal value, tell the user an alert was raised for
      their doctor — the backend does this automatically

## Clinical thresholds (mirror of the backend rules, for the chart bands)
| Type | HIGH band | CRITICAL band |
|---|---|---|
| Heart rate | >120 or <50 | >140 or <40 |
| Blood sugar | >180 or <70 | >300 or <54 |
| Oxygen saturation | <94 | <90 |
| BP systolic | >140 or <90 | >180 |
| BP diastolic | >90 | >120 |
| Temperature | >38 | >39.5 or <35 |

## Acceptance criteria
- [ ] Recording a heart rate of 130 creates an alert visible in P-12 and on the home screen
- [ ] Recording 72 creates no alert
- [ ] The chart shows the safe band and colours out-of-range points
- [ ] Blood pressure entry creates two readings and the chart shows both series
- [ ] The time range selector re-queries with `from`/`to`
- [ ] A patient with no readings sees an empty state with a "Record your first reading" action
- [ ] Charts render in RTL without mirroring the numbers

## Gotchas
- `value` must be a number, not a string; sending `"130"` fails validation.
- The threshold table above must stay in sync with the backend's
  `src/vitals/vital-thresholds.ts`. If the backend changes, update both.
