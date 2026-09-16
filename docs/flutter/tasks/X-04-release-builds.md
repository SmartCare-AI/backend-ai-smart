# X-04 · Release builds (Android + Web)

| | |
|---|---|
| **Phase** | Quality & release |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | F-01 |
| **Blocks** | — |

## Goal
A signed Android APK anyone can install, and a deployed web build for the doctor
and hospital dashboards. Do a first release build in **week 2**, not week 6 —
release builds break in ways debug builds never do.

## Scope
- [ ] Android release keystore, kept out of git; `key.properties` gitignored, with
      a documented backup location
- [ ] `flutter build apk --release --dart-define-from-file=config/prod.json`
- [ ] App icon and splash screen (`flutter_launcher_icons`, `flutter_native_splash`)
      in both locales
- [ ] App name and package id finalized (`net.shifaa.app`)
- [ ] ProGuard/R8 rules if minification strips anything (Firebase usually needs none)
- [ ] `flutter build web --release --dart-define-from-file=config/prod.json`
- [ ] Deploy the web build — Firebase Hosting or a static path behind the existing
      nginx. Coordinate with whoever owns `artsoraback.tech`.
- [ ] Verify the backend `CORS_ORIGINS` includes the web build's origin, or every
      request from the dashboard will fail
- [ ] Release notes and an install guide for the examiners

## Acceptance criteria
- [ ] The release APK installs on a clean device and logs in against production
- [ ] Push notifications work in the **release** build (a common failure: the
      release SHA-1 is not registered in Firebase)
- [ ] The web build loads over HTTPS and the doctor dashboard is fully usable
- [ ] No debug banner, no console logging in release
- [ ] The app icon and splash look right on a real device
- [ ] APK size is under about 50 MB
- [ ] A first release build was produced in week 2 and re-tested each week after

## Gotchas
- **Firebase release SHA-1 is the classic week-6 disaster.** Debug and release
  builds have different signing certificates; both must be registered or Google
  sign-in and sometimes FCM fail only in release.
- Flutter web needs CORS from the backend. Add the hosting origin to
  `CORS_ORIGINS` before you test, not after.
- Flutter web's first load is slow. Enable the service worker and warn the
  examiners rather than looking like the app hung.
