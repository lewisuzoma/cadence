# Build plan — Cadence learning platform

Status: `[x]` done & verified · `[~]` implemented, not fully verified · `[ ]` not done

## Phase 1 — Foundation
- [x] Inspect repo and tooling (Node 24 host, Docker 29, npm 10)
- [x] Read `docs/desktop` + `docs/mobile` (10 vector PDF pages each)
- [x] `docs/design-notes.md`: screen map, tokens, fonts, deviations
- [x] Self-host fonts (3 variable `.woff2` + OFL licences, `@font-face`)
- [x] npm workspaces `client/ server/ shared/`, strict tsconfigs
- [x] ESLint (type-aware) + Prettier, zero warnings
- [x] Dockerfiles, `docker-compose.yml`, `docker-compose.dev.yml`, `.dockerignore`, `nginx.conf`
- [x] `.env.example`, Zod env validation (exits on invalid), response/error helpers
- [x] OpenAPI generated from the shared Zod schemas, served at `/api/docs`
- [x] `/api/v1/health` gated on a real `SELECT 1`
- [x] VERIFY: `docker compose up --build` brings db + migrate + server + client up healthy

## Phase 2 — DB + auth
- [x] `schema.prisma`, init migration, raw-SQL CHECK-constraint migration
- [x] Idempotent seed: 1 admin, 3 learners, 8 courses, 47 lessons — run twice, identical counts
- [x] bcrypt, JWT access + rotating refresh (hashed, family revocation), httpOnly cookies
- [x] Double-submit CSRF, `authenticate` / `requireRole`, rate limiting
- [x] Auth tests: register, login, refresh reuse detection, logout, CSRF, deactivation

## Phase 3 — Content + enrollment
- [x] Course / module / lesson CRUD with Zod validation
- [x] Visibility rules (draft → 404, archived keeps enrolled learners)
- [x] Idempotent enrollment (201 new / 200 existing), publish and archive rules
- [x] Transactional lesson reordering that never moves progress
- [x] Integration tests incl. delete-with-enrollments → 409

## Phase 4 — Learner experience
- [x] Catalog with URL-synced search, filters, sort, pagination
- [x] Course detail with module-grouped curriculum
- [x] Focused lesson view, two-column at desktop width
- [x] `LessonVideoPlayer`: play/pause, seek, volume, speed, captions, fullscreen, replay, keyboard
- [x] `useLessonProgressTracker`: 10s throttle, 2s delta, flush on pause/seek/hide/unmount
- [x] Resume from saved position with a "Start over" action
- [x] Sticky, idempotent completion decided by the server
- [x] Tests: player tracker, lesson list, catalog states, optimistic enrol

## Phase 5 — Dashboards
- [x] Server aggregates in SQL (`groupBy`, `COUNT FILTER`, `UNION ALL` feed) — no row loops
- [x] Learner dashboard: stats, continue-learning, my courses, recent activity
- [x] Admin overview: stats, per-course chart + equivalent table, activity feed
- [x] Tests asserting aggregates against fixtures

## Phase 6 — Admin
- [x] Course table: status filter, search, publish/unpublish/archive, create/edit dialog
- [x] Delete with the 409 "archive instead" surfaced in the confirm dialog
- [x] Course editor: modules, lessons, preview toggle, keyboard-accessible reordering
- [x] Publishing checklist computed from the real course
- [x] Learners table + learner detail, activate/deactivate
- [x] Activity feed, paginated

## Phase 7 — QA
- [x] `npm test` — 152 server + 58 client = 210 passing
- [x] `npm run typecheck` — clean across shared, server, client
- [x] `npm run lint` — clean, zero warnings
- [x] `prisma migrate deploy` on a fresh database (via the Compose migrate job)
- [x] Seed run twice, no duplicates
- [x] Workflows A / B / C against the Compose stack over nginx — 27/27 checks
- [x] `npm run docker:test` passes inside Compose
- [x] `npm run docker:dev` hot-reloads the server (verified by restart) and serves Vite HMR
- [x] Zero external font requests (`grep` clean; fonts fingerprinted into `dist/assets`)
- [~] Responsive 360/768/1280 and keyboard pass — built to the breakpoints and
      keyboard paths, but not verified in a real browser (no browser automation
      available in this environment)
- [x] Artifacts rasterised and compared: player accent, avatar, brand mark,
      selection colour, card composition and thumbnail art all corrected
- [x] Mobile artifact pages 9–10 (the "app" screens) built as responsive web
- [~] Pixel-level screenshot diff of the running app — needs browser
      automation, unavailable here (see the end of `docs/design-notes.md`)

## Phase 8 — Docs + delivery
- [x] `README.md`: Docker quick start, dev mode, tests, reset, troubleshooting,
      non-Docker path, env table, seeded accounts, URLs, real test output
- [x] `ARCHITECTURE.md`: Compose diagram, layering, auth, data model, progress,
      TanStack strategy, design-to-token pipeline, trade-offs, future work
- [x] `docs/design-notes.md`
- [x] Clean-slate `docker compose down -v && up --build` verified
- [x] Final report

## Not implemented (deliberate, recorded)
- Artifact elements with no data model behind them: streaks, weekly goal,
  recommendations, instructor profiles, trailers, transcripts, drop-off
  analytics, trend deltas, "keep me signed in", forgot password. Each is listed
  with its reasoning in `docs/design-notes.md`
