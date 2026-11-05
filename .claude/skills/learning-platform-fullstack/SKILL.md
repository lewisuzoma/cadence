---
name: learning-platform-fullstack
description: Build a full-stack online learning platform (React+TS+shadcn/ui+TanStack Query, Node+Express+TS, Prisma/Postgres) run in Docker Compose, matching the design artifacts in docs/desktop and docs/mobile, with self-hosted fonts.
---

# Full-Stack Learning Platform Builder

## 1. Role and standard

Act as a principal full-stack engineer, architect, UI/UX designer, database engineer, security engineer and QA engineer delivering a take-home assessment: a small but realistic online learning platform.

The result must **run locally with a few commands**, be **strongly typed end to end**, **persist everything in a real database**, be **secure**, **tested** and **documented**. It must show real engineering competence, not just an attractive frontend. Favor correctness, clarity and polish over feature sprawl. Don't add features beyond the spec; do everything in it.

Seed data is fine for demos, but every business operation goes through the real API and database. No mocked core logic, no decorative buttons, no TODOs in required paths. **Never claim a feature works, an API responds or a test passes unless you ran it.**

## 2. Start by inspecting the repository

Before writing code, check whether the repo is empty or already holds an app. If it holds one, note its frameworks, structure, dependencies, DB config, auth, UI components, API conventions, env config and tests. Preserve working code and improve it rather than replacing it, and adapt the layout below to fit. Then write a short implementation plan (a task list per phase) and **keep going: don't stop after the plan, schema or mockup.** When a requirement is ambiguous, make a sensible decision, record it under "Decisions & trade-offs" in ARCHITECTURE.md, and continue.

### 2a. Design artifacts: `docs/desktop/` and `docs/mobile/` are the visual source of truth

Before building any UI, study the design artifacts. **They override this skill's default visual suggestions** (colors, fonts, spacing, radius, shadows, layout, component styling, copy and iconography). They never override functional, security or accessibility requirements.

1. **Inventory**: list every file in both folders. View each image or PDF page with the Read tool (PNG, JPG, WebP, SVG, PDF). Read HTML, CSS or JSON exports directly. If a format can't be opened (a `.fig` file, say), say so and ask for a PNG, PDF or HTML export. Never modify or move files in `docs/`.
2. **Screen map**: write `docs/design-notes.md` with a table linking each artifact to its route and component (e.g. `docs/desktop/catalog.png → /courses → CatalogPage`), for both desktop and mobile. Note any required screen with no design (e.g. admin learner detail, 404). Build those by extending the design's language: same tokens, card styles and spacing rhythm.
3. **Extract design tokens** from the artifacts into `client/src/styles/globals.css` as shadcn CSS variables (in HSL or OKLCH): primary, secondary and accent colors; the neutral scale; background, card, border and ring colors; the status colors; radius; shadows; the spacing rhythm; the type scale (sizes, weights, line heights, letter spacing). When the design ships a CSS or JSON export, take exact values from it. Otherwise sample them from the images, rounded to a consistent scale. Record every token and where it came from in `design-notes.md`.
4. **Breakpoints**: match the desktop artifacts at their own width (usually 1280–1440 px) and the mobile artifacts at theirs (usually 375–390 px). Choose the Tailwind `screens` values so the layout switches where the design implies. Tablet interpolates between the two.
5. **Assets**: copy logos, illustrations and icons shown in the designs into `client/src/assets/`, and use Lucide only where the design uses generic icons. Never hot-link them.
6. **Fidelity check**: once a page is built, take screenshots at the artifact's viewport (Playwright, or the browser at that width) and compare them side by side with the artifact. Fix layout, spacing, type and color differences until the page matches closely. Log the intentional deviations in `design-notes.md`, such as an AA contrast fix, a missing state the design didn't show, or a shadcn constraint. Where the design shows no loading, empty or error state, design one in the same style.

## 3. Stack (use unless the repo has a compelling constraint)

| Layer | Choice |
|---|---|
| Monorepo | npm workspaces: `client/`, `server/`, `shared/` (Zod schemas + inferred types + enums used by both sides) |
| Frontend | React 18 + TypeScript (strict) + Vite, React Router v6 (data routers), **TanStack Query v5**, **shadcn/ui** (Radix + Tailwind CSS), React Hook Form + `@hookform/resolvers/zod`, Lucide React icons, Sonner toasts. Choose Vite over Next.js: this is an SPA talking to a separate API, so no SSR is needed (record the trade-off). |
| Backend | Node 20 + TypeScript + Express, Zod validation, Prisma ORM, PostgreSQL 16. No SQLite and no mocks. |
| Runtime | **Docker Compose runs the whole stack**: Postgres, a one-shot migrate + seed job, the API and the client. One command starts it from a clean clone (section 4a). Running locally without Docker is a documented secondary path. |
| Auth | bcrypt (cost 12). JWT access token (15m) + rotating refresh token (7d) stored **hashed** in the DB. Both are sent as `httpOnly` cookies (`Secure` in prod, `SameSite=Lax`, refresh cookie path-scoped to `/api/v1/auth`). Plus a double-submit CSRF token. |
| Security | helmet, CORS allow-list with credentials, express-rate-limit on auth routes, Zod on every input, central error handler, pino logger with redaction (no passwords, tokens or cookies) |
| API docs | `@asteasolutions/zod-to-openapi` generating OpenAPI from the same Zod schemas, served by `swagger-ui-express` at `/api/docs` |
| Testing | Vitest + Supertest against a real isolated Postgres test DB (the `db-test` Compose service). Vitest + React Testing Library + MSW for the client. Every suite also runs inside Compose. Optional: one Playwright happy path against the Compose stack. |
| Video | Native HTML5 `<video>` with custom shadcn-based controls. Seed with openly licensed sample MP4s (e.g., Blender open movies) and keep the URLs configurable per lesson. Add a `<track>` captions file where one is available. |

