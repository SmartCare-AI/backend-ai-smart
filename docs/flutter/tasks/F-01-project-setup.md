# F-01 · Project setup, flavors & CI

| | |
|---|---|
| **Phase** | Foundations |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | — |
| **Blocks** | Everything |

## Goal
A `shifaa-app` repo that both developers can clone, run against local **and**
production backends, and that runs `flutter analyze` + `flutter test` on every PR.

## Scope
- [ ] `flutter create shifaa_app --org net.shifaa --platforms=android,ios,web`
- [ ] Pin the Flutter version with **FVM**; commit `.fvmrc`. Both devs use the same one.
- [ ] Add the dependencies listed in [README section 3](../README.md#3-tech-stack--decided-not-up-for-debate).
- [ ] `analysis_options.yaml` includes `package:very_good_analysis/analysis_options.yaml`
- [ ] Three flavors via `--dart-define-from-file`: `dev`, `staging`, `prod`, with
      `config/dev.json` and `config/prod.json` committed (no secrets in them).
- [ ] `lib/core/config/env.dart` reading `String.fromEnvironment('API_BASE_URL')` and friends.
- [ ] Android: allow cleartext HTTP for the dev flavor only, via a
      `network_security_config.xml` permitting `10.0.2.2` and `localhost`, so the
      emulator can reach the local backend.
- [ ] `.github/workflows/ci.yml` on pull request: `flutter analyze`,
      `dart format --set-exit-if-changed .`, `flutter test`.
- [ ] App README: how to run each flavor, in five lines.
- [ ] Commit generated files (`*.g.dart`, `*.freezed.dart`) so CI does not run codegen.

## Config values
```jsonc
// config/dev.json
{ "API_BASE_URL": "http://10.0.2.2:3050/api/v1", "SOCKET_URL": "http://10.0.2.2:3050", "ENV": "dev" }
// config/prod.json
{ "API_BASE_URL": "https://artsoraback.tech/api/v1", "SOCKET_URL": "https://artsoraback.tech", "ENV": "prod" }
```
Run with `flutter run --dart-define-from-file=config/dev.json`.

> The Socket.IO URL has **no** `/api/v1` suffix. See [API-GUIDE section 1](../API-GUIDE.md#1-base-urls).

## Acceptance criteria
- [ ] Both devs run the app on Android from a clean clone in under 10 minutes
- [ ] The dev flavor reaches `GET /health` on a locally running backend
- [ ] The prod flavor reaches `GET /health` on `artsoraback.tech`
- [ ] A pull request containing a lint error fails CI
- [ ] `flutter build web` succeeds (the doctor and hospital shells need it)

## Gotchas
- The Android emulator cannot see `localhost`; it is `10.0.2.2`. The iOS simulator can.
- If the backend runs on another machine on your Wi-Fi, use its LAN IP and make
  sure the backend `CORS_ORIGINS` allows it.
