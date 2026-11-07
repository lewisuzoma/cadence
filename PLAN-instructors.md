# Instructor feature — implementation plan

Branch `feature/instructors`. Baseline before any change: **194 server tests
passing**, client suite passing, typecheck and lint clean.

## 0. Repository analysis (section 3 of the prompt)

| # | Question | Finding |
|---|---|---|
| 1 | User model, role enum, how `role` reaches `req.user` | `User{id, firstName, lastName, email, passwordHash, role, isActive, timestamps}`; `enum Role { LEARNER ADMIN }`. **`authenticate` loads the row from the DB on every request** (`middlewares/authenticate.ts` → `loadUser`), so the JWT is trusted for identity only. Nothing to redesign: adding instructor status to that same `select` makes approvals and suspensions take effect on the user's *next request* with no token version needed. |
| 2 | RBAC middleware | `authenticate`, `optionalAuthenticate`, `requireRole(...roles)` in `middlewares/authenticate.ts`. Admin-only checks live in `routes.ts` on one `admin` sub-router (`admin.use(authenticate, csrfProtection, requireRole('ADMIN'))`), plus scattered `user?.role === 'ADMIN'` reads inside `courses.service.ts`, `lessons.service.ts`, `guards.tsx`, `AppLayout.tsx`. |
| 3 | Content models | `Course{…, createdById → User (Restrict), status, publishedAt}`, `Module{courseId, title, order}`, `Lesson{moduleId, courseId (denormalised), title, description, videoUrl, captionsUrl?, durationSeconds, order, isPreview}`, `Enrollment{userId, courseId, status, enrolledAt, lastAccessedAt, lastLessonId, completedAt}`, `LessonProgress{userId, lessonId, lastPositionSeconds, maxWatchedSeconds, completionPercentage, isCompleted, completedAt}`. **Ownership field already exists: `Course.createdById`.** |
| 4 | Course/lesson CRUD | `coursesService` (create/update/setStatus/remove) and `lessonsService` (modules + lessons + transactional reorder), called from the `/admin/*` routes. No `actor` parameter today — admin identity is assumed. |
| 5 | Dashboards, nav, guards | `AppLayout` (learner top bar + `MobileTabBar`) and `AdminLayout` (246 px sidebar) in `layouts/AppLayout.tsx`; `ProtectedRoute` / `RoleRoute` / `GuestRoute` in `routes/guards.tsx`; routes in `app/router.tsx` with the admin pages code-split. |
| 6 | Upload support | **None.** Videos are plain `videoUrl` strings; thumbnails are plain `thumbnailUrl` strings. Storage must be built from scratch (phase D). |
| 7 | Notifications | **None in-app.** Sonner toasts only (`MutationCache.onError` → toast). `lib/mailer.ts` exists for password-reset email. A `Notification` table and bell are new work. |
| 8 | Seed / tests / Compose / OpenAPI | `prisma/seed.ts` (idempotent upserts); helpers `createUser`, `loginAs`, `registerAndLogin`, `createCourse`, `resetDb` (TRUNCATE list — **must be extended with the new tables**); Compose services `db`, `migrate`, `server`, `client`, `db-test`, `test-server`, `test-client`; OpenAPI built in `server/src/openapi.ts` from the shared Zod schemas. |
| 9 | Reusable frontend | `CourseCard`, `LessonList`, `LessonVideoPlayer`, `UpNextList`, `StatCard`, `ActivityRow`, `ContinueLearningCard`, `PageHeader`, `ConfirmDialog`, `Pagination`, `States` (Empty/Error/Loading), `StatusBadge`; `qk` key factory in `lib/query-keys.ts`. shadcn primitives present; **no `chart` component and no `@dnd-kit`** — both are new. `recharts` and `@tanstack/react-table` are already dependencies. |

### Decisions taken from the analysis

- **Reuse `Course.createdById` as the owner.** No rename: it already carries
  the semantics, every existing row has a value, and renaming would touch
  the catalog, dashboard and admin queries for no behavioural gain. The code
  refers to it through an `ownerId` alias in the service signatures.
- **No `tokenVersion` column.** `authenticate` already re-reads the user row
  per request; adding the instructor-profile status to that read gives the
  "effective on the next request" guarantee the prompt asks for. Refresh
  families are still revoked on suspension so a stolen refresh token cannot
  outlive the decision.

## Phases

