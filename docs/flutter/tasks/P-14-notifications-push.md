# P-14 · Notifications & push

| | |
|---|---|
| **Phase** | Patient app |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | F-05 |
| **Blocks** | — |

## Goal
The in-app notification feed, and FCM push so reminders and emergencies reach the
user when the app is closed. Without this, medication reminders and the emergency
fan-out cannot be demonstrated. (BRD FR-026, FR-027)

## API
```
GET    /notifications?page=&limit=&unread=   -> Paginated<Notification>
GET    /notifications/unread-count           -> {count}
PATCH  /notifications/{id}/read
PATCH  /notifications/read-all
PATCH  /notifications/{id}/archive
POST   /notifications/tokens   {token, platform}    register FCM token
DELETE /notifications/tokens   {token}              unregister on logout
```
Notification fields: `type`, `title`, `message`, `status`
(`UNREAD` | `READ` | `ARCHIVED`), `data` (a **JSON string**), `readAt`, `createdAt`.

## Scope
- [ ] `firebase_core` + `firebase_messaging`; Android notification channel with
      high importance so emergencies actually wake the device
- [ ] Request notification permission (Android 13+ and iOS) after login, not on
      first launch
- [ ] Register the token after login; re-register on `onTokenRefresh`;
      **unregister on logout** (A-06)
- [ ] Handle all three states: foreground (in-app banner), background tap, and
      terminated (initial message)
- [ ] Deep link from `data.screen`: `appointments`, `medications`, `prescriptions`,
      `alerts`, `emergency`, `chat`, `call`, `online-visit`
- [ ] Feed screen with unread filter, mark-read, mark-all-read, archive
- [ ] Unread badge on the shell, refreshed on resume and after a push

## Acceptance criteria
- [ ] A medication reminder arrives on a **real device with the app closed** and
      opens the medications screen when tapped
- [ ] An emergency push arrives with high priority and a distinct sound
- [ ] `data` is parsed defensively — a malformed payload must not crash the app
- [ ] The unread badge matches `/notifications/unread-count`
- [ ] After logout, pushes for that user stop arriving on the device
- [ ] Notifications render in the user's chosen language

## Gotchas
- `data` values are always strings over FCM. `{"id": "7"}`, never `{"id": 7}`.
- Reminder pushes are sent by a backend cron every minute. To demo, prescribe a
  medicine whose next dose is minutes away, not hours.
- iOS needs an APNs key uploaded to Firebase or nothing arrives, silently.
