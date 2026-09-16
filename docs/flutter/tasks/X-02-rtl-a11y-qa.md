# X-02 · RTL, accessibility & responsive QA

| | |
|---|---|
| **Phase** | Quality & release |
| **Priority** | P1 — stretch |
| **Estimate** | 1 day |
| **Owner** | Dev B |
| **Depends on** | F-04 |
| **Blocks** | — |

## Goal
A structured pass over every built screen, in both languages, both themes and
three widths. Catching this in week 6 is cheap; catching it during the defense is not.

## The checklist — run it per screen
For **every** screen that exists, verify:

- [ ] **Arabic RTL**: layout mirrors, no text is clipped, icons that imply
      direction are flipped, no stray English
- [ ] **English LTR**: unchanged and correct
- [ ] **Dark mode**: nothing invisible, no white-on-white cards
- [ ] **Small phone (360 × 640)**: no overflow, no cut-off buttons
- [ ] **Tablet (768)**: layout uses the space rather than stretching a phone layout
- [ ] **Desktop (1280, doctor and hospital only)**: rail visible, content readable
- [ ] **Large font**: device text size at 130% does not break the layout
- [ ] **Tap targets** at least 48 × 48 dp
- [ ] **Contrast**: body text passes WCAG AA
- [ ] **Semantics**: images and icon-only buttons have labels for screen readers
- [ ] **Keyboard**: on web, forms are tabbable in a sensible order
- [ ] **No overflow warnings** in the debug console

## Scope
- [ ] Build the checklist as a spreadsheet or issue template, one row per screen
- [ ] Walk every screen and record pass or fail
- [ ] File a fix issue per failure; fix the P0-screen ones immediately
- [ ] Fix all `RenderFlex overflowed` warnings — there should be zero

## Acceptance criteria
- [ ] Every built screen has a completed checklist row
- [ ] Zero overflow warnings in a full walk of the app
- [ ] The app is fully usable in Arabic end to end: register, book, triage, SOS
- [ ] No hard-coded English string remains (grep the l10n keys against usage)
- [ ] Screenshots captured in both languages for the defense slides

## Gotchas
- Do this on a **real device**, not just the emulator. Font rendering, safe areas
  and notches differ.
- The most common RTL bug is `EdgeInsets.only(left:)`. Grep for `left:` and
  `right:` across `lib/` and justify every hit.
