# F-03 · Design system & theming

| | |
|---|---|
| **Phase** | Foundations |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1.5 days |
| **Owner** | Dev B |
| **Depends on** | F-01 |
| **Blocks** | F-08 and every screen |

## Goal
One theme, one spacing scale, one set of colours, so nobody hard-codes a hex
value or an `EdgeInsets.all(13)` again.

## Scope
- [ ] `shared/theme/app_colors.dart` with semantic names only: `primary`,
      `surface`, `danger`, `warning`, `success`, `onSurfaceMuted`. No `blue500`.
- [ ] A clinical severity palette used by alerts, triage and vitals so severity
      reads identically everywhere:
      `LOW` to success, `MODERATE` to warning, `HIGH` to orange, `CRITICAL` to danger.
- [ ] `app_spacing.dart`: `xs 4`, `sm 8`, `md 16`, `lg 24`, `xl 32`. Nothing else.
- [ ] `app_typography.dart` with a `TextTheme` using a font that **has Arabic
      glyphs** (Cairo, Tajawal or IBM Plex Sans Arabic via `google_fonts`).
      Latin-only fonts render Arabic as empty boxes.
- [ ] `app_theme.dart` with complete light **and** dark `ThemeData`.
- [ ] Themed component defaults for `ElevatedButton`, `OutlinedButton`,
      `TextButton`, `InputDecoration`, `Card`, `Chip`, `AppBar`, `SnackBar`, `Dialog`.
- [ ] A `/debug/theme` gallery screen showing every component in both themes and
      both locales. This is how you review the design system without opening 20 screens.

## Acceptance criteria
- [ ] Switching the device to dark mode changes every screen and nothing becomes unreadable
- [ ] The gallery renders correctly in Arabic (RTL) with no missing-glyph boxes
- [ ] `grep -rn "Color(0xFF" lib/features` returns nothing
- [ ] `grep -rnE "EdgeInsets\.(all|symmetric)\([0-9]" lib/features` returns nothing
- [ ] Body text on surface passes WCAG AA contrast in both themes

## Gotchas
- Pick the font now. Swapping fonts in week 5 re-breaks every layout.
- Medical UI should stay calm. Reserve red for CRITICAL and emergency; if
  everything is red, nothing is.
