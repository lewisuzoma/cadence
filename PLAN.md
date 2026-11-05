# Build plan — Cadence learning platform

Tracking the skill's 8 phases. Status: [ ] todo · [~] in progress · [x] done & verified

## Phase 1 — Foundation
- [ ] Inspect repo + tooling (node/npm/docker)
- [ ] Review docs/desktop + docs/mobile artifacts (10 pages each, PDF)
- [ ] docs/design-notes.md: screen map, tokens, fonts, deviations
- [ ] Self-host fonts (.woff2 + licenses, @font-face)
- [ ] npm workspaces: client/ server/ shared/ + strict tsconfig, ESLint/Prettier
- [ ] Dockerfiles, docker-compose.yml, docker-compose.dev.yml, .dockerignore, nginx.conf
- [ ] .env.example, Zod env validation, response/error helpers, OpenAPI wiring, /health
- [ ] shadcn init themed to the design
- [ ] VERIFY: docker compose up --build brings db + server + client up healthy

## Phase 2 — DB + auth
- [ ] schema.prisma + migration + CHECK constraint, idempotent seed (run twice)
- [ ] bcrypt, JWT access/refresh rotation, httpOnly cookies, CSRF, RBAC middleware
- [ ] auth tests (register/login/refresh reuse/logout/CSRF/403)

## Phase 3 — Content + enrollment
- [ ] course/module/lesson CRUD + validation + access rules
- [ ] idempotent enrollment, publish/archive rules
- [ ] integration tests

## Phase 4 — Learner experience
- [ ] catalog, course detail, focused lesson view
- [ ] LessonVideoPlayer (play/pause/seek/volume/speed/fullscreen/replay/captions/keyboard)
- [ ] progress tracker (throttle/flush/resume/sticky completion)
- [ ] tests

## Phase 5 — Dashboards
- [ ] server aggregates (groupBy/_count, no row loops)
- [ ] learner + admin dashboards, tests

## Phase 6 — Admin
- [ ] courses, modules/lessons editor + reorder, learners, activity
- [ ] tests

## Phase 7 — QA
- [ ] npm test, typecheck, lint
- [ ] migrate deploy on fresh DB, seed twice
- [ ] workflows A/B/C against Compose
- [ ] responsive 360/768/1280, keyboard pass
- [ ] design fidelity pass vs artifacts; zero external font requests

## Phase 8 — Docs + delivery
- [ ] README.md, ARCHITECTURE.md, design-notes.md
- [ ] clean-clone docker compose down -v && up --build
- [ ] npm run docker:test
- [ ] final report
