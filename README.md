# Cadence

An online learning platform: a course catalog, a video player that remembers
where you stopped, learner progress tracking, and an admin area for managing
courses, lessons and learners.

Everything persists in PostgreSQL, every rule is enforced on the server, and
the whole stack runs from one command with Docker Compose.

| | |
|---|---|
| **Client** | React 18 · TypeScript (strict) · Vite · React Router · TanStack Query v5 · Tailwind + Radix (shadcn-style primitives) |
| **Server** | Node 20 · TypeScript · Express · Zod · Prisma · PostgreSQL 16 |
| **Shared** | One Zod schema set used for API validation, TypeScript types, OpenAPI and client forms |
| **Tests** | 221 passing — 157 server (against a real Postgres) + 64 client (jsdom + MSW) |

---

## Quick start (Docker)

Prerequisites: **Docker Desktop**, or Docker Engine with the Compose v2
plugin. Nothing else — no Node, no Postgres on the host.

```bash
cp .env.example .env
docker compose up --build
```

Then open **<http://localhost:8080>**.

Compose brings the stack up in order, waiting at each step:

```
db (healthy) → migrate (migrations + seed, then exits) → server (healthy) → client
```

### Seeded accounts

All of them use the password `Password123`.

| Email | Role | State |
|---|---|---|
| `admin@cadence.dev` | ADMIN | Author of the seeded courses; reviews instructor applications |
| `ada@cadence.dev` | LEARNER | One course part-watched, one finished, one barely started |
| `kwame@cadence.dev` | LEARNER | One course completed, plus an archived course |
| `lina@cadence.dev` | LEARNER | Enrolled, nothing watched (the empty states) |
| `nadia@cadence.dev` | INSTRUCTOR | One published course with real enrolled learners and progress, one draft |
| `yusuf@cadence.dev` | INSTRUCTOR | **Suspended** — shows the suspended page, and that learning still works |
| `kemi@cadence.dev` | LEARNER | Application **PENDING** — the one waiting in the admin queue |
| `chidi@cadence.dev` | LEARNER | Application **REJECTED** — shows the reason and the reapply date |
| `sofia@cadence.dev` | LEARNER | Application **WITHDRAWN** — can apply again straight away |

To see the whole instructor flow end to end: sign in as `kemi@cadence.dev`
to see a pending application, then as `admin@cadence.dev` to approve it,
then back as Kemi — **without signing out** — and the Teaching workspace is
there.

## Roles

Three roles, and they are **additive**: becoming an instructor adds
capabilities and removes none.

| Capability | LEARNER | INSTRUCTOR | ADMIN |
|---|---|---|---|
| Browse, enroll, watch, track progress, learner dashboard | ✓ | ✓ | ✓ |
| Apply to become an instructor | ✓ | – | – |
| Teaching workspace; create and manage **own** courses, lessons and media | – | ✓ | ✓ (any course) |
| Enrolled learners and analytics for **own** courses | – | ✓ | ✓ (all courses) |
| Review applications; suspend and reinstate instructors; manage users; platform analytics | – | – | ✓ |

**Instructors are not administrators.** They never reach `/admin/*` or any
platform-wide data, and another instructor's course answers 404 — not 403,
which would confirm it exists.

### Becoming an instructor

1. A learner applies at **Become an Instructor** (profile menu, or the
   navigation pill). The form prefills their name and email read-only; the
   server takes both from the session and ignores anything in the body.
2. While it is pending they can edit or withdraw it. At most one pending
   application per person, enforced by a partial unique index as well as by
   the service.
3. An admin reviews it under **Instructor applications**, and approves or
   rejects it with a reason. Every decision is recorded as an event with the
   actor, the timestamp and the reason; internal notes are admins-only and
   never shown to the applicant.
4. On approval, in one transaction: the role becomes INSTRUCTOR, an
   instructor profile is created from the application, and the applicant is
   notified. **The new permissions apply on their very next request** — no
   signing out, no waiting for a token to expire.
