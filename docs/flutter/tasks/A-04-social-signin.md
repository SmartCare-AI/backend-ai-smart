# A-04 · Google / Apple sign-in

| | |
|---|---|
| **Phase** | Auth & identity |
| **Priority** | P2 — only if ahead |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | A-02 |
| **Blocks** | — |

> **Recommended cut.** Email and password already works. This adds native
> Firebase configuration on two platforms for no new capability in the demo.
> Do it only if you reach week 6 ahead of schedule.

## Goal
Sign in with Google (and Apple on iOS) through Firebase, exchanging the Firebase
ID token for SHIFAA tokens.

## API
```
POST /auth/social/firebase  {idToken}  -> AuthResponse
```
The backend verifies the token with the Firebase Admin SDK, links it to an
existing account with the same email or provisions a new PATIENT, and returns the
normal token pair.

## Scope
- [ ] `firebase_core` + `firebase_auth` + `google_sign_in` (+ `sign_in_with_apple` on iOS)
- [ ] Register the Android SHA-1 and SHA-256 fingerprints in the Firebase console
- [ ] `google-services.json` and `GoogleService-Info.plist` in place
- [ ] Get the Firebase ID token, post it, then reuse the A-02 session handling
- [ ] Buttons on the login and register screens

## Acceptance criteria
- [ ] Google sign-in works on a real Android device (it will not work on an
      emulator without Play Services)
- [ ] Signing in with Google using an email that already has a password account
      links to that account rather than creating a second one
- [ ] A social account has no password: the change-password screen (A-06) hides
      the current-password field and the backend's 400 is handled
- [ ] Apple sign-in works on a real iOS device, if iOS is in scope

## Gotchas
- If the backend has no `FIREBASE_*` env vars set, this endpoint returns 503 with
  a clear message. Check the backend is configured before debugging the client.
- Apple requires the "Sign in with Apple" capability and a paid developer account.