### A — foundation: schema, permissions, ownership, sessions
- [ ] A1 `shared/enums.ts`: `INSTRUCTOR` role, `InstructorApplicationStatus`, `InstructorProfileStatus`, `InstructorApplicationAction`, `CourseEventType`, `MediaKind`, `MediaStatus`, `NotificationType`.
- [ ] A2 `shared/permissions.ts`: permission list, `ROLE_PERMISSIONS` (INSTRUCTOR ⊇ LEARNER, ADMIN = all), `can(principal, permission)`.
- [ ] A3 Prisma: `InstructorApplication`, `InstructorApplicationEvent`, `InstructorProfile`, `CourseEvent`, `MediaAsset`, `Notification`; new `Course` columns (`shortDescription`, `learningObjectives[]`, `prerequisites[]`, `targetAudience`, `thumbnailAssetId`), `Lesson.videoAssetId`; new indexes.
- [ ] A4 Migration SQL incl. the partial unique index `WHERE status='PENDING'`, defaults that let existing rows migrate, and the admin-ownership backfill.
- [ ] A5 Server `can()` + `requirePermission()` middleware; replace role-equality checks; keep `requireRole` for the admin namespace.
- [ ] A6 `authenticate` loads instructor status; `AuthUser` gains `instructorStatus`.
- [ ] A7 Thread `actor` through `coursesService` / `lessonsService`; ownership enforced in the service, 404 (not 403) for someone else's course.
- [ ] A8 Extend `resetDb` truncation list. **Run the full existing suite.**

### B — applications, admin review, notifications
- [ ] B1 Shared Zod schemas for apply / edit / decide / notes / queries.
- [ ] B2 `instructor-applications` module (routes → controller → service → repository); cooldown, 409 on duplicate, `WHERE status='PENDING'` guarded decisions.
- [ ] B3 Approval transaction: application → APPROVED, user role → INSTRUCTOR, profile created, event recorded, notifications created, refresh family revoked.
- [ ] B4 Suspend / reinstate; append-only event table; internal notes.
- [ ] B5 `notifications` module + `NotificationChannel` interface.
- [ ] B6 Tests + OpenAPI.

### C — instructor course, module and lesson management
- [ ] C1 `/instructor/courses*` routes reusing `coursesService` with `actor`.
- [ ] C2 Publish checklist returning every failing rule as a 422.
- [ ] C3 Unpublish / archive / delete rules; `CourseEvent` writes.
- [ ] C4 Modules and lessons under the instructor namespace; transactional reorder.
- [ ] C5 Lesson delete → progress cascade + enrollment recalculation; lesson add → reopen completed enrollments.
- [ ] C6 Course preview (owner/admin, any status, never writes progress).
- [ ] C7 Tests + OpenAPI.

### D — uploads and storage
- [ ] D1 `StorageProvider` abstraction, S3 and local-disk drivers, env config.
- [ ] D2 `/uploads/presign`, `/uploads/:id/complete`, `DELETE /uploads/:id`; magic-byte check, size limits, rate limiting.
- [ ] D3 Duration extraction (ffprobe when present, client-reported value confirmed server-side otherwise).
- [ ] D4 Signed short-lived playback URLs behind the existing access check; Range support.
- [ ] D5 MinIO in Compose + bucket job; `.env.example`.
- [ ] D6 Tests.

### E — dashboard, analytics, learner monitoring
- [ ] E1 One analytics service with the metric definitions; SQL/Prisma aggregates only.
- [ ] E2 `/instructor/dashboard`, `/instructor/activity`, `/instructor/courses/:id/analytics`.
- [ ] E3 `/instructor/courses/:id/learners` (+ search, filters, sort, pagination) and `/learners/:userId/progress` (404 when not enrolled).
- [ ] E4 Tests against hand-calculated fixtures.

### F — frontend
- [ ] F1 `qk.instructor.*`, `qk.applications.*`, `qk.notifications.*`; `me` refetch rules.
- [ ] F2 Become an Instructor form + Application Status page (4 states).
- [ ] F3 Teaching shell: workspace switcher, instructor sidebar, profile menu states, notification bell.
- [ ] F4 Instructor dashboard, My Courses, course form, Manage Lessons (dnd + keyboard), lesson dialog + uploader, Preview.
- [ ] F5 Analytics, Enrolled Learners, Individual Learner Progress, Instructor Profile.
- [ ] F6 Admin: Applications, Application Details, Instructor Management.
- [ ] F7 Guards by permission; suspended page; client tests.

### G — end-to-end, design fidelity, docs
- [ ] G1 Seed additions (approved instructor + 2 courses, suspended instructor, PENDING/REJECTED/WITHDRAWN applications).
- [ ] G2 Automated end-to-end workflow test.
- [ ] G3 Migration-on-seeded-data check; seed runs twice.
- [ ] G4 Responsive + keyboard + design-fidelity pass against the artifacts.
- [ ] G5 README, ARCHITECTURE.md, `docs/design-notes.md`, OpenAPI.
- [ ] G6 Full suite, typecheck, lint; final report.

## Design artifacts

`docs/desktop/Cadence-Instructor-Feature-Desktop.pdf` (17 pages, 1440 px) and
`docs/mobile/Cadence-Instructor-Feature-Mobile.pdf` (8 boards, 390 px) are the
visual source of truth and cover every screen in this feature, so no screen
here has to be invented. Screen map in `docs/design-notes.md`.
