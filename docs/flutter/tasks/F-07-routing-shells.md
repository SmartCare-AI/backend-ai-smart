# F-07 · Routing & role-based shells

| | |
|---|---|
| **Phase** | Foundations |
| **Priority** | **P0 — demo-critical** |
| **Estimate** | 1 day |
| **Owner** | Dev A |
| **Depends on** | F-02 |
| **Blocks** | P-01, D-01, C-01, H-01 |

## Goal
One app, four surfaces. After login the user lands in the shell that matches
`user.role`, and cannot reach another role's routes.

## Scope
- [ ] `go_router` with a `redirect` driven by an auth provider.
- [ ] Redirect rules:
      not authenticated and route is not public -> `/login`;
      authenticated and on an auth route -> the role home;
      authenticated but the route is not allowed for the role -> the role home.
- [ ] Four `StatefulShellRoute` shells with their own bottom nav / side rail:

| Role | Shell | Navigation destinations |
|---|---|---|
| `PATIENT` | patient (mobile) | Home · Appointments · Medications · Records · More |
| `CAREGIVER` | caregiver (mobile) | Patients · Alerts · Emergency · More |
| `DOCTOR` | doctor (tablet/web) | Schedule · Patients · Alerts · More |
| `HOSPITAL_ADMIN`, `ADMIN` | hospital (web) | Overview · Doctors · Quality · More |

- [ ] Responsive: below 600 dp use a bottom nav bar; at 900 dp and above use a
      `NavigationRail` with a persistent side panel. The doctor and hospital
      shells are mainly used wide.
- [ ] A `/splash` route that restores the session from secure storage before deciding.
- [ ] Deep-link routes for push payloads (P-14):
      `/appointments/:id`, `/medications`, `/alerts/:id`, `/emergency/:id`, `/chats/:id`.

## Acceptance criteria
- [ ] Logging in as each of the four seeded accounts lands in the correct shell
- [ ] Typing a doctor route while logged in as a patient redirects to the patient home
- [ ] Killing and reopening the app restores the session without a flash of the login screen
- [ ] Logging out clears the stack — the back button cannot return to a signed-in screen
- [ ] The doctor shell in Chrome at 1280 px wide shows a navigation rail, not a bottom bar

## Gotchas
- Put the role check in the router, not in each screen. One place to audit.
- `ADMIN` should be allowed everywhere; it is the escape hatch for demos.
