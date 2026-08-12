# SmartCare AI — Backend API

Backend for the **SmartCare AI Intelligent Patient Journey Management Platform** (graduation project).
Built with **NestJS 11 · Prisma 6 · PostgreSQL · JWT · Firebase (Google/Apple) · Swagger**.

- **Production API:** `https://artsoraback.tech/api/v1`
- **Interactive docs (Swagger):** `https://artsoraback.tech/docs`
- **Health check:** `GET /api/v1/health`

## Quick start (local)

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL + JWT secrets (others optional)
npm run prisma:generate
npm run prisma:migrate    # creates the tables (needs PostgreSQL running)
npm run start:dev         # http://localhost:3050 — docs at /docs
```

Runs fine with **only** `DATABASE_URL` and the JWT secrets set:
no SMTP password → verification codes are printed to the console;
no Redis → in-memory rate limiting; no Firebase → social login returns 503 with a clear message.

## Scripts

| Command | What it does |
|---|---|
| `npm run start:dev` | Dev server with hot reload |
| `npm run build` / `start:prod` | Compile / run compiled build |
| `npm run prisma:generate` | Generate the Prisma client |
| `npm run prisma:migrate` | Create & apply a migration (dev) |
| `npm run prisma:studio` | Visual DB browser |
| `npm run deploy` | **Server:** install → generate → migrate → build → PM2 start |
| `npm run redeploy` | **Server:** git pull → install → generate → migrate → build → PM2 restart |
| `npm run lint` / `test` / `test:e2e` | Lint / unit tests / e2e tests |

Deployment details (nginx, HTTPS, PM2, DNS): see [DEPLOYMENT.md](DEPLOYMENT.md).

## Project structure

```
src/
├── auth/          # register, email verification, login, refresh rotation,
│   │              # forgot/reset password, Google & Apple via Firebase
│   ├── dto/  strategies/  entities/
├── users/         # profile, edit profile, change password, avatar upload
├── uploads/       # central file service — files get an id, stored via a
│   └── storage/   # pluggable StorageProvider (local disk | Cloudflare R2)
├── mail/          # Nodemailer (Gmail SMTP) — verification & reset codes
├── firebase/      # Firebase Admin — verifies social sign-in ID tokens
├── prisma/        # PrismaService (global)
├── common/        # @Public(), @CurrentUser(), global JwtAuthGuard, shared DTOs
├── config/        # environment validation (fails fast on bad config)
└── main.ts        # helmet, CORS, validation pipe, Swagger, static /files
```

## Authentication flow

1. `POST /api/v1/auth/register` → account created, **6-digit code emailed** (10 min expiry)
2. `POST /api/v1/auth/verify-email` → email confirmed, returns `accessToken` + `refreshToken`
3. Protected routes: `Authorization: Bearer <accessToken>` (15 min lifetime)
4. `POST /api/v1/auth/refresh` → new token pair (refresh tokens are **single-use / rotated**, 7 days)
5. Google/Apple: client signs in with Firebase → send the Firebase ID token to `POST /api/v1/auth/social/firebase`

Full request/response examples for every endpoint are in **Swagger** (`/docs`) — click **Authorize** and paste an access token to try protected routes.

## Security decisions

- Passwords hashed with **bcrypt (12 rounds)**; OTP codes & refresh tokens stored **only as SHA-256 hashes**
- Refresh token **rotation** — a stolen refresh token dies on first reuse; password reset/change revokes all sessions
- **Rate limiting**: 100 req/min global per IP, 3–5 req/min on auth/email endpoints (Redis-backed when `REDIS_URL` is set)
- **Secure by default**: every route requires JWT unless explicitly `@Public()`
- Identical responses for existing/unknown emails on forgot-password & resend-verification (no account enumeration)
- `helmet`, strict `ValidationPipe` (whitelist + forbid unknown fields), OTP attempt limits (5 tries)

## Environment variables

Every variable is documented inline in [.env.example](.env.example). Summary:

| Group | Variables | Required |
|---|---|---|
| Core | `PORT` (3050), `DATABASE_URL`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | ✅ |
| Tokens | `JWT_ACCESS_TTL` (15m), `JWT_REFRESH_TTL_DAYS` (7) | optional |
| Email | `MAIL_USER`, `MAIL_PASSWORD` (Google **App Password**), `MAIL_FROM` | for real emails |
| Social | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (service account) | for Google/Apple |
| Rate limit | `REDIS_URL` | production |
| Storage | `STORAGE_DRIVER` (local), `UPLOADS_DIR`, `APP_URL` | defaults work |

> **Firebase note:** the backend needs the **Admin SDK service account** key
> (Firebase Console → Project settings → Service accounts → *Generate new private key*),
> **not** the client `firebaseConfig` — that one belongs in the mobile/web app.

## Roadmap (per the architecture document)

Auth & profiles (this module) → medical records (PHR) → doctor dashboard → telemedicine → AI modules (risk prediction, summaries, adherence) → hospital dashboard & family portal.
