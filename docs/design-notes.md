# Design notes — how the artifacts became the UI

The visual source of truth is `docs/desktop/Cadence-UI-Desktop.pdf` (10 pages,
1440 px canvas) and `docs/mobile/Cadence-UI-Mobile.pdf` (10 pages, 390 px
canvas). Neither file was modified. Everything below was extracted from them.

**The artifact wins.** Where this document records a deviation, it is because
a functional, data-integrity or accessibility requirement forced it, and the
reason is stated.

## How the artifacts were read

Both documents are vector PDFs exported from the design canvas, so they were
read two ways:

| What | How |
|---|---|
| Rendered pages | `pdfjs-dist` with a `@napi-rs/canvas` canvas factory, plus `Path2D` / `DOMMatrix` globals it cannot polyfill itself. All 20 pages render. |
| Exact colours | sampled pixel-by-pixel out of the rendered pages |
| Fonts | `/BaseFont` entries in the PDF object table |
| Geometry, canvas sizes | page content streams inflated with Node's `zlib`, reading the `rg` / `re` operators |
| Copy, type sizes, positions | `pdfjs` `getTextContent()`, dumping every run with its transform |

Both documents are drawn at a uniform **0.75 scale** (1440 px canvas to a
1080 pt page; 390 px to 293 pt), confirmed from the page background
rectangles (`0 0 1440 900 re` and friends). Design pixels = PDF points × 4/3.

## Screen map

### Desktop — `docs/desktop/Cadence-UI-Desktop.pdf`

| Page | Artifact screen | Canvas | Route | Component |
|---|---|---|---|---|
| 1 | Cover / contents | 1440x900 | — | — |
| 2 | 01 · Design system foundations | 1440x1760 | — | `styles/globals.css`, `components/ui/*` |
| 3 | 02 · Sign in / Sign up | 1440x900 | `/login`, `/register` | `pages/LoginPage`, `pages/RegisterPage`, `AuthLayout` |
| 4 | 03 · Course catalog | 1440x1386 | `/courses` | `pages/CatalogPage`, `components/courses/CourseCard`, `ContinueLearningCard` |
| 5 | 04 · Course detail | 1440x1481 | `/courses/:slug` | `pages/CourseDetailPage`, `components/lessons/LessonList` |
| 6 | 05 · Lesson player | 1440x1058 | `/courses/:slug/lessons/:lessonId` | `pages/LessonPage`, `LessonVideoPlayer`, `UpNextList` |
| 7 | 06 · Learner dashboard | 1440x1042 | `/dashboard`, `/my-learning` | `pages/DashboardPage`, `pages/MyLearningPage` |
| 8 | 07 · Admin — activity & learners | 1440x1365 | `/admin`, `/admin/activity`, `/admin/learners` | `pages/admin/*` |
| 9 | 08 · Admin — course editor | 1440x1722 | `/admin/courses/:id/lessons` | `pages/admin/AdminCourseEditorPage` |
| 10 | 09 · Loading, empty & error states | 1440x900 | all | `components/common/States`, `ErrorPages` |

### Mobile — `docs/mobile/Cadence-UI-Mobile.pdf`

| Page | Artifact screen | Route | Notes |
|---|---|---|---|
| 1 | Cover / contents | — | — |
| 2 | 01 · Sign in / Sign up (web) | `/login`, `/register` | |
| 3 | 02 · Course catalog (web) | `/courses` | |
| 4 | 03 · Course detail (web) | `/courses/:slug` | |
| 5 | 04 · Lesson player (web) | `/courses/:slug/lessons/:lessonId` | |
| 6 | 05 · Learner dashboard (web) | `/dashboard` | |
| 7 | 06 · Admin — activity (web) | `/admin` | |
| 8 | 07 · Admin — course editor (web) | `/admin/courses/:id/lessons` | |
| 9 | 08 · App — lesson | `/courses/:slug/lessons/:lessonId` | **built as web**, below `md` |
| 10 | 09 · App — home | `/dashboard` | **built as web**, below `md` |

**Pages 9 and 10 are implemented as web.** The artifact labels them `app`,
but the deliverable is one responsive application, so they are the phone
presentation of the routes that already exist rather than a second codebase
or a set of mock-only screens. What makes them read as an app in the
artifact, and what is therefore implemented:

| Artifact detail (page 10, App — home) | Where |
|---|---|
| Fixed bottom tab bar: Home · Catalog · Progress, active in cobalt | `components/layout/MobileTabBar.tsx`, shown below `md` |
| "Hi, Ada" greeting with a streak line underneath | `DashboardPage`, phone header |
| Continue card with a play affordance and an amber sliver on the media | `components/dashboard/ContinueLearningCard.tsx` |
| Three compact stat tiles in one row | `DashboardPage`, `CompactStat` |
| "Your courses" as rows: square colour thumbnail, title, inline progress + % | `DashboardPage`, `CourseProgressRow` |