No other runtime dependencies unless they clearly earn their place. `@tanstack/react-table` is allowed for admin data tables (the shadcn data-table pattern).

## 4. Repository layout

```
learning-platform/
├─ client/src/
│  ├─ app/            (providers.tsx: QueryClientProvider, AuthProvider, Toaster, ThemeProvider; router.tsx)
│  ├─ components/ui/  (shadcn-generated primitives; owned code, edited for brand variants)
│  ├─ components/     (common/, layout/, courses/, lessons/, dashboard/, admin/)
│  ├─ features/<f>/   (auth, courses, enrollment, progress, admin): api.ts, queries.ts, hooks, components
│  ├─ lib/            (api-client.ts, query-client.ts, query-keys.ts, utils.ts (cn, formatDuration))
│  ├─ layouts/, pages/, routes/ (ProtectedRoute, RoleRoute), styles/globals.css
│  └─ test/           (setup.ts, msw handlers, render helpers)
├─ server/
│  ├─ prisma/         (schema.prisma, migrations/, seed.ts)
│  └─ src/
│     ├─ app.ts, server.ts, config/env.ts (Zod-validated env; fail fast)
│     ├─ middlewares/   (authenticate, requireRole, validate, csrf, rateLimit, errorHandler, notFound)
│     ├─ modules/<domain>/ {routes, controller, service, repository, schemas, openapi}
│     │    domains: auth, users, courses, modules, lessons, enrollment, progress, dashboard, admin
│     ├─ lib/           (prisma, jwt, password, errors (AppError hierarchy), pagination, response helpers)
│     └─ tests/         (unit/, integration/, helpers: createUser, loginAs, resetDb)
├─ shared/src/        (schemas/*.ts, types.ts, enums.ts)
├─ docs/              (desktop/ + mobile/ design artifacts: read-only; design-notes.md, architecture diagram, screenshots)
├─ docker-compose.yml (db, migrate, server, client; db-test + test runners under the `test` profile)
├─ docker-compose.dev.yml (hot-reload override), .dockerignore
├─ server/Dockerfile, client/Dockerfile, client/nginx.conf
├─ .env.example (root: read by Compose; documents every variable)
├─ README.md, ARCHITECTURE.md, package.json (workspace scripts)
```

Layering rule: **routes → controller (HTTP only) → service (business rules, transactions) → repository (Prisma only)**. Services never touch `req` or `res`. Controllers never call Prisma. React components never hold business rules: they call feature hooks.

## 4a. Running in Docker Compose (the primary way to run, test and review)

A reviewer must be able to run `cp .env.example .env && docker compose up --build` on a clean clone and get a working, seeded app at **http://localhost:8080**, with no Node or Postgres installed on the host.

**`docker-compose.yml`** (prod-like; the default):

| Service | Image / build | Role |
|---|---|---|
| `db` | `postgres:16-alpine` | Named volume `pgdata`; `healthcheck: pg_isready -U $POSTGRES_USER`; host port `${DB_PORT:-5432}` exposed only for local tools |
| `migrate` | `server` image, `command: npm run db:deploy-and-seed` | One-shot job: `prisma migrate deploy`, then the idempotent seed. `depends_on: db: condition: service_healthy`; `restart: "no"` |
| `server` | `server/Dockerfile` (target `runtime`) | Express API on 4000. `depends_on: migrate: condition: service_completed_successfully`. Health check `GET /api/v1/health` (returns 200 only once a DB `SELECT 1` succeeds). `restart: unless-stopped` |
| `client` | `client/Dockerfile` (target `runtime`) | nginx on 80, published as `${CLIENT_PORT:-8080}`. Serves the built SPA and **proxies `/api/` to `http://server:4000`**, so the browser sees a single origin. `depends_on: server: condition: service_healthy` |
| `db-test` | `postgres:16-alpine` | `profiles: [test]`; data on `tmpfs` (fast and disposable); never shares a volume with `db` |
| `test-server`, `test-client` | builder stage of each Dockerfile | `profiles: [test]`. Run `npm run test -w server` (against `db-test`) and `npm run test -w client`; exit with the tests' status code |

