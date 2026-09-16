# X-01 · Test baseline

| | |
|---|---|
| **Phase** | Quality & release |
| **Priority** | P1 — stretch |
| **Estimate** | 1.5 days |
| **Owner** | Both |
| **Depends on** | F-08 |
| **Blocks** | — |

## Goal
Enough tests to stop the things that break silently. **Do not chase coverage** —
in six weeks that is a bad trade. Test what fails without a compile error.

## What to test, in priority order
1. **Token refresh (F-05)** — the highest-risk code in the app.
   - 401 triggers exactly one refresh and retries the original request
   - five concurrent 401s trigger exactly one refresh
   - a failed refresh clears storage and signs the user out
2. **Model parsing (F-06)** — an enum rename in the API breaks parsing at runtime
   with no compile error.
   - round-trip at least 10 real captured JSON payloads
   - an unknown enum value deserializes to `unknown` instead of throwing
3. **Date and timezone handling** — UTC to local conversion for appointment slots
   and `Appointment.date` day boundaries.
4. **Form validators** — password rules, E.164 phone, vitals ranges.
5. **One widget test per major screen** — that it renders loading, error and data
   without throwing. Use `mocktail` to stub the repositories.

## Scope
- [ ] `test/` mirroring `lib/` structure
- [ ] `mocktail` fakes for every repository
- [ ] A `test/fixtures/` folder with real JSON captured from Swagger against the
      seeded database — not hand-written JSON, which hides field-name mistakes
- [ ] A `pumpApp` helper wrapping widgets in `ProviderScope`, theme and l10n
- [ ] CI runs `flutter test` on every PR (wired in F-01)

## Acceptance criteria
- [ ] `flutter test` passes locally and in CI
- [ ] The five refresh scenarios above are covered
- [ ] At least 10 model fixtures round-trip
- [ ] At least one widget test per built screen
- [ ] A deliberately broken fixture (renamed field) makes a test fail — prove the
      tests actually catch it

## Gotchas
- Golden tests are tempting and will waste your time: they break on every font or
  padding change, and you are changing those weekly. Skip them.
- Capture fixtures **after** the backend seed, and re-capture if the API changes.