| Artifact detail (page 9, App — lesson) | Where |
|---|---|
| Dark top bar: back arrow, "Lesson 5 of 12", captions toggle | `LessonPage` header + player CC control |
| Player bleeding to the screen edges | `LessonPage`, `max-md:-mx-4` |
| Amber scrubber, then `08:42` · speed box · `-05:38` remaining | `LessonVideoPlayer`, phone control row |
| Status pill, title, `course · 14:20` meta | `LessonPage` body |
| Segmented Up next / Transcript / Resources, active filled Ink | `LessonPage`, `variant="ink"` |
| Up-next rows: dark play thumbnail, overline, runtime and status | `components/lessons/UpNextList.tsx` |
| Sticky bottom bar: Curriculum + Next lesson | `LessonPage`, above the tab bar |

### Required screens with no design

Built by extending the design's language: `/profile` (the admin nav's
"Settings"), `/admin/learners/:id` learner detail, and the register form's
filled state. The artifact shows the Sign in / Create account pair, so the
register screen reuses that card.

## Tokens

Page 2 of the desktop artifact is an explicit token sheet; these values are
quoted from it, not sampled.

### Colour

| Token | Hex | Artifact label | CSS variable |
|---|---|---|---|
| Ink | `#12141C` | text, nav | `--foreground` |
| Slate | `#4A5060` | secondary text | `--secondary-foreground` |
| Muted | `#5F6577` | meta | `--muted-foreground` |
| Line | `#E3E6EC` | borders | `--border`, `--input` |
| Cobalt | `#2F4BFF` | primary action | `--primary`, `--ring` |
| Cobalt deep | `#1E33C7` | links, hover | `--primary-hover` |
| Cobalt tint | `#EAEEFF` | selected bg | `--accent`, `--primary-tint` |
| Canvas | `#F5F6F8` | page bg | `--background` |
| Amber | `#B85C00` | in progress | `--warning` |
| Green | `#0E8A5C` | completed | `--success` |
| Red | `#C2261B` | errors, delete | `--destructive` |
| Night | `#0C0E16` | video surface | `--night` |

### Colour sampled from the rendered pages (not on the token sheet)

| Value | Hex | Where | CSS variable |
|---|---|---|---|
| Player accent | `#FFB020` | the scrubber fill and thumb, on the dark player | `--video-accent` |
| Player track | `#3B3B3B` | the unplayed part of the scrubber | `--video-track` |
| Avatar | `#FFB98F` | every avatar, with Ink initials | `--avatar` |

The player's accent is **amber, not cobalt**: cobalt on Night fails contrast
and effectively disappears, which is why the design switches accent for the
one dark surface. This was wrong in the first implementation and is now
corrected.

### Thumbnail palette, sampled per category

Course art in the artifact is never photographic — the course editor's field
is labelled "Thumbnail colour". Each card is a flat category colour with a
large circle bleeding off the top-right and a rounded square at the lower
left. `scripts/make-thumbnails.mjs` generates exactly that:

| Category | Base | Circle | Square |
|---|---|---|---|
| Engineering | `#2F4BFF` | `#1E33C7` | `#97A5FF` |
| Design | `#E2551F` | `#C7430F` | `#FFB98F` |
| Data | `#0A7365` | `#065C50` | `#7FD9C6` |
| Security | `#12141C` | `#23262F` | `#FFB020` |
| Product | `#7B5CF0` | `#5E40CC` | `#C9BBFA` |

### Selection is Ink, not cobalt

Sampled from the catalog's active category chip (`#12141C`) and the app
lesson screen's active segmented tab (`#12141C`). The design reserves cobalt
for the single primary action on a screen, so a *selected* control is filled
Ink instead. Implemented as `variant="ink"` on the existing Button, extending
the same `cva` rather than adding a parallel style.

### Type

| Token | Spec in the artifact | Family |
|---|---|---|
| Display 48 | `Bricolage 700 · -3%` tracking | Bricolage Grotesque |
| Heading 28 | `Bricolage 700` | Bricolage Grotesque |
| Title 18 | card titles, `Inter 600` | Inter |
| Body 16 | descriptions, `Inter 400 · 1.5` | Inter |
| Overline 13 | `Inter 600 · +6%`, uppercase | Inter |
| Mono 14 | timecodes (`08:42 / 14:20`) | JetBrains Mono |

### Space, radius, shadow, focus

- **Space**: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 72`
- **Radius**: `8 · 12 · 20 · pill`
- **Shadow**: none at rest; a subtle shadow at 8% on hover only
- **Focus**: `3px #2F4BFF ring at 2px offset on every control`
- **Minimum touch target**: `44px`

### Layout geometry (measured from the content streams)

- Desktop canvas **1440**, page margin **80 px**, top bar **68 px**
- Catalog grid: **4 columns**, gap **24 px**, card about **301 px** wide
- Admin shell: fixed left sidebar **246 px**
- Mobile canvas **390**, page margin **16 px**, cards full width
- Breakpoints, quoted from the artifact — "Mobile-first grids. 4 to 2 to 1
  columns at 1200 / 720 px" — so Tailwind `screens` are `md: 720px`,
  `lg: 1200px`, `xl: 1440px`

