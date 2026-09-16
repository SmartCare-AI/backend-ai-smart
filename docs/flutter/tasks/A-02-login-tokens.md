# A-02 · Login, token storage & refresh

| | |
|---|---|
| **Phase** | Auth & identity |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | F-05 |
| **Blocks** | Everything behind login |

## Goal
Log in, stay logged in across app restarts, and never show the user a token error.

## API
```
POST /auth/login    {email, password}   -> AuthResponse
POST /auth/refresh  {refreshToken}      -> AuthResponse   (rotates the pair)
POST /auth/logout   {refreshToken}      -> {message}
GET  /users/me                          -> the user with its role profile
```

## Scope
- [ ] Login screen: email, password, show/hide, "forgot password" link
- [ ] `AuthRepository` and an `authProvider` exposing
      `AuthState.unknown | unauthenticated | authenticated(user)`
- [ ] Persist `accessToken` and `refreshToken` in **`flutter_secure_storage`**
- [ ] Cache the `user` (including `patientProfile.id` / `doctorProfile.id`) in memory,
      and re-fetch `GET /users/me` on every cold start
- [ ] Splash screen: read storage, call `/users/me`, then route by role (F-07)
- [ ] Logout: call `POST /auth/logout`, **unregister the FCM token** (P-14),
      clear secure storage, reset all providers, route to login
- [ ] Surface the three terminal states with distinct messages:
      wrong credentials (401), email not verified (403), account deactivated or
      suspended (403)

## Acceptance criteria
- [ ] Login as each seeded account routes to the correct shell
- [ ] Force-closing and reopening the app keeps the user logged in
- [ ] Logging in as an unverified account routes to the OTP screen from A-01,
      not to a dead error
- [ ] After logout, the back button cannot reach a signed-in screen
- [ ] The refresh token in storage changes after a silent refresh (it is rotated)
- [ ] Nothing about tokens is ever written with `print` or shown in the UI
- [ ] Logging in on device B does **not** log out device A (sessions are independent)

## Gotchas
- `GET /users/me` is the only reliable source of `patientProfile.id`. Nearly every
  clinical endpoint needs it — cache it at login and expose it from `authProvider`.
- Do not store tokens in `shared_preferences`. On a rooted device they are plain text.
