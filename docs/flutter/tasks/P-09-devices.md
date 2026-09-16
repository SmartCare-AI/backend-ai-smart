# P-09 · Devices & readings

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | P2 — only if ahead |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | P-08 |
| **Blocks** | — |

> **Recommended scope cut: do not integrate real Bluetooth.** Ship the pairing UI
> plus a "Simulate sync" action that posts a realistic batch. That proves the
> whole ERD path (Device to DeviceReading to VitalSign to Alert) in half a day
> instead of a week of BLE debugging.

## Goal
Pair a wearable, sync readings, and see the raw data it produced. (BRD FR-021, FR-022)

## API
```
POST   /devices                 {type, name, manufacturer?, serialNumber?}   -> Device
GET    /devices/my
GET    /devices/patients/{patientId}
PATCH  /devices/{id}            {name?, status?, ...}
DELETE /devices/{id}            -> marks DISCONNECTED, keeps history
POST   /devices/{id}/readings   {readings:[{type,value,unit?,measuredAt?}], promoteToVitals?}
       -> { deviceId, received, promotedToVitals }
GET    /devices/{id}/readings?type=&from=&to=&page=&limit=
```
Up to 200 readings per sync, rate limited to 20 syncs per minute. With
`promoteToVitals` left at its default (`true`) each reading is also written into
the clinical vitals stream and threshold alerts fire — at most one alert per
vital type per sync.

## Scope
- [ ] Device list with type icon, status chip, `lastSync` relative time
- [ ] Pair flow: pick `DeviceType`, name it, optional manufacturer and serial
- [ ] Re-pairing the same serial number reconnects rather than duplicating — the
      backend handles it, make the UI say "reconnected"
- [ ] **Simulate sync** action generating 20–50 plausible readings over the last
      24 hours for the device type, then posting them in one batch
- [ ] Raw readings list per device, paginated
- [ ] Disconnect with confirmation, explaining that history is kept

## Acceptance criteria
- [ ] Pairing a device with a serial already owned by another patient shows the 409 message
- [ ] A simulated sync reports how many readings were promoted to vitals
- [ ] Readings from a sync appear in the P-08 trend chart marked as `DEVICE`
- [ ] A sync containing an out-of-range value raises exactly one alert for that type
- [ ] `lastSync` updates after a sync
- [ ] A disconnected device cannot sync, and the UI says why

## Gotchas
- A reading's patient comes from the device (BR-009); there is no `patientId` on
  a reading. Do not try to send one.
- If you do attempt real BLE later, keep this simulate path — it is how you demo
  when the hardware refuses to pair on stage.
