# A-01 · Register + email verification

| | |
|---|---|
| **Phase** | Auth & identity |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | F-05, F-08 |
| **Blocks** | A-03, everything behind login |

## Goal
A new patient can create an account, receive a 6-digit code by email, verify it,
and land in the app already signed in.

## User story
> As a new patient I register with my name, email and password, type the code I
> received, and I am taken straight into the app. (BRD FR-001, AC-001)

## API
```
POST /auth/register          {email, password, firstName, lastName, phone?}  -> {message}
POST /auth/verify-email      {email, code}                                   -> AuthResponse
POST /auth/resend-verification {email}                                       -> {message}
```
`password`: min 8 chars, at least one letter and one digit (the backend rejects
otherwise with a 400). `phone` must be E.164, e.g. `+201001234567`.

Verification returns the full `AuthResponse` — **the user is logged in at this
point**. Do not send them back to the login screen.

## Scope
- [ ] Register screen: first name, last name, email, password, confirm password, optional phone
- [ ] Client-side validation mirroring the backend rules, with localized messages
- [ ] Password strength hint and a show/hide toggle
- [ ] OTP screen: 6 boxes or a single field, auto-advance, paste support
- [ ] Resend with a 60-second cooldown timer (the backend rate-limits this)
- [ ] On success, store the token pair (A-02 storage) and route to the patient home
- [ ] "Already have an account? Log in" link

## Acceptance criteria
- [ ] Registering with an existing **verified** email shows the 409 conflict message
- [ ] Registering with an existing **unverified** email works and re-sends a code
      (the backend overwrites the previous attempt) — do not treat it as an error
- [ ] A wrong code shows "Incorrect code" and lets the user retry
- [ ] After 5 wrong attempts the backend invalidates the code; the UI tells the
      user to request a new one
- [ ] An expired code (10 minutes) shows the expiry message with a Resend action
- [ ] Resend is disabled during the cooldown
- [ ] The whole flow works in Arabic with RTL input

## Gotchas
- The backend rate-limits auth endpoints to roughly 3–5 requests per minute. A
  429 is not a bug; show "please wait a moment" rather than retrying.
- If the backend has no SMTP configured, the code is printed to the server
  console. Tell the team so they do not think email is broken in dev.
