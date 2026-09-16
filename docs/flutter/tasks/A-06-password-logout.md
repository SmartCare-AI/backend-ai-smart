# A-06 · Change password, logout & sessions

| | |
|---|---|
| **Phase** | Auth & identity |
| **Priority** | P1 — stretch |
| **Estimate** | 0.5 day |
| **Owner** | Dev B |
| **Depends on** | A-02 |
| **Blocks** | — |

## Goal
Change the password from inside the app, and log out cleanly on every device.

## API
```
PATCH /users/me/password   {currentPassword, newPassword}  -> {message}
POST  /auth/logout         {refreshToken}                  -> {message}
DELETE /notifications/tokens {token}                       -> {message}
```

## Scope
- [ ] Change-password form: current, new, confirm
- [ ] After success, show "other devices were signed out" — the backend revokes
      every other refresh token — and keep the current session alive
- [ ] Logout flow in this exact order:
      unregister the FCM token, `POST /auth/logout`, clear secure storage,
      invalidate providers, route to login
- [ ] Hide the current-password field for social-only accounts (`provider != EMAIL`)

## Acceptance criteria
- [ ] A wrong current password shows a 401 message and does not clear the session
- [ ] Setting the new password equal to the current one shows the backend's 400 message
- [ ] After changing the password, a second device is logged out on its next call
- [ ] After logout the device stops receiving that user's push notifications
- [ ] Logging out while offline still clears local state and routes to login

## Gotchas
- Forgetting to unregister the FCM token means the **next** user of that phone
  receives the previous user's medical alerts. This is a privacy bug, not a
  cosmetic one. It is the single most important line in this task.
