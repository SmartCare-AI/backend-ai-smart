# SmartCare AI — Backend Master Plan

> **Who this is for:** the backend team (and future-you). It records **what we decided, why, what to build next, in what order, and what to learn** for each step.
> **Status baseline (today):** Auth (email + OTP verification + Google/Apple via Firebase), Users/Profiles, Uploads (pluggable storage), Swagger, rate limiting, PM2 deployment on `https://artsoraback.tech` — all **live**. Full domain schema (29 tables) is **written and migrated**.

---

## 1. The big picture

```
Mobile App (patient)      Doctor Dashboard        Hospital Dashboard
        │                        │                        │
        └────────────┬───────────┴────────────┬───────────┘
                     ▼                        ▼
              REST API (NestJS)        WebSocket Gateway (chat/presence)
                     │                        │
        ┌────────────┼────────────────────────┤
        ▼            ▼                        ▼
   PostgreSQL     Redis                 Firebase FCM
   (Prisma)       (rate-limit,          (push to offline
                   queues, cache)        devices — free)
```

**One repo, one NestJS app, many modules.** We stay a modular monolith (NOT microservices) — right choice for a 3–6 person team: one deploy, one database, no network complexity, and NestJS modules already give us clean boundaries. This is a *deliberate architecture decision you can defend in the discussion*: microservices solve organizational scale problems we don't have.

---

## 2. Schema decisions made from the ERD (read this, team)

The ERD from our data analyst was translated to `prisma/schema.prisma` with these engineering adjustments — each is a decision, not an accident:

| # | ERD said | Schema does | Why |
|---|---|---|---|
| 1 | `User` + `Patient`/`Doctor`/`Caregiver` as separate entities | `User` (auth core) + `PatientProfile` / `DoctorProfile` / `CaregiverProfile` 1:1 tables | Keeps ONE login/auth path for everyone; role data lives in its own table. Pattern name: **class-table inheritance** |
| 2 | `VitalSign` and `DeviceReading` as two tables | **Merged into one `VitalSign`** with `source` (MANUAL/DEVICE) + optional `deviceId` | Charts, alert rules, and AI read ONE time-series instead of unioning two tables |
| 3 | `MedicineTracking` | Renamed `MedicationDose` — one row per scheduled intake | The row *is* the adherence data: `status` ∈ SCHEDULED/TAKEN/MISSED/SKIPPED |
| 4 | `FilePath` string columns on images/documents | FK to `FileObject` (our uploads module) | One storage pipeline, one security model, no orphan paths |
| 5 | `Chat` + `Message` only | Added `ChatParticipant` | Without it you cannot query "my chats" or unread counts |
| 6 | Notifications entity | Added `DeviceToken` table too | In-app feed (`Notification`) ≠ push delivery (FCM tokens). Both needed |
| 7 | — (not in ERD) | Added `EmergencyEvent`, `EmergencyContact`, `FirstAidGuide` | The Emergency Hub (section 5) needs its own entities |
| 8 | `Assessment` belongs to Visit | `visitId` **nullable** + direct `patientId` | The AI initial assessment happens *before* any visit exists |
| 9 | Visit only via Appointment | `appointmentId` nullable, direct `patientId`+`doctorId` | Walk-in and emergency visits have no appointment |
| 10 | Statuses as free text | **Postgres enums** for every workflow state | Typo-proof, self-documenting, Swagger shows allowed values |
| 11 | `PrescriptionItem.MedicineID` ambiguous | Real `Medicine` catalog table | Adherence analytics can aggregate per drug across patients |

