# F-05 · API client, errors & auth interceptor

| | |
|---|---|
| **Phase** | Foundations |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev A |
| **Depends on** | F-02 |
| **Blocks** | Every feature that talks to the backend |

## Goal
One configured `dio` instance that attaches the access token, transparently
refreshes it when it expires, and turns backend errors into typed, localizable
failures. **This is the highest-risk file in the app** — get it right once.

## Scope
- [ ] `core/api/api_client.dart` with `baseUrl` from `Env`, sensible timeouts
      (connect 15s, receive 20s).
- [ ] Request interceptor: attach `Authorization: Bearer <accessToken>` and
      `X-Platform: android|ios|web`.
- [ ] **Response interceptor with serialized refresh** (see below).
- [ ] `core/api/api_exception.dart`: a sealed/typed failure with
      `NetworkFailure`, `UnauthorizedFailure`, `ForbiddenFailure`,
      `NotFoundFailure`, `ValidationFailure(List<String> messages)`,
      `ConflictFailure`, `RateLimitFailure`, `ServerFailure`.
- [ ] Parse the NestJS error body: `{statusCode, message, error}` where `message`
      is **either a String or a List<String>**. Handle both or you will crash on
      the first validation error.
- [ ] Map failures to localized messages in one place; never show a raw exception.
- [ ] A pretty logger interceptor enabled only when `Env.isDev`.

## Serialized token refresh — the rule that matters
```
on 401 (and the failed request was not /auth/refresh):
  if a refresh is already in flight -> await that same Future
  else -> start one, store the Future, await it
  on success  -> save the NEW token pair, retry the original request once
  on failure  -> wipe tokens, emit a global "logged out" event, route to login
```
Refresh tokens are **rotated and single-use**. If five requests 401 at once and
you fire five refreshes, four fail and the user is logged out for no reason.

## Acceptance criteria
- [ ] With a deliberately expired access token, a protected call succeeds after a
      silent refresh and the user sees no interruption
- [ ] Firing five protected calls at once with an expired token triggers
      **exactly one** `POST /auth/refresh` (verify in the dev logger)
- [ ] With an invalid refresh token, the app clears storage and routes to login
- [ ] With the backend stopped, the UI shows "no connection", not a red screen
- [ ] A 400 with a validation array shows the first message, readable and localized
- [ ] Unit tests cover: 401 retry, concurrent 401s, refresh failure, both error shapes

## Reference
[API-GUIDE section 2](../API-GUIDE.md#2-authentication) and
[section 5](../API-GUIDE.md#5-conventions-across-every-endpoint).