5. A rejected applicant can reapply after `INSTRUCTOR_REAPPLY_COOLDOWN_DAYS`
   (default 7; set `0` to allow it immediately).
6. An admin can suspend an instructor with a required reason, and reinstate
   them. **Suspension pauses teaching only**: the person keeps every learner
   capability, their enrollments and all their progress. Their published
   courses leave the catalog, and learners already enrolled keep full access.

### URLs

| What | Where |
|---|---|
| App | <http://localhost:8080> |
| API (direct) | <http://localhost:4000/api/v1> |
| API docs (Swagger UI) | <http://localhost:4000/api/docs> |
| OpenAPI JSON | <http://localhost:4000/api/docs.json> |
| Postgres | `localhost:55432` (change with `DB_PORT`) |

In Compose, nginx serves the built client and proxies `/api` to the server, so
the browser sees a **single origin**. That keeps the auth cookies first-party
and means CORS plays no part in the Docker setup.

---

## Everyday commands

| Command | What it does |
|---|---|
| `npm run docker:up` | Build and start the prod-like stack, detached |
| `npm run docker:dev` | Dev stack with hot reload — client on **:5173**, API on **:4000** |
| `npm run docker:down` | Stop the stack, keep the database volume |
| `npm run docker:reset` | `down -v` then `up --build` — a completely fresh database |
| `npm run docker:logs` | Follow the logs of every service |
| `npm run docker:seed` | Re-run the (idempotent) seed |
| `npm run docker:test` | Run both test suites inside Compose, against a disposable Postgres |

Workspace scripts, which also work on the non-Docker path:

| Command | What it does |
|---|---|
| `npm test` | Server then client suites |
| `npm run test:server` / `npm run test:client` | One suite |
| `npm run typecheck` | `tsc --noEmit` across shared, server and client |
| `npm run lint` | ESLint, zero warnings tolerated |
| `npm run build` | Build shared, server, then client |
| `npm run db:migrate` / `db:deploy` / `db:seed` / `db:reset` | Prisma, against `DATABASE_URL` |
| `npm run env:check` | Report any key `.env` is missing relative to `.env.example` |
| `npm run vendor:fonts` | Copy the self-hosted `.woff2` files out of `@fontsource` |
| `npm run thumbnails` | Regenerate the SVG course thumbnails |
| `npm run lesson:video` | Regenerate the bundled sample lesson video and its captions (needs Chrome or Edge) |

---

## Running the tests

```bash
npm run docker:test
```

This builds the test images, starts a throwaway Postgres (`db-test`, on tmpfs,
never sharing the development volume), runs the server suite against it, then
runs the client suite, and exits non-zero if either fails.

**Actual output:**

```
test-server-1  |  Test Files  10 passed (10)
test-server-1  |       Tests  157 passed (157)
test-client-1  |  Test Files  8 passed (8)
test-client-1  |       Tests  64 passed (64)

✓ server and client suites passed inside Compose
```

The server suite is deliberately *not* mocked: Prisma talks to a real
PostgreSQL, so the schema, its constraints and the transactions are what is
under test. `prisma migrate reset` runs once before the suite, and tables are
truncated between files.

What is covered:

- **Unit** — the progress calculator (clamping, monotonic max-watched, the 90%
  threshold, the `ended` tolerance, sticky completion, course percentage
  including the zero-lesson case), password hashing, JWT helpers, CSRF
  comparison, pagination, and the shared Zod schemas.