**Dockerfiles** (build context = repo root, so `shared/` is available; `.dockerignore` excludes `node_modules`, `dist`, `.env*` except `.env.example`, `.git`, coverage, and `docs/` for image builds):
- **`server/Dockerfile`**, multi-stage on `node:20-alpine`: `deps` (copy the root and workspace `package.json` files + lockfile, then `npm ci`) → `builder` (copy `shared/` + `server/`, `npx prisma generate`, build shared + server) → `runtime` (`NODE_ENV=production`, production dependencies only, the built `dist`, `prisma/` and the generated client; `apk add openssl`; runs as the non-root `node` user; `EXPOSE 4000`; `CMD ["node","dist/server.js"]`). In `schema.prisma`, set `binaryTargets = ["native", "linux-musl-openssl-3.0.x"]` so the engine works on Alpine.
- **`client/Dockerfile`**: `deps` → `builder` (`ARG VITE_API_URL=/api/v1`, `npm run build -w client`) → `runtime` on `nginx:alpine` with `client/nginx.conf`. That config provides SPA fallback (`try_files $uri /index.html`), `location /api/ { proxy_pass http://server:4000; }` with the `Host` / `X-Forwarded-*` headers, `Cache-Control: public, max-age=31536000, immutable` for hashed `/assets/*` (including the self-hosted `.woff2` fonts), `no-cache` for `index.html`, gzip, and basic security headers.
- No secrets are baked into images: everything arrives at runtime through `env_file: .env` / `environment:`. Inside Compose, `DATABASE_URL` uses the service name (`postgresql://…@db:5432/…`), never `localhost`.

**Same-origin cookies**: because nginx proxies `/api`, cookies are first-party and CORS isn't needed in Docker. Keep the CORS allow-list for the non-Docker dev path. Set `app.set('trust proxy', 1)` so rate limiting and `Secure` cookies work behind the proxy. `COOKIE_SECURE=false` in the local `.env` (plain http), `true` in production.

**`docker-compose.dev.yml`** (override for hot reload, run with `docker compose -f docker-compose.yml -f docker-compose.dev.yml up`): `server` runs the `builder` target with `tsx watch src/server.ts`; `client` runs Vite dev (`--host 0.0.0.0 --port 5173`, published on 5173, with a `/api` proxy to `http://server:4000` in `vite.config.ts`). Bind-mount `client/`, `server/` and `shared/`, use anonymous volumes for every `node_modules`, and set `CHOKIDAR_USEPOLLING=true` for Windows/macOS file watching.

**Root npm scripts**: `docker:up` (`docker compose up --build -d`), `docker:dev`, `docker:down`, `docker:reset` (`down -v` then `up --build`), `docker:logs`, `docker:seed` (`docker compose run --rm migrate npm run db:seed`), `docker:test` (`docker compose --profile test up --build --abort-on-container-exit --exit-code-from test-server test-server db-test`, then the same for `test-client`), `docker:migrate:dev` (create a new migration from inside the dev container).

**If Docker isn't available where you're building** (for example a sandbox without a Docker daemon): still write every Docker file, check them with `docker compose config` if the CLI exists, verify the app against a local Postgres instead, and list the Docker run under **"Implemented, not fully verified"** in the final report. Never claim the Compose stack works without having started it.


## 5. Data model (Prisma, UUID keys, `@db.Uuid` on Postgres)

- **User**: id, firstName, lastName, email (unique, stored lowercased), passwordHash, role `LEARNER|ADMIN` (default LEARNER), isActive (default true), createdAt, updatedAt
- **RefreshToken**: id, userId → User (cascade), tokenHash (unique), familyId, expiresAt, revokedAt?, createdAt
- **Course**: id, title, slug (unique), description, category, thumbnailUrl, difficulty `BEGINNER|INTERMEDIATE|ADVANCED`, status `DRAFT|PUBLISHED|ARCHIVED` (default DRAFT), createdById → User (restrict), publishedAt?, timestamps. Indexes: (status, category), (difficulty). The service **derives** `totalDurationSeconds` and `lessonCount` from the lessons and returns them as `estimatedDuration`. They aren't stored, so they can't drift (record the trade-off).
- **Module**: id, courseId → Course (cascade), title, order. `@@unique([courseId, order])`
- **Lesson**: id, moduleId → Module (cascade), courseId → Course (denormalized for fast enrollment checks; the service keeps it consistent), title, description, videoUrl, captionsUrl?, durationSeconds (> 0, checked in Zod + a DB CHECK through a raw-SQL migration), order, isPreview (default false), timestamps. `@@unique([moduleId, order])`, index on courseId
- **Enrollment**: id, userId → User (cascade), courseId → Course (restrict), status `ACTIVE|COMPLETED|CANCELLED`, enrolledAt, lastAccessedAt?, lastLessonId?, completedAt?. `@@unique([userId, courseId])`, index (userId, lastAccessedAt)
- **LessonProgress**: id, userId → User (cascade), lessonId → Lesson (cascade), lastPositionSeconds, maxWatchedSeconds (= watchedDuration), completionPercentage (0–100 int), isCompleted, completedAt?, updatedAt. `@@unique([userId, lessonId])`, index (userId, updatedAt)
- Do multi-step operations in `prisma.$transaction`: completing a lesson plus updating the enrollment, reordering lessons, and refresh-token rotation.

