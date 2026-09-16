# F-04 · Localization (ar/en) & RTL

| | |
|---|---|
| **Phase** | Foundations |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | F-01 |
| **Blocks** | Every screen |

## Goal
Arabic and English from day one, with correct RTL. **This is not optional.** The
backend AI triage engine matches Arabic symptom keywords, so an English-only app
cannot demonstrate its own AI module.

## Scope
- [ ] Add `flutter_localizations` and `intl`; create `l10n.yaml`,
      `lib/l10n/app_en.arb` and `lib/l10n/app_ar.arb`.
- [ ] `supportedLocales: [Locale('en'), Locale('ar')]` with the delegates wired.
- [ ] A language switcher in settings, persisted with `shared_preferences`.
- [ ] Default to the device locale on first launch.
- [ ] Localize **enum labels** with one helper per enum, for example
      `context.l10n.appointmentStatus(AppointmentStatus.pending)`.
- [ ] Format dates and numbers through `intl` using the active locale.
- [ ] Replace every `EdgeInsets.only(left:)` with `EdgeInsetsDirectional.only(start:)`.
- [ ] Replace `Alignment.centerLeft` with `AlignmentDirectional.centerStart`.
- [ ] Make directional icons (back arrow, chevrons) flip.

## Acceptance criteria
- [ ] Switching to Arabic flips the whole app to RTL without a restart
- [ ] No English string is visible in Arabic mode on any built screen
- [ ] Dates and numbers respect the locale
- [ ] The F-03 theme gallery looks correct in both directions
- [ ] Arabic typed into a text field renders and submits correctly. Verify against
      the real AI endpoint once P-02 exists: sending the Arabic phrase for
      "chest pain" must come back as `CRITICAL` with a red-flag reason.

## Gotchas
- Directionality bugs almost always come from hard-coded `left` / `right`. Grep
  for them before every PR.
- Mixed Arabic, Latin and digits in one line is where layouts look broken. Test that case.
