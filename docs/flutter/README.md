# SHIFAA — Flutter team plan

Everything the Flutter team needs: the plan, the conventions, the API contract,
and one file per task in [`tasks/`](tasks/).

**Read in this order:** this file → [CONVENTIONS.md](CONVENTIONS.md) →
[API-GUIDE.md](API-GUIDE.md) → your first task file.

---

## 1. The honest capacity picture — read this first

You asked for four surfaces (patient app, family portal, doctor dashboard,
hospital dashboard) with **2 developers in 6 weeks**.

| | |
|---|---|
| Raw capacity | 2 devs × 6 weeks × 5 days = **60 dev-days** |
| Realistic capacity (team new to Flutter, ~25% ramp-up) | **≈ 45 dev-days** |
| Full task list below | **63.5 dev-days** |
| P0 subset (everything marked demo-critical) | **39 dev-days** |

**The full list does not fit. The P0 subset does, with ~6 days of slack.**

So the plan is: **build every P0 task, treat P1 as stretch, and do not start P2
unless you are ahead.** P0 still gives you all four surfaces working end to end —
it just trims depth, not breadth, which is what a defense demo is judged on.

### What I recommend cutting (and why it's safe)

| Cut | Task | Why it's safe for the defense |
|---|---|---|
| Real WebRTC video calling | P-16, D-07 | The backend already stores an `OnlineVisit` with a `meetingLink`. Open it in the browser/`url_launcher`. You demo telemedicine without spending 5+ days on WebRTC plumbing. |
| Bluetooth device pairing | P-09 | `POST /devices/{id}/readings` accepts a JSON batch. Demo with a "Simulate smartwatch sync" button. The ERD entity and the whole data path are still proven. |
| Google / Apple sign-in | A-04 | Email + password already works. Social login is a nice-to-have that adds Firebase native config pain on two platforms. |
| Offline-first sync engine | — | Only the first-aid guides need to work offline (they genuinely do — see P-13). Everything else can require connectivity. |

### The one architectural decision that makes 4 surfaces possible

**Build ONE Flutter app with four role shells, not four apps.**

After login the API returns `user.role`; `go_router` redirects into the matching
shell. Auth, the API client, models, theming, localization, error handling and
the shared UI kit — roughly 40% of the work — are written once and used by all
four surfaces.

```
       ┌──────────────── shared core (F-01 … F-08) ────────────────┐
       │  API client · models · theme · i18n · routing · UI kit    │
       └───────────────────────────┬──────────────────────────────┘
            ┌──────────┬───────────┼───────────┬──────────┐
         PATIENT    CAREGIVER    DOCTOR    HOSPITAL_ADMIN
         (mobile)   (mobile)   (tablet/web)   (web)
```

Doctor and hospital shells are **responsive layouts in the same codebase**, run
with `flutter run -d chrome`. Do not create separate repos or separate projects.

---

## 2. Backend work that must happen first

Three things the Flutter team **cannot** build until the backend adds them.
They are small (about 1 day total) but they are hard blockers — see
[BACKEND-GAPS.md](BACKEND-GAPS.md) for the detail.

| # | Gap | Blocks |
|---|---|---|
| B-01 | No API to link a caregiver to a patient, or to grant/revoke consent | **All of C-01 … C-04 (Family Portal)** |
| B-02 | No API to register or promote a CAREGIVER or HOSPITAL_ADMIN account | Family portal + hospital dashboard login |
| B-03 | No "my patients" endpoint for a doctor | D-02 works around it via `GET /appointments/my`, but it is inefficient |

**Action:** get B-01 and B-02 done in week 1, in parallel with Flutter
foundations. Otherwise weeks 5–6 stall.

---

## 3. Tech stack — decided, not up for debate

Picking these now saves a week of arguing. All are mainstream and well
documented, which matters for a team learning Flutter.

| Concern | Package | Why |
|---|---|---|
| Flutter/Dart version | pin current stable with **FVM**, commit `.fvmrc` | Everyone compiles the same thing |
| State management | **flutter_riverpod** + **riverpod_annotation** | Less boilerplate than Bloc; easier to learn |
| Routing | **go_router** | Declarative, and its `redirect` is how role shells work |
| HTTP | **dio** | Interceptors are how token refresh is done (F-05) |
| Models | **freezed** + **json_serializable** | Immutable models, `copyWith`, exhaustive enums |
| Secure token storage | **flutter_secure_storage** | Refresh tokens must not sit in SharedPreferences |
| Offline cache | **hive_ce** | First-aid guides offline (P-13) |
| Charts | **fl_chart** | Vitals trends, hospital dashboard |
| Real-time | **socket_io_client** | Matches the backend's Socket.IO gateway |
| Push | **firebase_core** + **firebase_messaging** | Backend already sends via FCM |
| Images | **cached_network_image**, **image_picker** | Avatars, documents, radiology |
| Lint | **very_good_analysis** | Strict defaults, no bikeshedding |
| Tests | **flutter_test** + **mocktail** | Enough for the DoD in CONVENTIONS.md |

