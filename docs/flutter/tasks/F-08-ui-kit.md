# F-08 · Shared UI kit

| | |
|---|---|
| **Phase** | Foundations |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | F-03 |
| **Blocks** | Every feature screen |

## Goal
The ten widgets every screen needs, written once. Without this, two devs build
two different empty states and the app looks stitched together.

## Scope
- [ ] `AsyncValueWidget<T>` — renders loading / error+retry / data from an
      `AsyncValue`. Every screen uses it; nobody writes `if (isLoading)` again.
- [ ] `AppScaffold` — title, optional back button, consistent padding, safe area.
- [ ] `EmptyState` — icon, message, optional action button.
- [ ] `ErrorView` — localized message plus a Retry callback.
- [ ] `LoadingSkeleton` — shimmer placeholders for list and card layouts.
- [ ] `PaginatedListView<T>` — infinite scroll over `Paginated<T>`, handling
      `page`/`limit`, end-of-list, pull to refresh and inline error.
- [ ] `AppTextField` — label, hint, error, obscure toggle, keyboard type.
- [ ] `AppButton` — primary / secondary / danger, with a built-in loading state
      that disables the button (this alone prevents most double-submit bugs).
- [ ] `SeverityChip` — takes a `RiskLevel` or `Severity` and renders the F-03 colour.
- [ ] `StatusBadge` — generic enum badge used for appointment, visit and order statuses.
- [ ] `ConfirmDialog` — used for cancel, delete and SOS confirmations.
- [ ] `AvatarWidget` — network image with initials fallback from `fullName`.

## Acceptance criteria
- [ ] All widgets appear in the `/debug/theme` gallery, in both themes and both locales
- [ ] `PaginatedListView` is proven against a real paginated endpoint with more
      than 20 rows (seed extra appointments if needed)
- [ ] `AppButton` in its loading state cannot be tapped twice
- [ ] Widget tests for `AsyncValueWidget` (all three states) and `PaginatedListView`
- [ ] No feature screen defines its own spinner, empty state or error view

## Gotchas
- Build this **before** the feature screens, not after. Retrofitting it in week 4
  means touching every screen again.
