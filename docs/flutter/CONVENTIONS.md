# Flutter team conventions

Non-negotiables so two people can work in one repo without stepping on each
other. Agree once, then stop debating it.

---

## 1. Repository & branching

Separate repo: `shifaa-app`. The backend repo stays backend-only.

```
main       always releasable, tagged for each milestone
develop    integration branch — PRs target this
feat/<ID>-<slug>    one task, e.g. feat/P-04-book-appointment
fix/<ID>-<slug>
```

- One task = one issue = one branch = one PR. No "while I was in there" changes.
- PR title: `P-04 Book an appointment`. Body links the task file and ticks its
  acceptance criteria.
- **The other dev reviews every PR.** With two people this is the only safety
  net you have.
- Squash-merge. Delete the branch.

Commit messages: `feat(appointments): add slot picker`, `fix(auth): serialize token refresh`.

---

## 2. Folder structure

Feature-first, not layer-first. A feature owns its screens, widgets, providers
and repository, so two devs rarely touch the same files.

```
lib/
├── main.dart
├── app/
│   ├── app.dart                 MaterialApp.router, theme, locale
│   ├── router.dart              go_router + role redirect (F-07)
│   └── shells/                  patient_shell.dart, doctor_shell.dart, ...
├── core/
│   ├── api/                     dio client, interceptors, ApiException (F-05)
│   ├── config/                  Env, flavors (F-01)
│   ├── errors/                  failure types + message mapping
│   ├── storage/                 secure storage, hive boxes
│   └── utils/                   formatters, date helpers, validators
├── models/                      freezed models + enums, shared (F-06)
├── features/
│   ├── auth/         { data/ presentation/ providers/ }
│   ├── appointments/
│   ├── vitals/
│   ├── medications/
│   ├── emergency/
│   ├── ...
├── shared/
│   ├── widgets/                 UI kit (F-08)
│   └── theme/                   tokens, ThemeData (F-03)
└── l10n/                        app_en.arb, app_ar.arb (F-04)
```

Inside a feature:

```
features/appointments/
├── data/appointments_repository.dart      the only place dio is called
├── providers/appointments_providers.dart  riverpod providers
└── presentation/
    ├── book_appointment_screen.dart
    └── widgets/slot_picker.dart
```

**Rule: widgets never call `dio` and never call a repository directly.** Widget →
provider → repository → API client. This is what makes the code testable.

---

## 3. Code rules

- `very_good_analysis` in `analysis_options.yaml`. **Zero warnings on `develop`.**
- No `dynamic`. No `!` on a nullable unless the line above proves it is non-null.
- All models are `freezed` + `json_serializable`. Never hand-write `fromJson`.
- All enums come from F-06 with `@JsonValue`. Never compare against a raw string.
- Every user-facing string goes through `l10n`. A hard-coded English string in a
  PR is a review block — you support Arabic (F-04).
- `const` constructors everywhere the linter asks.
- Files: `snake_case.dart`. Classes: `PascalCase`. Providers: `camelCaseProvider`.
- Max ~300 lines per file. Longer means it wants splitting.

---

## 4. State & error handling

- One provider per screen's state. Use `AsyncValue` — it gives you
  loading/error/data for free; render it with the `AsyncValueWidget` from F-08.
- Never `try/catch` in a widget. Repositories throw typed `ApiException`;
  providers turn that into `AsyncError`; the widget renders it.
- Never show a raw exception string to a user. Map to a localized message (F-05).
- Loading states are **skeletons or spinners, never a blank screen**.
- Every list screen handles four states: loading · empty · error+retry · data.

---

## 5. Definition of Done

A task is done when **all** of these are true. Copy this into the PR body.

- [ ] Every acceptance criterion in the task file is ticked
- [ ] `flutter analyze` is clean (zero issues)
- [ ] `dart format .` applied
- [ ] Strings localized in **both** `app_en.arb` and `app_ar.arb`
- [ ] Screen checked in **Arabic/RTL** as well as English
- [ ] Loading, empty and error states all implemented and seen working
- [ ] Tested on a **real Android device**, not only the emulator
- [ ] Doctor/hospital screens also checked at desktop width in Chrome
- [ ] At least one test: a widget test for a screen, or a unit test for a repository
- [ ] No `print()`, no commented-out code, no `TODO` without an issue number
- [ ] Reviewed and approved by the other developer

---

## 6. Testing expectations

You will not reach high coverage in 6 weeks, and chasing it would be a mistake.
Test what breaks silently:

| Test what | Why |
|---|---|
| Repository JSON parsing | An enum rename in the API breaks parsing with no compile error |
| Token refresh logic (F-05) | The single highest-risk piece of the app |
| Date/time conversion | UTC↔local bugs are invisible until the demo |
| Form validators | Cheap to test, annoying to debug |
| One widget test per major screen | Catches null-render crashes |

Run `flutter test` in CI on every PR (F-01).

---

## 7. Working agreements

- **Daily 15-minute standup.** What I finished, what I'm on, what's blocking me.
- **Ask after 30 minutes stuck.** Two people cannot afford a silent lost day.
- **Friday integration.** Merge `develop`, install on a real phone, walk one full
  user journey end to end. Fix what breaks before the weekend.
- **Do not refactor shared code (`core/`, `models/`, `shared/`) without telling
  the other dev.** That is where merge conflicts come from.
- The backend is already built and documented — **when the API and your
  assumption disagree, check Swagger before writing a workaround.**
- If an endpoint you need does not exist, raise it the same day. Do not fake it
  with local state; see [BACKEND-GAPS.md](BACKEND-GAPS.md).