- **Integration** — registration and login (including that an injected `role`
  is ignored), refresh rotation with stolen-token detection, CSRF rejection,
  every `/admin/*` route refusing a learner, course CRUD and publish rules,
  delete-with-enrollments returning 409, lesson reordering, enrollment
  idempotency, lesson access control, progress and completion, IDOR (one
  learner cannot read or write another's progress), and dashboard aggregates
  compared against fixtures.
- **Workflows** — A: register → browse → enrol → watch → resume → complete →
  percentages update. B: admin creates → adds lessons → publishes → a learner
  sees it. C: a learner calling an admin endpoint gets 403.
- **Client** — login and register validation plus server-error mapping, route
  guards, CourseCard in every enrollment state, catalog loading/empty/error
  states, optimistic enrol with rollback, lesson list statuses and the current
  indicator, the progress tracker's throttle and flushes, and the dashboard
  rendering API aggregates.

---

## Running without Docker

You still need a PostgreSQL 16 instance; the quickest is to borrow Compose's:

```bash
npm install
cp .env.example .env
docker compose up -d db          # or point DATABASE_URL at your own Postgres

npm run db:migrate
npm run db:seed
npm run dev                      # API on :4000, client on :5173
```

No hand-editing of `.env` is needed: the template holds the **host** values
(`localhost:55432`, `NODE_ENV=development`). Compose overrides `DATABASE_URL`,
`DATABASE_URL_TEST`, `NODE_ENV` and `APP_URL` for its own services, so one file
serves both paths.

These commands load `.env` through `dotenv-cli`, which is why they work from a
plain shell. If you invoke the workspace scripts directly (`npm run dev -w
server`) you are bypassing that and must supply the environment yourself —
that is the form Compose uses, where the environment already exists.

`npm run env:check` reports any key your `.env` is missing. `.env` is
gitignored, so it does not pick up keys added to `.env.example` later; this is
the check that tells you.

On this path the client is served by Vite on `:5173` and proxies `/api` to the
API, so the browser still sees one origin. `CORS_ORIGIN` covers the case where
you serve them from genuinely different origins.

To run the server tests outside Docker, create the test database once. Prisma
creates the *schema*, not the database, so it has to exist first:

```bash
docker compose exec db psql -U cadence -d cadence -c "CREATE DATABASE cadence_test"
npm run test:server
```

`DATABASE_URL_TEST` already points there in `.env`, so nothing needs passing on
the command line. The suite refuses any URL whose database name does not
contain `test`, because it resets whatever it is given.

---

## Storage for uploads

Course thumbnails, instructor photos and lesson videos go through one
`StorageProvider` interface with two drivers.

| `STORAGE_DRIVER` | What it does | When |
|---|---|---|
| `local` *(default)* | Writes to a directory, mounted as a named Docker volume | The default so that `docker compose up` gives working uploads with no cloud account to set up |
| `s3` | S3-compatible object storage — the `minio` service locally, S3 or R2 in production. The browser uploads **straight to storage**, so large videos never pass through the API | Production, or to exercise the real path locally |

To use MinIO locally, set `STORAGE_DRIVER=s3` in `.env` and bring the stack
up. Compose starts `minio` and a one-shot `minio-bucket` job that creates
the bucket; the console is at <http://localhost:9001>.

**Never commit real credentials.** The values in `.env.example` are MinIO's
local defaults and are not secrets; in production every `S3_*` value comes
from the environment.

Whatever the driver:

- Nothing binary is stored in Postgres — only the storage key and metadata.
- Every upload is verified **after** the bytes land: the real size, and the
  real type read from the file's magic bytes rather than the declared
  Content-Type or the extension. Only then is it usable.
- Lesson videos are not public. The lesson endpoint returns a short-lived
  signed URL (or streams through the API on the local driver), and only
  after the normal access check. Seeking works through HTTP Range.
- With no storage configured at all, external `https://` video URLs still
  work, which is the documented path for development and demos.
- Allowed formats: `mp4` and `webm` for video, `jpg`/`png`/`webp` for
  images, with `MAX_VIDEO_MB` and `MAX_IMAGE_MB` ceilings.

## Environment variables

Copy `.env.example` to `.env`. Every variable has a working development
default, so the only reason to edit it is to change a port or set real
secrets.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `POSTGRES_USER` | yes | `cadence` | Compose passes it to the `db` service |
| `POSTGRES_PASSWORD` | yes | `cadence_dev_password` | Change outside local use |
| `POSTGRES_DB` | yes | `cadence` | |
| `DATABASE_URL` | yes | `…@localhost:55432/cadence` | The host value. **Compose overrides it** with the `db` service name |
| `DATABASE_URL_TEST` | tests only | `…@localhost:55432/cadence_test` | Must contain `test`; the suite resets it. **Compose overrides it** with `db-test` |
| `JWT_ACCESS_SECRET` | yes | dev placeholder | ≥ 32 chars. `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | yes | dev placeholder | ≥ 32 chars, and must differ from the access secret in production |
| `ACCESS_TOKEN_TTL` | no | `15m` | |
| `REFRESH_TOKEN_TTL` | no | `7d` | Also the refresh cookie's `maxAge` |
| `REFRESH_TOKEN_TTL_REMEMBERED` | no | `30d` | Used when "keep me signed in" is ticked at sign-in |
| `BCRYPT_COST` | no | `12` | The test profile lowers it to 4 for speed |
| `NODE_ENV` | no | `development` | The host value. **Compose overrides it** with `production` |
| `PORT` | no | `4000` | API port inside the container |
| `CORS_ORIGIN` | no | `http://localhost:5173` | Comma-separated allow-list; unused in Compose |
| `COOKIE_SECURE` | no | `false` | `true` only behind HTTPS |
| `APP_URL` | no | `http://localhost:8080` | Public URL of the SPA; password-reset links are built from this, never from the request `Host` |
| `MAIL_FROM` | no | `Cadence <no-reply@cadence.dev>` | `From:` on transactional mail |
| `LOG_LEVEL` | no | `info` | `silent` in tests |
| `CLIENT_PORT` | no | `8080` | Published host port for nginx |
| `API_PORT` | no | `4000` | Published host port for the API |
| `DB_PORT` | no | `55432` | Published host port for Postgres. Not 5432: a locally installed Postgres usually owns that, and the clash is silent |
| `VITE_API_URL` | no | `/api/v1` | Baked in at client build time |
| `INSTRUCTOR_REAPPLY_COOLDOWN_DAYS` | no | `7` | How long a rejected applicant waits. `0` allows an immediate reapplication |
| `ANALYTICS_ACTIVE_DAYS` | no | `14` | The window that defines an "active" learner. One definition, used by the stat cards, the chart and the table filter alike |
| `STORAGE_DRIVER` | no | `local` | `local` (a Docker volume) or `s3` |
| `STORAGE_LOCAL_DIR` | no | `./storage` | Where the local driver writes. **Compose overrides it** with the `mediadata` volume |
| `S3_ENDPOINT` | s3 only | — | **Compose overrides it** with `http://minio:9000` |
| `S3_BUCKET` | s3 only | `cadence-media` | Created by the `minio-bucket` job |
| `S3_ACCESS_KEY` | s3 only | `cadence_minio` | MinIO's local default. Never a real credential in the repo |
| `S3_SECRET_KEY` | s3 only | `cadence_minio_password` | As above |
| `S3_REGION` | no | `us-east-1` | |
| `S3_FORCE_PATH_STYLE` | no | `true` | MinIO requires it; S3 tolerates it |
| `MINIO_PORT` | no | `9000` | Published host port for the MinIO API |
| `MINIO_CONSOLE_PORT` | no | `9001` | Published host port for the MinIO console |
| `MAX_VIDEO_MB` | no | `2048` | Checked before issuing an upload URL, and again against the bytes that arrive |
| `MAX_IMAGE_MB` | no | `5` | As above |
| `SIGNED_URL_TTL_SECONDS` | no | `900` | Lifetime of a signed upload or playback URL |

The server validates all of this with Zod at boot and **exits** on anything
invalid, rather than failing on the first request. Choosing
`STORAGE_DRIVER=s3` without its credentials fails at boot too, rather than
on the first upload.

---

## The API

Base path `/api/v1`. Full reference, generated from the same Zod schemas the
server validates with, at **<http://localhost:4000/api/docs>**.

Every response uses one envelope:

```json
{ "success": true,  "message": "Course retrieved", "data": {}, "meta": { "page": 1, "pageSize": 12, "total": 40, "totalPages": 4 } }
{ "success": false, "message": "Validation failed", "code": "VALIDATION_ERROR", "errors": { "email": ["Invalid email"] } }
```

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `POST /auth/forgot-password`, `POST /auth/reset-password`, `POST /auth/change-password`, `GET|PATCH /auth/me` |
| Catalog | `GET /courses`, `/courses/categories`, `/courses/:idOrSlug`, `/courses/:courseId/lessons`, `/lessons/:id` |
| Enrollment | `POST|DELETE /courses/:courseId/enroll`, `GET /courses/:courseId/enrollment`, `GET /enrollments/me` |
| Progress | `GET|PUT /lessons/:lessonId/progress`, `POST /lessons/:lessonId/complete`, `GET /progress/me` |
| Dashboards | `GET /dashboard/learner`, `GET /dashboard/admin`, `GET /activity/me` |
| Admin content | `GET|POST /admin/courses`, `GET|PATCH|DELETE /admin/courses/:id`, `PATCH /admin/courses/:id/status`, module and lesson CRUD, `PATCH /admin/modules/:id/lessons/reorder` |
| Admin people | `GET /admin/users`, `/admin/users/:id`, `/admin/users/:id/progress`, `PATCH /admin/users/:id`, `GET /admin/courses/:id/learners`, `GET /admin/activity` |
| Applications | `POST /instructor-applications`, `GET|PATCH /instructor-applications/me`, `POST /instructor-applications/me/withdraw` |
| Admin — instructors | `GET /admin/instructor-applications`, `GET /admin/instructor-applications/:id`, `POST …/:id/approve`, `POST …/:id/reject`, `POST …/:id/notes`, `GET /admin/instructors`, `POST /admin/instructors/:id/suspend`, `POST /admin/instructors/:id/reinstate` |
| Instructor workspace | `GET /instructor/dashboard`, `/instructor/courses`, `/instructor/activity`, `GET|PATCH /instructor/profile` |
| Instructor courses | `POST /instructor/courses`, `GET|PATCH|DELETE /instructor/courses/:id`, `POST …/:id/publish`, `…/unpublish`, `…/archive`, `GET …/:id/preview`, `GET …/:id/publish-checklist` |
| Instructor lessons | `POST /instructor/courses/:id/modules`, `PATCH|DELETE /instructor/modules/:id`, `POST /instructor/modules/:id/lessons`, `PATCH|DELETE /instructor/lessons/:id`, `PATCH /instructor/modules/:id/lessons/reorder` |
| Instructor analytics | `GET /instructor/courses/:id/analytics`, `GET /instructor/courses/:id/learners`, `GET /instructor/courses/:id/learners/:userId/progress` |
| Uploads | `POST /uploads/presign`, `POST /uploads/:id/complete`, `DELETE /uploads/:id`, `GET /media/*`, `GET /lessons/:id/video` |
| Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` |

Authentication is cookie-based: login sets an httpOnly access cookie (15
minutes), a path-scoped httpOnly refresh cookie (7 days, rotated on use), and
a readable `csrf_token` cookie. Every `POST`/`PUT`/`PATCH`/`DELETE` must echo
that value in an `X-CSRF-Token` header.

---

## Troubleshooting

**Port already in use.** Postgres is published on `55432` rather than `5432`
precisely because a locally installed PostgreSQL usually owns `5432`, and that
clash is silent: Compose starts fine, but `localhost:5432` then reaches the
*other* server and authentication fails with no hint as to why. If one of the
published ports is still taken, change it and leave the container's internal
port alone:

```bash
# in .env
DB_PORT=55433      # keep DATABASE_URL / DATABASE_URL_TEST in step
CLIENT_PORT=8081   # if 8080 is taken
```

**`npm run dev` or `npm run db:migrate` complains about the environment.**
`.env` is gitignored, so it does not gain keys that were added to
`.env.example` after you copied it:

```bash
npm run env:check   # lists exactly what is missing
```

**The app loads but every request 500s.** Check the server reached the
database:

```bash
docker compose logs -f server
curl http://localhost:8080/api/v1/health
```

The health endpoint returns 200 only after a real `SELECT 1` succeeds, which
is what Compose waits on before starting the client.

**Migrations or seed appear not to have run.** They are a one-shot job:

```bash
docker compose logs migrate
npm run docker:seed       # re-run the seed; it is idempotent
```

**Rebuild after changing dependencies.** The `deps` layer is cached on the
lockfile, so a new package needs an explicit rebuild:

```bash
docker compose build --no-cache server client
```

**Start completely over** (this deletes the database volume):

```bash
npm run docker:reset
```

**Dev mode changes are not picked up.** `npm run docker:dev` bind-mounts the
source and sets `CHOKIDAR_USEPOLLING=true`, which is what makes watching work
through a Windows or macOS bind mount. The client is on **:5173** in dev mode,
not :8080.

---

## Design

The UI is built from the artifacts in `docs/desktop/` and `docs/mobile/`.
`docs/design-notes.md` records the screen-by-screen mapping, every token taken
from the artifacts (colours, type scale, spacing, radius, shadows), the
self-hosted font setup, and each intentional deviation — including the
artifact elements that were deliberately **not** built because no data model
backs them.

Fonts (Bricolage Grotesque, Inter, JetBrains Mono — all SIL OFL) are vendored
into `client/src/assets/fonts/` as `.woff2` with their licences and loaded
through `@font-face`. There are no requests to any font CDN.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md) for the layering, the data model, the
auth design, the progress-tracking approach and the trade-offs taken.

## Deploying

[docs/deploy-laravel-cloud.md](docs/deploy-laravel-cloud.md) is a step-by-step
guide to a live deployment on Laravel Cloud (which runs Node, not only PHP),
with managed Postgres. Its last section covers any other single-process host —
Render, Railway, Fly.io, a bare VM — since the three settings are the same.

Away from Compose there is no nginx to serve the SPA and proxy `/api`, so the
server serves the client build itself when it finds one next to its own
(`server/src/middlewares/serveClient.ts`). That keeps the API and the SPA on
one origin, which is what keeps the auth cookies first-party. Inside the
server's Docker image there is no client build, so under Compose the server
stays API-only and nginx keeps its job.

## Known limitations and next steps

- **Video is trusted to the client.** The server records positions the browser
  reports. A learner could script a 90% position without watching. Preventing
  that needs signed, segmented delivery (HLS with per-segment tokens) and
  server-side watch verification — a different problem from this assessment.
- **No audit log.** The activity feed is a projection over `enrollments` and
  `lesson_progress`, so it shows what is currently true rather than what
  happened. A real audit trail needs an append-only event table.
- **Video URLs are public.** Lessons store a plain URL. Production would want
  signed, expiring URLs behind a CDN.
- **No file uploads.** Thumbnails and videos are URLs or app-served paths;
  there is no storage layer.
- **No mail transport.** Password reset is implemented end to end — token,
  expiry, single use, session revocation — but nothing delivers the message
  yet: `server/src/lib/mailer.ts` logs it instead, so the link is followable
  from `docker compose logs server`. Mailtrap SMTP plugs into that one file.
  Email verification is still not implemented.
- **Catalog sorting by duration is sorted per page**, because duration is
  derived from lessons rather than stored. Correct global ordering needs a
  window function or a maintained column.
- **Single-region, single-instance assumptions.** Rate limiting is in-memory,
  so it is per-process; more than one API replica would need a shared store.
- **The design-fidelity check is not a pixel diff.** Tokens, structure, copy
  and per-screen composition were checked against the rendered artifact
  pages, but the running app has not been screenshot-compared against them:
  that needs browser automation, which this environment does not have. See
  the end of `docs/design-notes.md`.