**Seed** (idempotent, using `upsert`): 1 admin and 3 learners (credentials in the README); 6 courses across 3 categories and all 3 difficulties (one DRAFT, one ARCHIVED), each with 2 modules and 2–4 lessons with real durations, one of them a preview; enrollments and partial or complete progress for one learner so both dashboards show data right away.

## 6. Authentication, authorization and security

- **Register**: firstName, lastName, email, password (≥ 8 characters, at least one letter and one number), confirmPassword (Zod `refine`). Duplicate email → 409. The role is always LEARNER; **ignore any role in the body**. Sets the auth cookies and returns `{ user }` without the hash.
- **Login**: generic `401 Invalid email or password` for any failure; inactive user → 403. Rate-limited to about 10 per 15 minutes per IP.
- **Refresh**: rotates the token. If a revoked token is reused, revoke the whole family (stolen-token detection). **Logout** revokes the token and clears the cookies.
- **CSRF**: on login or refresh, set a non-httpOnly `csrf_token` cookie. The client sends it as the `X-CSRF-Token` header on every POST, PUT, PATCH or DELETE, and the middleware compares the two (the auth routes are exempt before a session exists).
- `authenticate` verifies the access cookie and loads the user (rejecting inactive users). `requireRole('ADMIN')` returns 403 otherwise.
- **Object-level authorization**: take identity only from `req.user`, never from body, params or query. Progress and enrollment queries are always scoped by `userId = req.user.id`, which prevents IDOR. Admin routes live under `/admin/*` behind `requireRole`.
- Content access: learners see only PUBLISHED courses. A lesson is viewable if the user has an ACTIVE or COMPLETED enrollment, the lesson is `isPreview` on a published course, or the user is an admin. Otherwise 403 (404 for drafts, so they aren't revealed).

## 7. API (`/api/v1`, REST, documented in OpenAPI)

**Response envelope** (shared helpers; typed in `shared`):
```json
{ "success": true,  "message": "Course retrieved", "data": {}, "meta": { "page": 1, "pageSize": 12, "total": 40, "totalPages": 4 } }
{ "success": false, "message": "Validation failed", "code": "VALIDATION_ERROR", "errors": { "email": ["Invalid email"] } }
```
Status codes: 200/201/204, 400 validation, 401, 403, 404, 409 conflict, 422 business rule, 429, 500. The 500 response carries a generic message and nothing internal. Lists accept `?page&pageSize(≤ 50)&search&category&difficulty&status&sort`.

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me` |
| Catalog | `GET /courses` (published; includes the caller's enrollment status and progress % when signed in), `GET /courses/:idOrSlug` (modules → ordered lessons + per-lesson status), `GET /courses/:courseId/lessons`, `GET /lessons/:id` (access rules above; includes prev/next lesson ids) |
| Enrollment | `POST /courses/:courseId/enroll` (idempotent: returns the existing enrollment with 200, a new one with 201; 422 if the course is archived or has no lessons), `GET /courses/:courseId/enrollment`, `GET /enrollments/me` |
| Progress | `GET /lessons/:lessonId/progress`, `PUT /lessons/:lessonId/progress` `{ positionSeconds, event: 'heartbeat'\|'pause'\|'seeked'\|'hidden' }`, `POST /lessons/:lessonId/complete` `{ positionSeconds }` (idempotent), `GET /progress/me` |
| Dashboards | `GET /dashboard/learner`, `GET /dashboard/admin` |
| Admin content | `GET/POST /admin/courses`, `GET/PATCH/DELETE /admin/courses/:id`, `PATCH /admin/courses/:id/status`, `POST /admin/courses/:id/modules`, `PATCH/DELETE /admin/modules/:id`, `POST /admin/modules/:id/lessons`, `PATCH/DELETE /admin/lessons/:id`, `PATCH /admin/modules/:id/lessons/reorder` `{ lessonIds: [] }` (transactional) |
| Admin people | `GET /admin/users` (paginated, searchable), `GET /admin/users/:id`, `GET /admin/users/:id/progress`, `PATCH /admin/users/:id` (isActive), `GET /admin/courses/:id/learners`, `GET /admin/activity` |

Rules: DELETE on a course with enrollments → 409, telling the admin to archive it instead. Publishing a course with no lessons → 422. Archived courses disappear from the catalog and block new enrollments, but enrolled learners keep access. Reordering never touches progress, because progress is keyed by lessonId.

## 8. Progress and completion (core logic; pure functions in `progress.calculator.ts`, unit tested)

- Clamp the position to `[0, durationSeconds]`. `lastPositionSeconds` takes the latest value (used for resume). `maxWatchedSeconds = max(prev, position)`, so it never decreases. `completionPercentage = round(maxWatched / duration * 100)`, set to 100 once completed.
- **Completion threshold** (one constant, documented): the lesson completes when `maxWatchedSeconds ≥ 0.9 × duration`, or when `POST /complete` arrives with `positionSeconds ≥ duration − 2` (the video `ended` event). Opening a lesson never completes it. A completion request that fails the check → 422.
- **Sticky and idempotent**: once `isCompleted`, the lesson stays completed. Replays keep updating `lastPositionSeconds` but never reset completion or `completedAt`. Duplicate completion calls return 200 with the existing record. All writes are upserts on `(userId, lessonId)`, which makes concurrent heartbeats safe.
- In the same transaction: update `Enrollment.lastAccessedAt` and `lastLessonId`. When all lessons are complete, set the enrollment to COMPLETED and fill `completedAt`.
- **Course progress** = completed lessons ÷ total lessons, computed on the server (a course with no lessons counts as 0%). The client never computes the authoritative number.
- Progress writes require an active enrollment and a lesson that belongs to it (403 otherwise). Preview viewers without an enrollment are not tracked.

## 9. Frontend data layer: TanStack Query

- **`lib/api-client.ts`**: a typed `fetch` wrapper with `credentials: 'include'`, the `X-CSRF-Token` header taken from the cookie, envelope unwrapping, and a thrown `ApiError { status, code, message, fieldErrors }`. On a 401 it calls `/auth/refresh` **once** using a shared in-flight promise (single-flight), retries, and on failure clears the auth cache and redirects to `/login?next=`.
- **`lib/query-client.ts`**: `staleTime: 30_000`, `gcTime: 5 min`; `retry: (n, err) => !(err instanceof ApiError && err.status < 500) && n < 2`; `refetchOnWindowFocus: true` except for player queries. A global `MutationCache.onError` shows a Sonner toast unless the mutation opts out with `meta.silent`.
- **`lib/query-keys.ts`**: a key factory, for example `qk.courses.list(filters)`, `qk.courses.detail(id)`, `qk.lessons.detail(id)`, `qk.progress.lesson(id)`, `qk.enrollments.me()`, `qk.dashboard.learner()`, `qk.dashboard.admin()`, `qk.admin.courses(filters)`, `qk.admin.users(filters)`, `qk.auth.me()`. Never write inline array keys.
- Feature hooks wrap `queryOptions(...)`: `useCourses(filters)` with `placeholderData: keepPreviousData` for pagination, `useCourse`, `useLesson`, `useLessonProgress`, `useLearnerDashboard`, `useAdminStats`, `useAdminCourses`, `useAdminUsers`. Prefetch the course detail on CourseCard hover or focus.
- **Mutations + invalidation map**: `useEnroll` (optimistic update to the course detail/list with rollback in `onError`, then invalidate courses, enrollments and the learner dashboard); `useCompleteLesson` (write the result with `setQueryData`, then invalidate the course detail, progress, enrollments and dashboard); admin CRUD mutations invalidate `qk.admin.*` and `qk.courses.*`. Auth: `useMe` (`retry: false`, `staleTime: Infinity`), `useLogin`/`useRegister` set `qk.auth.me()`, and `useLogout` calls `queryClient.clear()`.
- **Progress tracking is not a `useMutation` per tick.** `useLessonProgressTracker(lessonId, videoRef)` throttles saves to at most one every 10 s, and only when the position moved by more than 2 s. It flushes on `pause`, `seeked`, `visibilitychange` → hidden, `pagehide` and unmount (using `fetch(..., { keepalive: true })` so the cookie and CSRF header are sent; `sendBeacon` can't set headers). It calls `complete` on `ended` and updates the `qk.progress.lesson` cache in place. Server state stays in TanStack Query; React context is used only for auth and theme, and nothing about auth or progress lives in localStorage.

## 10. UI system: shadcn/ui

- Initialize with `npx shadcn@latest init` (Tailwind, CSS variables, `@/` alias). Add: `button card badge progress input label form textarea select checkbox switch slider dialog alert-dialog sheet dropdown-menu avatar tabs table skeleton sonner tooltip separator scroll-area breadcrumb pagination sidebar chart`. The files in `components/ui` are owned code: extend them, don't wrap them in a parallel UI kit.
- **Design tokens** live in `globals.css` as CSS variables, **taken from the design artifacts (section 2a)**: primary, secondary, muted/neutral scale, success, warning, destructive, info; radius; shadow scale; type scale (display/h1/h2/h3/body/small/caption); spacing rhythm. Fall back to these defaults only for values the design doesn't define: one indigo/violet accent, radius `0.75rem`, subtle shadows, a 4-px grid. Map the shadcn theme variables (`--primary`, `--card`, `--radius`, …) to those tokens so every primitive picks up the design automatically. Summarize them in ARCHITECTURE.md.
- **Fonts are self-hosted. They never come from a CDN.**
  - **Which fonts**: the families and weights the design uses (from its CSS or JSON export, or identified from the artifacts). If a font can't be identified, or is proprietary and its files aren't in the repo, use the closest open-licensed match and note the substitution in `design-notes.md`.
  - **Where the files come from**, in this order: font files shipped in `docs/` or elsewhere in the repo; then the `@fontsource` / `@fontsource-variable` npm package for that family (npm is reachable). Copy only the `.woff2` files for the weights and subsets in use (usually latin) into `client/src/assets/fonts/<family>/`, with the font's license file (e.g. `OFL.txt`) beside them. Prefer one variable font file over several static weights when one exists. Don't fetch from fonts.googleapis.com, and don't leave runtime `@import` lines pointing at remote URLs.
  - **`client/src/styles/fonts.css`** (imported first in `globals.css`): one `@font-face` per file, with `font-family`, `src: url('../assets/fonts/...woff2') format('woff2')`, `font-weight` (a range for variable fonts), `font-style`, `font-display: swap` and a latin `unicode-range`. Define `--font-sans` (plus `--font-heading` / `--font-mono` if the design uses them) with a system fallback stack, and point Tailwind's `fontFamily.sans` (and `heading` / `mono`) at those variables.
  - **Preload**: in `client/index.html`, preload only the main body font, using `<link rel="preload" as="font" type="font/woff2" crossorigin>` (or Vite's `?url` import). Optionally add a fallback `@font-face` with `size-adjust` so text doesn't jump when the font loads.
  - **Verify**: the production build emits hashed `.woff2` files in `dist/assets`; the browser Network tab shows no requests to external font hosts; `grep -r "fonts.googleapis\|fonts.gstatic" client/` returns nothing; headings and body text render in the design's fonts at every breakpoint.
- **Variants via `cva`**: extend `Badge` with `success | warning | info | outline` for the status badges (Not started / In progress / Completed / Draft / Published / Archived / Preview / Locked). Each pairs a Lucide icon with text, so color never carries the meaning alone. Card variants: `default`, `interactive` (hover lift + focus ring), `media` (16:9 header).
- **Domain components** (reusable, props-typed from `shared`, with no fetching inside presentational components):
  - `CourseCard`: thumbnail (`AspectRatio` 16:9, lazy, alt text), category + difficulty badges, title, description clamped to 2 lines, duration ("1h 24m · 8 lessons"), enrollment status badge, `Progress` bar + %, and an Enroll / Continue / View CTA. It also has a `CourseCardSkeleton`.
  - `LessonCard` / `LessonList`: order number, title, duration, status icon, mini progress bar, current-lesson highlight (`aria-current`), lock icon for gated lessons; grouped by module in an `Accordion` or sections; scrollable inside `ScrollArea`.
  - `LessonVideoPlayer`: wrapped in a `Card`. Controls: play/pause, seek `Slider` (shows buffered + watched), time display, volume `Slider` + mute, playback-speed `DropdownMenu` (0.5–2×), captions toggle (when a track exists), fullscreen, and a Replay button on end. Keyboard: Space/K, ←/→ ±5 s, ↑/↓ volume, M, F, C. Every control has an `aria-label` and a `Tooltip`. Resume: on `loadedmetadata`, seek to `lastPositionSeconds` if it's over 5 s and the lesson is incomplete, then show a toast: "Resumed from 3:42 · Start over". On completion, overlay "Lesson complete ✓" with a Next lesson button.
  - `StatCard`, `EmptyState` (Lucide illustration + message + CTA), `ErrorState` (message + Retry calling `refetch`), `PageHeader`, `ConfirmDialog` (AlertDialog), `DataTable` (shadcn Table + `@tanstack/react-table`, with server-side pagination, sorting and filters).
- **Forms**: shadcn `Form` + React Hook Form + the **shared** Zod schemas. Show inline `FormMessage` errors with `aria-invalid`/`aria-describedby`, map server `fieldErrors` back with `setError`, and disable submit with a spinner while pending. Never use `alert()` or `confirm()`.

## 11. Pages, layout and navigation

- **App shell**: a shadcn `Sidebar` on desktop that collapses to icons on tablet and becomes a `Sheet` drawer on mobile. Top bar holds search and an avatar `DropdownMenu` (Profile, Log out).
- **Learner nav**: Dashboard, Explore Courses, My Learning, Profile. **Admin nav**: Overview, Courses, Lessons, Learners, Activity, Settings (Settings is a basic profile/password page, not a decorative link).
- `/login`, `/register`: centered card forms.
- `/courses` **Catalog**: search with a 300 ms debounce, plus category and difficulty filters synced to URL search params; a responsive grid (1 → 2 → 3 → 4 columns); `Pagination`.
- `/courses/:slug` **Course detail**: hero (thumbnail, meta, difficulty, total duration, lesson count, Enroll/Continue button, overall progress), "What you'll learn" description, and module-grouped lesson cards.
- `/courses/:slug/lessons/:lessonId` **Focused lesson view**: `Breadcrumb` (Courses › Course › Lesson). On desktop it's a two-column layout: the main card (~2/3) holds the player, the lesson title, the completion badge with completion date, the description and Previous/Next buttons; the side column holds "Up next" plus the full lesson list with status and progress. On mobile the side column stacks below the player.
- `/dashboard` **Learner**: StatCards (enrolled, in progress, completed courses, lessons completed, overall %), a "Continue learning" card (thumbnail, course, last lesson, %, Continue button that resumes at the saved position), My Courses grid, and Recent Activity (watched lessons, completions, enrollments). New learners get an empty state with a "Browse courses" button.
- `/my-learning`: enrolled courses in Tabs (In progress / Completed).
- `/admin` **Overview**: StatCards (learners, courses, published, draft, enrollments, completed lessons), a shadcn `chart` of enrollments and completion rate per course, and a recent activity feed.
- `/admin/courses`: DataTable with status filter, search, Publish/Unpublish/Archive actions, a Create/Edit course `Dialog` (or a full page on mobile) with a thumbnail URL field and live preview, and delete through ConfirmDialog (it surfaces the 409 "archive instead" message).
- `/admin/courses/:id/lessons` (also reachable from Lessons nav): modules and lessons editor with add/edit/delete, video URL, duration, description, preview `Switch`, and up/down reordering buttons that stay keyboard accessible.
- `/admin/learners` + `/admin/learners/:id`: paginated and filterable table, then a detail page with enrollments, per-lesson completion, overall progress, and an activate/deactivate toggle. `/admin/activity`: a paginated feed.
- **Every screen handles loading (skeletons), empty, success (toasts), error (retry), unauthorized (403 page) and not found (404 page)** states. `ProtectedRoute` redirects to `/login?next=…`. `RoleRoute` renders 403. The server stays the source of truth.
- **Responsive**: no horizontal overflow at 360 px, touch targets ≥ 44 px, and a fluid video. **Accessibility (WCAG 2.1 AA)**: semantic landmarks, a skip link, visible focus rings, labelled controls, focus-trapped dialogs (Radix), `aria-live` toasts, AA contrast, `prefers-reduced-motion`.

## 12. Tests (write them alongside each phase; all must pass)

The server tests run against a real Postgres test DB: the `db-test` Compose service, reached through `DATABASE_URL_TEST`. Vitest `globalSetup` runs `prisma migrate reset --force --skip-seed`, and tables are truncated between files. `npm run docker:test` runs the server and client suites inside Compose and exits with the tests' status code. Never mock Prisma to claim the DB integration works.

- **Unit**: progress calculator (clamping, monotonic max, percentage, 90% rule, `ended` tolerance, sticky completion, course % including the zero-lesson case), password hashing, JWT helpers, pagination helper, Zod schemas.
- **Integration (Supertest with a cookie agent)**: register (validation, duplicate → 409, role injection ignored), login (success, wrong password, inactive), `/me` without a cookie → 401, refresh rotation + reuse detection, logout, CSRF missing → 403; learner → 403 on every `/admin/*` route; course CRUD + publish rules + delete-with-enrollments 409; lesson CRUD + reorder; enroll idempotency and archived/empty-course 422; lesson access without enrollment → 403 (preview allowed); progress save + resume value + completion + duplicate complete; IDOR (learner A can't read or write learner B's progress); learner and admin dashboard aggregates match the seeded fixtures.
- **Workflows**: **A** register → login → browse → enroll → open lesson → save progress → GET progress returns the resume position → complete → course % updates. **B** admin login → create course → add module and lessons → publish → the course appears in the learner catalog. **C** learner calls an admin endpoint → 403.
- **Client (RTL + MSW)**: login/register validation and server errors; ProtectedRoute/RoleRoute redirects; CourseCard renders every field and each status; catalog loading, empty and error states; the enroll button's optimistic update; LessonList statuses and current indicator; the player resumes, throttles saves, flushes on pause and calls complete on ended (fake timers + mocked `HTMLMediaElement`); dashboard StatCards render API data; admin-only nav hidden for learners.
- Also run `tsc --noEmit` (strict everywhere, no `any` without a comment justifying it) and ESLint with zero errors. Optional: `vitest --coverage`.

## 13. Build phases (verify each one before moving on; tick them off in the task list)

1. **Foundation**: inspect the repo, then **review `docs/desktop` and `docs/mobile`, write `docs/design-notes.md` (screen map + tokens), self-host the fonts and set up the design tokens**. Scaffold the workspaces, strict tsconfig, ESLint/Prettier, **the Dockerfiles, `docker-compose.yml`, `docker-compose.dev.yml`, `.dockerignore` and the health endpoint (section 4a); confirm `docker compose up --build` brings up db + server + client before writing features**, `.env.example`, env validation, response/error helpers, OpenAPI wiring, and shadcn init themed to the design.
2. **DB + auth**: schema, migration, seed (run it), auth + CSRF + RBAC middleware, auth tests.
3. **Content + enrollment**: course/module/lesson CRUD, validation, access rules, enrollment, tests.
4. **Learner experience**: catalog, course detail, focused lesson view, player, progress tracker, resume, completion, tests.
5. **Dashboards**: server aggregations (computed in SQL or Prisma `groupBy`/`_count`, never in loops over every row), learner and admin dashboards, tests.
6. **Admin**: course, lesson and learner management, activity, tests.
7. **QA**: all tests, typecheck, lint, `prisma migrate deploy` on a fresh DB, a manual run of workflows A/B/C in the browser, responsive checks at 360/768/1280 px, keyboard-only pass, **a design-fidelity pass comparing every designed screen against its desktop and mobile artifact, and a check that the fonts load locally with no external font requests**.
8. **Docs + delivery** (below). From a clean clone, run `docker compose down -v` then `docker compose up --build`, and check that the seeded accounts can log in at http://localhost:8080. Run every README command.

## 14. Deliverables

The output is a working repository, not code pasted into chat. The final report maps it to the assessment sections:

1. **Data model & schema**: `server/prisma/schema.prisma`, migrations, `seed.ts`.
2. **Backend**: entry point and DB setup, middlewares, Zod DTOs in `shared/`, modules for auth, courses, lessons, enrollment, progress, dashboards and admin, and the OpenAPI docs at `/api/docs`.
3. **Frontend**: API client and TanStack Query setup, shadcn UI system, CourseCard / LessonVideoPlayer / LessonList, and the pages from section 11.
4. **Tests**: unit, integration and workflow suites, plus client tests.
5. **Documentation**:
   - **README.md**: overview + screenshots; prerequisites (Docker Desktop or Docker Engine + the Compose v2 plugin; Node 20 only for the non-Docker path); **Docker quick start** (`cp .env.example .env` → `docker compose up --build` → open http://localhost:8080); dev mode with hot reload (`npm run docker:dev`); running the tests in Docker (`npm run docker:test`); reset (`npm run docker:reset`); logs and troubleshooting (port clashes, `docker compose logs -f server`, rebuilding after dependency changes); and the secondary local path (`npm install` → `docker compose up -d db` → `npm run db:migrate` → `npm run db:seed` → `npm run dev`); ports and URLs (client, API, `/api/docs`); seeded accounts; scripts table (`dev`, `build`, `start`, `test`, `test:server`, `test:client`, `lint`, `typecheck`, `db:reset`); **env var table** (`DATABASE_URL`, `DATABASE_URL_TEST`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL`, `CORS_ORIGIN`, `COOKIE_SECURE`, `PORT`, `NODE_ENV`, `VITE_API_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `CLIENT_PORT`, `API_PORT`, `DB_PORT`), each noting whether Compose sets it with required/default/description; **actual test output** (the pasted summary); API overview; known limitations and next steps.
   - **ARCHITECTURE.md** (about 1–2 pages): Mermaid diagram of the Compose services (nginx client → /api proxy → server → db; migrate job; db-test); layering; shared Zod as the single source of truth (validation, types, OpenAPI, forms); auth design (httpOnly cookies + rotation + CSRF vs. localStorage/sessions); data model and constraints; the video tracking approach (throttled heartbeats, keepalive flush, 90% threshold, the client-trust limitation); TanStack Query strategy (keys, invalidation, optimistic updates); how the design artifacts became tokens and components (link to `docs/design-notes.md`); the self-hosted font setup; Postgres vs. SQLite and Vite vs. Next.js; why nginx serves the client on the same origin as the API (no CORS, simple cookies); the dev vs. prod-like Compose setups; trade-offs and future work (signed video URLs/CDN, HLS, uploads, caching, audit log, CI, E2E, i18n).

## 15. Engineering rules (mandatory)

TypeScript everywhere; no unjustified `any`. Don't duplicate business logic (it lives in one service or pure function). Keep components small and reusable, and keep presentation separate from logic. Validate all untrusted input. Enforce authorization on the server. Never hardcode dashboard numbers. Never use localStorage as the source of truth for auth or progress. Never mark a lesson complete just because it was opened. No decorative buttons, no TODOs in critical paths, no swallowed errors (log them and surface them), no unnecessary dependencies, and don't overwrite working code you don't understand. Keep the docs matching the code.

## 16. Definition of done

- [ ] Register, login, logout, refresh and protected routes work; learner and admin interfaces are separated and enforced on the server
- [ ] The catalog has search, filters and pagination; course cards show every required field; course detail works; enrollment works and is idempotent
- [ ] Lesson view: the player has play/pause/seek/volume/speed/fullscreen/replay; position persists; resume works; completion is triggered at the end or threshold and is sticky; progress indicators update everywhere
- [ ] The learner and admin dashboards show real aggregates; course, module, lesson and learner management all work
- [ ] Loading, empty, error, 403 and 404 states exist everywhere; the layout is responsive at 360–1440 px; keyboard and screen-reader basics pass
- [ ] Every designed screen matches its `docs/desktop` and `docs/mobile` artifact, and the deviations are logged in `docs/design-notes.md`
- [ ] The fonts are self-hosted `.woff2` files with their licenses, loaded through `@font-face` with `font-display: swap`; there are zero requests to external font hosts
- [ ] DB constraints are enforced; migrations run on a fresh DB; seed runs twice without errors
- [ ] `docker compose config` is valid; after `docker compose down -v`, `docker compose up --build` from a clean clone brings every service up healthy and the seeded logins work at http://localhost:8080; `npm run docker:test` passes; `npm run docker:dev` hot-reloads both apps
- [ ] OpenAPI docs are served; the README and ARCHITECTURE.md are complete and accurate
- [ ] `npm test`, `npm run typecheck` and `npm run lint` pass (actually run)

## 17. Final delivery report

Keep it concise: overview, stack, architecture decisions, DB structure, features, security approach, API docs location, setup and run commands, test commands with **real** results, seeded accounts, and limitations and future work. Sort every feature into one of three groups: **Implemented & verified** / **Implemented, not fully verified** / **Not implemented**. Don't exaggerate how complete it is.