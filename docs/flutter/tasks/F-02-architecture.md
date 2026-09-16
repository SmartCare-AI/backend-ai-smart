# F-02 · App architecture & state management

| | |
|---|---|
| **Phase** | Foundations |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | F-01 |
| **Blocks** | F-05, F-06, F-07 and every feature |

## Goal
The folder skeleton and the single data-flow rule everyone follows, so two
people can work in parallel without merge pain.

## Scope
- [ ] Create the folder tree from [CONVENTIONS section 2](../CONVENTIONS.md#2-folder-structure);
      empty folders with a `.gitkeep` are fine.
- [ ] Wire `ProviderScope` in `main.dart`.
- [ ] `lib/app/app.dart` builds `MaterialApp.router` reading theme (F-03),
      locale (F-04) and router (F-07).
- [ ] Write **one reference vertical slice** the other dev copies:
      `features/health/` with `HealthRepository.check()`, a `healthProvider`,
      and a `HealthScreen` that renders the `/health` response.
- [ ] Document the rule in the app README: widget to provider to repository to API client.

## The data-flow rule
```
Widget        watches a provider, renders AsyncValue (loading / error / data)
  |
Provider      orchestrates; owns no HTTP
  |
Repository    the ONLY place dio is called; throws a typed ApiException
  |
ApiClient     dio plus interceptors (F-05)
```

## Acceptance criteria
- [ ] `HealthScreen` shows the backend `/health` payload on a real device
- [ ] It renders a spinner while loading, and an error with Retry when the backend is stopped
- [ ] The other dev can say where a new screen's files go without asking
- [ ] No `dio` import exists anywhere under `features/*/presentation/`

## Gotchas
- Resist adding a "clean architecture" usecase layer. Three layers is right for a
  six-week project; five will cost you a week in ceremony.