---

## 4. Six-week plan

Two tracks. **Dev A = Core & Clinical. Dev B = Patient & Care.**
Week 1 both devs pair on foundations — do not split while everyone is still
learning Flutter.

| Week | Dev A | Dev B | Milestone |
|---|---|---|---|
| **1** | F-01, F-02, F-05, F-07 | F-03, F-04, F-06, F-08 | App runs, hits `/health`, themed, ar/en |
| **2** | A-01, A-02, A-03 | A-05, P-01, P-03 | **M1: you can register, verify, log in, see your profile** |
| **3** | D-01, D-02 | P-04, P-05, P-02 | **M2: booking works; AI triage demo-ready** |
| **4** | D-03, D-05, P-14 | P-08, P-10 | **M3: doctor can run a visit and prescribe; reminders arrive** |
| **5** | P-11, P-12, D-06 | P-13, C-01, C-02 | **M4: emergency + family portal** |
| **6** | X-04, buffer for overflow | H-01, X-02 | **M5: hospital dashboard, demo rehearsal, builds** |
| **6** | X-03 together — rehearse the demo twice | | |

Week 6 is deliberately light. Something always slips, and the demo rehearsal
(X-03) is worth more marks than one more half-built screen.

**If you fall behind,** drop the P1 tasks scheduled above in this order and keep
the P0 ones: A-03, P-11, P-12, D-06, X-02, then C-02. Do not drop X-03 or X-04.

**Every Friday:** merge to `develop`, run the app on a real Android device, and
walk one end-to-end journey. A milestone that only works on the emulator is not
done.

---

## 5. Task board

Priority: **P0** = demo-critical, build it · **P1** = stretch · **P2** = only if ahead.

### Phase F — Foundations · 9.5d · all P0

| ID | Task | Est | Owner | Depends on |
|---|---|---|---|---|
| [F-01](tasks/F-01-project-setup.md) | Project setup, flavors & CI | 1d | A | — |
| [F-02](tasks/F-02-architecture.md) | App architecture & state management | 1d | A | F-01 |
| [F-03](tasks/F-03-design-system.md) | Design system & theming | 1.5d | B | F-01 |
| [F-04](tasks/F-04-localization.md) | Localization (ar/en) & RTL | 1d | B | F-01 |
| [F-05](tasks/F-05-api-client.md) | API client, errors & auth interceptor | 1.5d | A | F-02 |
| [F-06](tasks/F-06-models-enums.md) | API models & enums | 1.5d | B | F-02 |
| [F-07](tasks/F-07-routing-shells.md) | Routing & role-based shells | 1d | A | F-02 |
| [F-08](tasks/F-08-ui-kit.md) | Shared UI kit | 1d | B | F-03 |

### Phase A — Auth & identity · 7d

| ID | Task | Est | Pri | Owner | Depends on |
|---|---|---|---|---|---|
| [A-01](tasks/A-01-register-verify.md) | Register + email verification | 1.5d | **P0** | A | F-05, F-08 |
| [A-02](tasks/A-02-login-tokens.md) | Login, token storage & refresh | 1.5d | **P0** | A | F-05 |
| [A-03](tasks/A-03-password-reset.md) | Forgot & reset password | 1d | P1 | A | A-01 |
| [A-04](tasks/A-04-social-signin.md) | Google / Apple sign-in | 1d | P2 | A | A-02 |
| [A-05](tasks/A-05-profile.md) | Profile view & edit (role-aware) | 1.5d | **P0** | B | A-02, F-06 |
| [A-06](tasks/A-06-password-logout.md) | Change password, logout & sessions | 0.5d | P1 | B | A-02 |

### Phase P — Patient app · 24.5d