## The brand mark

An Ink rounded square carrying a white pulse glyph, with the wordmark beside
it — on the desktop top bar, the admin sidebar and the mobile app header
alike. Not a cobalt tile: cobalt is the action colour, and a cobalt logo
would compete with every primary button on the page. `components/common/Brand.tsx`.

## Fonts — self-hosted

All three families are open-licensed (SIL OFL 1.1) and vendored as `.woff2`
into `client/src/assets/fonts/<family>/` with their licence files. No request
ever goes to a font CDN.

| Family | Role | Source |
|---|---|---|
| Bricolage Grotesque | display + headings | `@fontsource-variable/bricolage-grotesque` |
| Inter | body, UI | `@fontsource-variable/inter` |
| JetBrains Mono | timecodes | `@fontsource-variable/jetbrains-mono` |

The artifact's `/BaseFont` entries name `BricolageGrotesque96ptExtraBold-Bold`,
`Inter-{Regular,Medium,SemiBold,Bold}` and `JetBrainsMono-Medium`, so no
substitution was needed.

## Deviations

### Artifact content with no data behind it

The spec fixes the data model and forbids hardcoded dashboard numbers, so
these are either derived honestly or left out. Nothing is faked.

| Artifact element | Where | Decision |
|---|---|---|
| "4-day streak" | mobile p10 | **Implemented**, derived from distinct days with `lesson_progress` activity |
| "2h 05m this week" | mobile p10, desktop p7 | Replaced with "N lessons this week" — a real count. Weekly *time* is not derivable: `maxWatchedSeconds` is cumulative per lesson, not per day. Would need a per-day event log |
| Weekly goal dial + `M T W T F S S` strip | desktop p7 | Omitted — no goal entity |
| "Recommended next" | desktop p7 | Omitted — no recommendation logic in scope |
| Instructor name / avatar / "6 courses" | desktop p5 | Omitted — `Course` has only `createdById`, surfaced on the admin side |
| "Watch trailer · 1:40" | desktop p5, mobile p4 | Omitted — no trailer field |
| Transcript / Resources tab **content** | desktop p6, mobile p9 | Tabs are built and switch; each states that no transcript or resource exists, because there is no model for either. The tab strip is part of the layout, so omitting it would change the design |
| "Where learners stop" drop-off chart | desktop p8 | Omitted — needs per-lesson funnel analytics |
| Trend deltas ("6.2% vs prior 7 days") | desktop p8 | Omitted — needs a time-series snapshot |
| Notification bell + unread dot | desktop p4 | Omitted — no notification model |
| "Video ready · HLS" | desktop p9 | Replaced with a real has-video state read from `videoUrl` |
| "Keep me signed in for 30 days" | desktop p2, mobile p1 | **Implemented.** Ticking it issues a 30-day refresh token instead of 7 (`REFRESH_TOKEN_TTL_REMEMBERED`); rotation preserves the longer life. The access token stays 15 minutes either way, so the user row is still re-checked and a deactivation still bites |
| "Forgot password?" | desktop p2, mobile p1 | **Link is present and resolves** to `/forgot-password`, which explains that this deployment has no mail transport and points at the admin. Self-service reset is still not implemented, but the link is not a dead control |
| Prototype shortcuts ("Demo learner →", "Demo admin →") | desktop p2, mobile p1 | **Implemented.** They fill the seeded credentials into the form rather than signing in silently, so what is about to be submitted stays visible |
| Sort "Most popular" | desktop p4 | Replaced with the spec's sorts (newest / oldest / title / duration) |

Every remaining control on every screen is wired to a real endpoint.

### Visual adjustments

| Change | Reason |
|---|---|
| Muted `#5F6577` for meta text only, never body copy | AA contrast: body copy uses Slate `#4A5060` (7.4:1 on Canvas) |
| Status pills always pair an icon with the word | the artifact's own principle 3: "Status = icon + word + colour. Never colour alone" |
| Skeletons mirror the final card geometry, shimmer off under `prefers-reduced-motion` | stated on desktop p10 |
| The catalog progress track renders even at 0% | keeps cards in a grid aligned, and stops the layout shifting when a learner enrols |

## Fidelity status

Tokens, geometry, type hierarchy, copy and per-screen composition were
checked against the rendered pages, and the corrections listed above (player
accent, avatar, brand mark, selection colour, card composition, thumbnail
art, the two app screens) came out of that pass.

**Not yet done:** a side-by-side screenshot diff of the running app against
each artifact page at 1440 px and 390 px. That needs browser automation,
which is not available in this environment, so the app's own rendering has
not been compared pixel-for-pixel. Treat the fidelity claim as "matches on
tokens, structure and copy", not "pixel-verified".