**Action for the team:** review the table list in `prisma/schema.prisma` (it's organized in 7 numbered sections matching the patient journey). Disagreements → issue on GitHub, tag @schema-owner.

---

## 3. Emergency Hub — design + how we reach OFFLINE users cheaply

This is our standout feature. Two halves: **content** (first aid) and **events** (SOS / critical alerts).

### 3.1 The answer to "what do we use that isn't costly?"

**Firebase Cloud Messaging (FCM) — completely free, unlimited messages.** We already use Firebase for social login, so the same `firebase-admin` SDK sends push. There is no cheaper option; there is no message volume limit.

How it actually reaches an "offline" user (this is the part to understand deeply):

1. The app registers an **FCM token** on login → we store it in `device_tokens`.
2. "Offline" in practice means *app closed / phone in pocket* — the phone's OS keeps one persistent connection to Google/Apple push servers even when apps are dead.
3. We send a **high-priority** FCM message → Android wakes the app even in Doze mode; iOS delivers via APNs.
4. If the phone is truly unreachable (no internet at all), FCM **stores the message** and delivers the moment connectivity returns (TTL configurable, up to 4 weeks).
5. For life-critical events we add a second, non-internet channel: **SMS fallback** (see escalation below).

### 3.2 SOS escalation chain (the flow to implement)

```
Patient presses SOS (or system escalates a CRITICAL alert)
  → POST /emergency/sos  { lat, lng, description? }
  → creates EmergencyEvent(ACTIVE)
  → immediately, in parallel:
      1. FCM push (highest priority) to ALL caregivers' device_tokens
      2. In-app Notification rows for caregivers + treating doctor
  → BullMQ delayed job (+2 min): if event still not ACKNOWLEDGED:
      3. SMS to EmergencyContact list ordered by priority
  → caregiver taps "I'm on it" → PATCH /emergency/:id/acknowledge → cancels escalation
```

**SMS cost control:** SMS is sent ONLY when a push goes unacknowledged for 2 minutes, only for SOS/CRITICAL — that's a handful of SMS per month, pennies. Implement behind an `SmsProvider` interface (same Strategy pattern as storage): `NoopSmsProvider` (logs to console — default, **zero cost**, fine for the graduation demo) and later a real one (Twilio/Vonage trial credit, or a local Egyptian SMS gateway). The demo can show the console log; the architecture proves the design.

### 3.3 First-aid content (works with zero connectivity)

- `FirstAidGuide` table: slug, category (bleeding/burns/choking/CPR/fractures…), **markdown content**, optional media file.
- `GET /first-aid` returns ALL published guides with an `updatedAt` stamp → the mobile app **caches everything locally** on first launch and re-syncs when `updatedAt` changes. The patient opens first-aid instructions with no internet at all — that's the point of first aid.
- Admin endpoints to author guides (role: ADMIN).

---

## 4. Build plan — modules in order

Work top-to-bottom; each phase is demoable on its own. **[LEARN]** = topic to study before/while coding it (resources in section 8).

### Phase A — Platform plumbing (build FIRST, everything depends on it)
| Piece | What to build | Key detail |
|---|---|---|
| **RBAC** | `@Roles(Role.DOCTOR)` decorator + `RolesGuard` (global, after JwtAuthGuard) | Route-level role check. Resource-level ownership stays in services ("is this MY patient?") **[LEARN: NestJS guards + metadata reflection]** |
| **Consent guard** | `ConsentService.assertCanAccess(patientId, requesterUserId, type)` helper | Caregivers/doctors touch patient data ONLY through this — our compliance story |
| **Audit interceptor** | Global interceptor writing `AuditLog` on every mutating request (method, entity, userId, IP) | Write async (don't block the response) **[LEARN: NestJS interceptors + RxJS tap]** |
| **Queues** | BullMQ on our existing Redis: `notifications`, `reminders`, `escalations` queues | The backbone for reminders + SOS escalation **[LEARN: BullMQ delayed jobs, docs.bullmq.io]** |
| **Notifications module** | `NotificationsService.notify(userId, type, title, body, data)` → writes row + fans out FCM to all tokens | Token endpoints: `POST/DELETE /notifications/tokens`. Prune dead tokens on FCM "unregistered" errors **[LEARN: firebase.google.com/docs/cloud-messaging]** |
| **Profiles** | Auto-create `PatientProfile` on patient registration (generate `SC-2026-XXXXXX`); doctor onboarding endpoint (ADMIN verifies license → `isVerified`) | Extends existing auth — small |

### Phase B — Core medical flow (the heart)
| Module | Endpoints (sketch) | Notes |
|---|---|---|
| **Hospitals** | CRUD `/hospitals`, `/hospitals/:id/departments` (ADMIN) | Simple — good first task for a junior teammate |
| **Appointments** | `POST /appointments` (patient/caregiver books), `GET /appointments/my`, doctor availability check, `PATCH :id/confirm|cancel` | Overlap validation: no double-booking a doctor. Booking notification via Phase A. **[LEARN: handling time + timezones — store UTC always]** |
| **Visits** | Doctor: `POST /visits` (from appointment or walk-in), `PATCH :id/close` | Creating a visit from appointment marks it COMPLETED |
| **Diagnoses & Assessments** | `POST /visits/:id/diagnoses`, `POST /assessments` (AI_INITIAL type is public-ish → patient-initiated) | Symptoms stored as JSON string for MVP |
| **Tests & Images** | `POST /visits/:id/tests`, `POST /tests/:id/result` (+file), `POST /visits/:id/images` (uses uploads module) | Purpose enums already exist in FilePurpose |
| **Treatment plans & Prescriptions** | `POST /treatment-plans`, `POST /prescriptions` (+items) | On prescription create → **generate MedicationDose rows** for the whole duration (e.g. "every 8h × 7 days" = 21 rows) — this is the clever bit that powers everything below |

### Phase C — Adherence + Monitoring (the "smart" in SmartCare)
| Piece | What to build |
|---|---|
| **Medication reminders** | Repeatable BullMQ job (every minute): find `MedicationDose` WHERE status=SCHEDULED AND scheduledAt ≤ now+15min AND reminder not sent → push "Time for Panadol 500mg 💊". Patient taps → `PATCH /doses/:id/take` |
| **Missed-dose detection** | Job: scheduledAt < now−60min AND status=SCHEDULED → mark MISSED → if 3 consecutive missed → `Alert` (severity HIGH) → notify caregiver (this is the Family Portal promise) |
| **Vitals API** | `POST /vitals` (manual or device batch), `GET /patients/:id/vitals?type=&from=&to=` shaped for time-series charts |
| **Threshold alerts** | On vital insert: check simple rules table (HR > 120 resting, glucose > 300, SpO2 < 90 → CRITICAL) → create `Alert` → notify doctor; CRITICAL auto-creates `EmergencyEvent` (section 3 flow takes over) |
| **Adherence score** | `GET /patients/:id/adherence` = TAKEN/(TAKEN+MISSED) over window — doctor dashboard number |

### Phase D — Emergency Hub (section 3, now buildable in ~3 days because A+C exist)

### Phase E — Telemedicine
| Piece | Decision |
|---|---|
| **Chat** | Socket.IO gateway (`@nestjs/websockets`): JWT on handshake, room per chat, persist via existing Message table, `lastReadAt` for unread badges. REST fallback (`GET /chats/:id/messages?cursor=`) for history **[LEARN: docs.nestjs.com/websockets/gateways]** |
| **Video calls** | **WebRTC peer-to-peer** with Google's free STUN for the demo + our Socket.IO as signaling channel. Zero cost. Known limitation to state honestly: symmetric-NAT cases need a TURN server (~$5/mo VPS with coturn) — "future work" slide. **[LEARN: WebRTC signaling concepts — offer/answer/ICE]** |

### Phase F — AI modules (no paid LLMs — our own engine, built ✅)
- One `AiProvider` interface (Strategy again). Implementations:
  - **Rules engine** (built-in, free, bilingual AR/EN): red-flag detection → CRITICAL + SOS card, keyword → specialty map, explainable `reasons[]`. This is the baseline our trained model must beat.
  - **Python ML service** (`AI_SERVICE_URL`, FastAPI + scikit-learn — full plan in `docs/AI-PLAN.md`): same `/triage` contract, automatic fallback to rules when down.
- `POST /ai/triage` (patient) → risk level + suggested specialty, auto-saved as AI_INITIAL Assessment. `GET /ai/patients/:id/risk` → deterministic snapshot (vitals thresholds + active alerts + adherence + open emergencies).
- Keep every AI output labeled `suggestedSpecialty` / `riskLevel` — *assistive, never diagnostic* (say this sentence in the defense).

### Phase G — Hospital dashboard analytics
- Read-only aggregate endpoints: readmission rate, adherence by department, doctor load. Pure Prisma `groupBy` — build last, impresses most per hour of work.

---

## 5. Cross-cutting rules (apply from day 1)

1. **Every list endpoint is paginated** (`?page=&limit=`, default 20, max 100) — retrofitting pagination is painful.
2. **Ownership checks in services, not controllers** — controller knows *who*, service decides *may they*.
3. **UTC everywhere**; the mobile app localizes.
4. **Soft references to money/PII in logs = never** (log ids, not content).
5. **Swagger on every new endpoint the same day** — it's our team contract (we already have the pattern; copy an existing controller).
6. **One migration per PR**, never edit an applied migration (we learned this the hard way with P3009 😄).
7. **Seed script** (`prisma/seed.ts`): 1 hospital, 2 departments, 1 doctor, 2 patients, 1 caregiver link, 5 first-aid guides — so every teammate and every demo starts from the same world.

---

## 6. Suggested timeline (adjust to team size)

| Week | Deliverable |
|---|---|
| 1 | Phase A complete (RBAC, audit, queues, notifications, profiles) |
| 2–3 | Phase B (appointments → prescriptions with dose generation) |
| 4 | Phase C (reminders, vitals, alerts, adherence) |
| 5 | Phase D Emergency Hub + first-aid content authored |
| 6–7 | Phase E chat + video demo |
| 8 | Phase F AI endpoints |
| 9 | Phase G analytics + polish + seed data for the defense demo |

---

## 7. What makes this project stand out (defense talking points)

1. **End-to-end patient journey in one data model** — show the schema sections mirroring the journey.
2. **Emergency escalation that survives an offline phone** — live demo: press SOS, phone in airplane mode receives the push the moment it reconnects; console shows the SMS fallback firing after 2 min.
3. **Engineering maturity**: Strategy-pattern storage/SMS/AI providers, refresh-token rotation, hashed OTPs, audit log, consent model, rate limiting — name the pattern + the reason in one sentence each.
4. **Honest AI positioning**: rules-based clinical alerts + LLM assistance, clearly labeled non-diagnostic.
5. **Working docs**: open `https://artsoraback.tech/docs` live during the defense.

---

## 8. Learning path (for the implementers)

| Topic | Why we need it | Where |
|---|---|---|
| NestJS guards, interceptors, custom decorators | RBAC, audit log | docs.nestjs.com (Guards / Interceptors chapters) |
| BullMQ (queues, delayed + repeatable jobs) | Reminders, SOS escalation | docs.bullmq.io |
| FCM server SDK | All push notifications | firebase.google.com/docs/cloud-messaging/server |
| Socket.IO + NestJS gateways | Chat, presence | docs.nestjs.com/websockets/gateways |
| WebRTC fundamentals (offer/answer/ICE/STUN/TURN) | Video consultations | webrtc.org + MDN WebRTC guide |
| Prisma relations & `groupBy` | Whole data layer, analytics | prisma.io/docs |
| Postgres indexes (we already added them — read why) | Query speed on time-series | use `EXPLAIN ANALYZE` on /vitals queries |
| OWASP API Security Top 10 | Defense Q&A ammunition | owasp.org |

Rule of thumb: **learn each topic the week you build it, not before** — it sticks better with a real task.

---

## 9. Decisions already locked (don't re-litigate without a reason)

- NestJS 11 + Prisma 6 (pinned — v7 has breaking config changes) + PostgreSQL + Redis, port 3050, PM2 + nginx on `artsoraback.tech`.
- Integer IDs everywhere; random UUID keys for stored files.
- Local-disk storage driver (R2 adapter exists, off).
- FCM for push (free) — no paid notification service.
- SMS only as unacknowledged-SOS fallback, behind `SmsProvider` (Noop in dev).
- Modular monolith; no microservices, no Docker for now.