| ID | Task | Est | Pri | Owner | Depends on |
|---|---|---|---|---|---|
| [P-01](tasks/P-01-patient-home.md) | Patient home | 1d | **P0** | B | F-07, A-02 |
| [P-02](tasks/P-02-ai-triage.md) | AI symptom triage | 2d | **P0** | B | P-01 |
| [P-03](tasks/P-03-browse-doctors.md) | Browse hospitals & doctors | 1d | **P0** | B | F-08 |
| [P-04](tasks/P-04-book-appointment.md) | Book an appointment | 2d | **P0** | B | P-03 |
| [P-05](tasks/P-05-my-appointments.md) | My appointments | 1d | **P0** | B | P-04 |
| [P-06](tasks/P-06-visit-history.md) | Visit history & full record | 1.5d | P1 | A | P-05 |
| [P-07](tasks/P-07-documents.md) | Medical documents library | 1.5d | P1 | A | F-08 |
| [P-08](tasks/P-08-vitals.md) | Vitals entry & charts | 2d | **P0** | B | F-08 |
| [P-09](tasks/P-09-devices.md) | Devices & readings | 1.5d | P2 | A | P-08 |
| [P-10](tasks/P-10-medications.md) | Medication tracking & adherence | 2d | **P0** | B | F-08 |
| [P-11](tasks/P-11-prescriptions.md) | Prescriptions & treatment plans | 1d | P1 | A | P-10 |
| [P-12](tasks/P-12-alerts.md) | Alerts feed | 1d | P1 | A | F-08 |
| [P-13](tasks/P-13-emergency.md) | Emergency hub (SOS, contacts, first aid) | 2d | **P0** | B | F-08 |
| [P-14](tasks/P-14-notifications-push.md) | Notifications & push | 1.5d | **P0** | A | F-05 |
| [P-15](tasks/P-15-chat.md) | Chat (Socket.IO) | 2d | P1 | A | A-02 |
| [P-16](tasks/P-16-online-visit.md) | Online visit (telemedicine) | 1.5d | P2 | A | P-05 |

### Phase C — Family / Caregiver portal · 4d · **blocked by B-01, B-02**

| ID | Task | Est | Pri | Owner | Depends on |
|---|---|---|---|---|---|
| [C-01](tasks/C-01-caregiver-shell.md) | Caregiver shell & linked patients | 1d | P1 | B | F-07, B-01 |
| [C-02](tasks/C-02-patient-monitoring.md) | Patient monitoring | 1.5d | P1 | B | C-01, P-08, P-10 |
| [C-03](tasks/C-03-emergency-response.md) | Emergency response | 1d | P1 | B | C-01, P-13 |
| [C-04](tasks/C-04-manage-appointments.md) | Manage appointments for a patient | 0.5d | P2 | B | C-01, P-04 |

### Phase D — Doctor dashboard · 10.5d

| ID | Task | Est | Pri | Owner | Depends on |
|---|---|---|---|---|---|
| [D-01](tasks/D-01-doctor-shell.md) | Doctor shell & today's schedule | 1.5d | **P0** | A | F-07 |
| [D-02](tasks/D-02-patient-record.md) | My patients & unified record | 2d | **P0** | A | D-01 |
| [D-03](tasks/D-03-run-visit.md) | Run a visit (open, diagnose, close) | 1.5d | **P0** | A | D-02 |
| [D-04](tasks/D-04-tests-imaging.md) | Tests, results & imaging | 1.5d | P1 | A | D-03 |
| [D-05](tasks/D-05-prescribe.md) | Treatment plan & prescription | 2d | **P0** | A | D-03 |
| [D-06](tasks/D-06-alert-center.md) | Smart Alert Center | 1d | P1 | A | D-01 |
| [D-07](tasks/D-07-online-visit-control.md) | Online visit control | 1d | P2 | A | D-01 |

### Phase H — Hospital dashboard · 3.5d

| ID | Task | Est | Pri | Owner | Depends on |
|---|---|---|---|---|---|
| [H-01](tasks/H-01-overview.md) | Hospital shell & overview KPIs | 1.5d | **P0** | B | F-07, B-02 |
| [H-02](tasks/H-02-doctor-load.md) | Doctor load & department adherence | 1d | P1 | B | H-01 |
| [H-03](tasks/H-03-quality.md) | Readmissions & alert quality | 1d | P2 | B | H-01 |

### Phase X — Quality & release · 4.5d

| ID | Task | Est | Pri | Owner | Depends on |
|---|---|---|---|---|---|
| [X-01](tasks/X-01-testing.md) | Test baseline | 1.5d | P1 | both | F-08 |
| [X-02](tasks/X-02-rtl-a11y-qa.md) | RTL, accessibility & responsive QA | 1d | P1 | B | F-04 |
| [X-03](tasks/X-03-demo-script.md) | Demo dataset & defense script | 1d | **P0** | both | M4 |
| [X-04](tasks/X-04-release-builds.md) | Release builds (Android + Web) | 1d | **P0** | A | F-01 |

---

## 6. How to work the board

1. **One task = one GitHub issue = one branch = one PR.** Branch name is the
   task id: `feat/P-04-book-appointment`.
2. **Never start a task whose dependencies are not merged.** The `Depends on`
   column is not a suggestion — the API client and models are shared code.
3. Move the task file's checkboxes as you go; the PR description links the task
   file.
4. If a task takes more than 1.5× its estimate, stop and raise it at standup.
   That is data, not failure — re-plan instead of silently slipping.
5. **Definition of Done is in [CONVENTIONS.md](CONVENTIONS.md#definition-of-done)
   and applies to every task.** A task is not done because the screen renders.
