# A-03 · Forgot & reset password

| | |
|---|---|
| **Phase** | Auth & identity |
| **Priority** | P1 — stretch |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | A-01 |
| **Blocks** | — |

## Goal
A user who forgot their password can reset it with an emailed code.

## API
```
POST /auth/forgot-password  {email}                      -> {message}
POST /auth/reset-password   {email, code, newPassword}   -> {message}
```

## Scope
- [ ] Forgot-password screen: email field, submit
- [ ] Reset screen: 6-digit code, new password, confirm password
- [ ] Reuse the OTP widget from A-01
- [ ] On success show a confirmation and route to login (the backend revokes all
      sessions, so the user must sign in again)

## Acceptance criteria
- [ ] The success message is **identical** whether or not the email exists — the
      backend does this deliberately to prevent account enumeration. Do not "fix" it.
- [ ] A wrong or expired code shows the retry message
- [ ] The new password is validated client-side with the same rules as registration
- [ ] After a reset, the old password no longer works and the new one does
- [ ] A social-only account (Google/Apple, no password) still returns the generic
      message; nothing crashes

## Gotchas
- Resetting the password also marks the email verified on the backend. An
  unverified user who resets can then log in normally.
