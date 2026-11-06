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
| **Tests** | 210 passing — 152 server (against a real Postgres) + 58 client (jsdom + MSW) |

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

All four use the password `Password123`.

| Email | Role | State |
|---|---|---|
| `admin@cadence.dev` | ADMIN | Author of the seeded courses |
| `ada@cadence.dev` | LEARNER | One course part-watched, one finished, one barely started |
| `kwame@cadence.dev` | LEARNER | One course completed, plus an archived course |
| `lina@cadence.dev` | LEARNER | Enrolled, nothing watched (the empty states) |

### URLs

| What | Where |
|---|---|
| App | <http://localhost:8080> |
| API (direct) | <http://localhost:4000/api/v1> |
| API docs (Swagger UI) | <http://localhost:4000/api/docs> |
| OpenAPI JSON | <http://localhost:4000/api/docs.json> |
| Postgres | `localhost:5432` (change with `DB_PORT`) |

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
| `npm run vendor:fonts` | Copy the self-hosted `.woff2` files out of `@fontsource` |
| `npm run thumbnails` | Regenerate the SVG course thumbnails |

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
test-server-1  |       Tests  152 passed (152)
test-client-1  |  Test Files  8 passed (8)
test-client-1  |       Tests  58 passed (58)

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
docker compose up -d db          # or point DATABASE_URL at your own Postgres

cp .env.example .env
# Outside Compose the host is localhost, not `db`:
#   DATABASE_URL=postgresql://cadence:cadence_dev_password@localhost:5432/cadence?schema=public

npm run db:migrate
npm run db:seed
npm run dev                      # API on :4000, client on :5173
```

On this path the client is served by Vite on `:5173` and proxies `/api` to the
API, so the browser still sees one origin. `CORS_ORIGIN` covers the case where
you serve them from genuinely different origins.

To run the server tests outside Docker, point `DATABASE_URL_TEST` at a
database whose name contains `test` (the suite refuses anything else, because
it resets the database it is given):

```bash
docker compose exec db psql -U cadence -d cadence -c "CREATE DATABASE cadence_test"
DATABASE_URL_TEST="postgresql://cadence:cadence_dev_password@localhost:5432/cadence_test?schema=public" \
  npm run test:server
```

---

## Environment variables

Copy `.env.example` to `.env`. Every variable has a working development
default, so the only reason to edit it is to change a port or set real
secrets.

| Variable | Required | Default | Notes |
|---|---|---|---|
| `POSTGRES_USER` | yes | `cadence` | Compose passes it to the `db` service |
| `POSTGRES_PASSWORD` | yes | `cadence_dev_password` | Change outside local use |
| `POSTGRES_DB` | yes | `cadence` | |
| `DATABASE_URL` | yes | `…@db:5432/cadence` | **Compose overrides this** with the `db` service name; set it yourself only on the non-Docker path |
| `DATABASE_URL_TEST` | tests only | `…@db-test:5432/cadence_test` | Must contain `test`; the suite resets it |
| `JWT_ACCESS_SECRET` | yes | dev placeholder | ≥ 32 chars. `openssl rand -base64 48` |
| `JWT_REFRESH_SECRET` | yes | dev placeholder | ≥ 32 chars, and must differ from the access secret in production |
| `ACCESS_TOKEN_TTL` | no | `15m` | |
| `REFRESH_TOKEN_TTL` | no | `7d` | Also the refresh cookie's `maxAge` |
| `BCRYPT_COST` | no | `12` | The test profile lowers it to 4 for speed |
| `NODE_ENV` | no | `production` | `development` enables pretty logs |
| `PORT` | no | `4000` | API port inside the container |
| `CORS_ORIGIN` | no | `http://localhost:5173` | Comma-separated allow-list; unused in Compose |
| `COOKIE_SECURE` | no | `false` | `true` only behind HTTPS |
| `LOG_LEVEL` | no | `info` | `silent` in tests |
| `CLIENT_PORT` | no | `8080` | Published host port for nginx |
| `API_PORT` | no | `4000` | Published host port for the API |
| `DB_PORT` | no | `5432` | Published host port for Postgres |
| `VITE_API_URL` | no | `/api/v1` | Baked in at client build time |

The server validates all of this with Zod at boot and **exits** on anything
invalid, rather than failing on the first request.

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
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `POST /auth/change-password`, `GET|PATCH /auth/me` |
| Catalog | `GET /courses`, `/courses/categories`, `/courses/:idOrSlug`, `/courses/:courseId/lessons`, `/lessons/:id` |
| Enrollment | `POST|DELETE /courses/:courseId/enroll`, `GET /courses/:courseId/enrollment`, `GET /enrollments/me` |
| Progress | `GET|PUT /lessons/:lessonId/progress`, `POST /lessons/:lessonId/complete`, `GET /progress/me` |
| Dashboards | `GET /dashboard/learner`, `GET /dashboard/admin`, `GET /activity/me` |
| Admin content | `GET|POST /admin/courses`, `GET|PATCH|DELETE /admin/courses/:id`, `PATCH /admin/courses/:id/status`, module and lesson CRUD, `PATCH /admin/modules/:id/lessons/reorder` |
| Admin people | `GET /admin/users`, `/admin/users/:id`, `/admin/users/:id/progress`, `PATCH /admin/users/:id`, `GET /admin/courses/:id/learners`, `GET /admin/activity` |

Authentication is cookie-based: login sets an httpOnly access cookie (15
minutes), a path-scoped httpOnly refresh cookie (7 days, rotated on use), and
a readable `csrf_token` cookie. Every `POST`/`PUT`/`PATCH`/`DELETE` must echo
that value in an `X-CSRF-Token` header.

---

## Troubleshooting

**Port already in use.** The most common clash is `5432`, if a PostgreSQL is
already installed on the host — Compose will start, but `localhost:5432` will
reach the wrong server. Change the published port and leave the container's
internal port alone:

```bash
# in .env
DB_PORT=55432
CLIENT_PORT=8081   # if 8080 is taken
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
- **No email.** So no password reset and no email verification.
- **Catalog sorting by duration is sorted per page**, because duration is
  derived from lessons rather than stored. Correct global ordering needs a
  window function or a maintained column.
- **Single-region, single-instance assumptions.** Rate limiting is in-memory,
  so it is per-process; more than one API replica would need a shared store.
- **The design-fidelity check was numeric, not visual** — see the note at the
  top of `docs/design-notes.md`.
