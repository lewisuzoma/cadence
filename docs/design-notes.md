# Design notes — how the artifacts became the UI

The visual source of truth is `docs/desktop/Cadence-UI-Desktop.pdf` (10 pages,
1440 px canvas) and `docs/mobile/Cadence-UI-Mobile.pdf` (10 pages, 390 px
canvas). Neither file was modified. Everything below was extracted from them.

## How the artifacts were read

The build host had no PDF rasteriser (`pdftoppm` absent, and both the Alpine
`poppler-utils` package and the `minidocks/poppler` image failed to download on
this network). The artifacts are **vector** PDFs exported from the design
canvas, so they were read without rasterising:

| What | How |
|---|---|
| Fonts | `/BaseFont` entries in the PDF object table |
| Colours, geometry, canvas sizes | page content streams inflated with Node's built-in `zlib`, then the `rg`/`re` operators read directly |
| Copy, type sizes, element positions | `pdfjs-dist` `getTextContent()` (pure JS, no canvas), dumping every text run with its transform |

Both documents are drawn at a uniform **0.75 scale** (1440 px canvas to a
1080 pt page; 390 px to 293 pt), confirmed from the page background rectangles
(`0 0 1440 900 re` and friends). Design pixels = PDF points x 4/3.

**Consequence for the fidelity pass:** the check is numeric (tokens, geometry,
type hierarchy, copy) rather than a side-by-side raster diff. This is recorded
as a limitation in the final report, not as a verified pixel match.

## Screen map

### Desktop — `docs/desktop/Cadence-UI-Desktop.pdf`

| Page | Artifact screen | Canvas | Route | Component |
|---|---|---|---|---|
| 1 | Cover / contents | 1440x900 | — | — |
| 2 | 01 · Design system foundations | 1440x1760 | — | `styles/globals.css`, `components/ui/*` |
| 3 | 02 · Sign in / Sign up | 1440x900 | `/login`, `/register` | `pages/LoginPage`, `pages/RegisterPage`, `layouts/AuthLayout` |
| 4 | 03 · Course catalog | 1440x1386 | `/courses` | `pages/CatalogPage`, `components/courses/CourseCard` |
| 5 | 04 · Course detail | 1440x1481 | `/courses/:slug` | `pages/CourseDetailPage`, `components/lessons/LessonList` |
| 6 | 05 · Lesson player | 1440x1058 | `/courses/:slug/lessons/:lessonId` | `pages/LessonPage`, `components/lessons/LessonVideoPlayer` |
| 7 | 06 · Learner dashboard | 1440x1042 | `/dashboard`, `/my-learning` | `pages/DashboardPage`, `pages/MyLearningPage` |
| 8 | 07 · Admin — activity & learners | 1440x1365 | `/admin`, `/admin/activity`, `/admin/learners` | `pages/admin/*`, `components/admin/DataTable` |
| 9 | 08 · Admin — course editor | 1440x1722 | `/admin/courses/:id/lessons` | `pages/admin/CourseEditorPage` |
| 10 | 09 · Loading, empty & error states | 1440x900 | all | `components/common/*`, `ForbiddenPage`, `NotFoundPage` |

### Mobile — `docs/mobile/Cadence-UI-Mobile.pdf`

| Page | Artifact screen | Canvas | Route |
|---|---|---|---|
| 1 | Cover / contents | 390x844 | — |
| 2 | 01 · Sign in / Sign up (web) | 390x919 | `/login`, `/register` |
| 3 | 02 · Course catalog (web) | 390x4168 | `/courses` |
| 4 | 03 · Course detail (web) | 390x2816 | `/courses/:slug` |
| 5 | 04 · Lesson player (web) | 390 wide | `/courses/:slug/lessons/:lessonId` |
| 6 | 05 · Learner dashboard (web) | 390 wide | `/dashboard` |
| 7 | 06 · Admin — activity (web) | 390 wide | `/admin` |
| 8 | 07 · Admin — course editor (web) | 390 wide | `/admin/courses/:id/lessons` |
| 9 | 08 · App — lesson (**native app**) | 390x844 | **not built** |
| 10 | 09 · App — home (**native app**) | 390x844 | **not built** |

Mobile pages 9 and 10 are labelled `app` in the artifact's own contents list
and show a native mobile application. The deliverable here is a responsive web
SPA, so they are **not implemented**; the responsive web screens (mobile pages
2 to 8) are.

### Required screens with no design

Built by extending the design's language (same tokens, card geometry, spacing
rhythm): `/profile` (the admin nav's "Settings"), `/admin/learners/:id` learner
detail, and the register form's filled state. The artifact shows the
Sign in / Create account tab pair, so the register screen reuses that card.

## Tokens

Page 2 of the desktop artifact is an explicit token sheet; these values are
quoted from it verbatim, not sampled from pixels.

### Colour — from the artifact's own swatch labels

| Token | Hex | Artifact label | CSS variable |
|---|---|---|---|
| Ink | `#12141C` | text, nav | `--foreground` |
| Slate | `#4A5060` | secondary text | `--secondary-foreground` |
| Muted | `#5F6577` | meta | `--muted-foreground` |
| Line | `#E3E6EC` | borders | `--border`, `--input` |
| Cobalt | `#2F4BFF` | primary action | `--primary`, `--ring` |
| Cobalt deep | `#1E33C7` | links, hover | `--primary-hover` |
| Cobalt tint | `#EAEEFF` | selected bg | `--accent` |
| Canvas | `#F5F6F8` | page bg | `--background` |
| Amber | `#B85C00` | in progress | `--warning` |
| Green | `#0E8A5C` | completed | `--success` |
| Red | `#C2261B` | errors, delete | `--destructive` |
| Night | `#0C0E16` | video surface | `--video-surface` |

Card surfaces are white (`#FFFFFF`) on the Canvas page background, confirmed
from the content-stream fills.

### Type — from the artifact's type specimen

| Token | Spec in the artifact | Family |
|---|---|---|
| Display 48 | `Bricolage 700 · -3%` letter-spacing | Bricolage Grotesque |
| Heading 28 | `Bricolage 700` | Bricolage Grotesque |
| Title 18 | card titles, `Inter 600` | Inter |
| Body 16 | descriptions and lesson notes, `Inter 400 · 1.5` | Inter |
| Overline 13 | `Inter 600 · +6%` letter-spacing, uppercase | Inter |
| Mono 14 | timecodes (`08:42 / 14:20`) | JetBrains Mono |

### Space, radius, shadow, focus

- **Space scale**: `4 · 8 · 12 · 16 · 24 · 32 · 48 · 72`
- **Radius**: `8 · 12 · 20 · pill`
- **Shadow**: none at rest; a subtle shadow at 8% on hover only
- **Focus**: `3px #2F4BFF ring at 2px offset on every control`
- **Minimum touch target**: `44px`

### Layout geometry (measured from the content streams)

- Desktop canvas **1440**, page margin **80 px**, top bar **68 px** tall
- Catalog grid: **4 columns**, gap **24 px**, card about **301 px** wide
- Admin shell: fixed left sidebar **246 px**, content to the right
- Mobile canvas **390**, page margin **16 px**, cards full width
- Breakpoint note quoted from the artifact: "Mobile-first grids. 4 to 2 to 1
  columns at 1200 / 720 px", so Tailwind `screens` are `sm: 720px`,
  `lg: 1200px`, `xl: 1440px`

## Fonts — self-hosted

All three families are open-licensed (SIL OFL 1.1) and are vendored as
`.woff2` into `client/src/assets/fonts/<family>/` with their licence files. No
request ever goes to a font CDN.

| Family | Role | Source |
|---|---|---|
| Bricolage Grotesque | display + headings | `@fontsource-variable/bricolage-grotesque` |
| Inter | body, UI | `@fontsource-variable/inter` |
| JetBrains Mono | timecodes | `@fontsource-variable/jetbrains-mono` |

The artifact's `/BaseFont` entries name `BricolageGrotesque96ptExtraBold-Bold`,
`Inter-{Regular,Medium,SemiBold,Bold}` and `JetBrainsMono-Medium`, so no
substitution was needed.

## Intentional deviations

Functional, security and accessibility requirements of the spec take
precedence over the artifact's visuals, and the artifact never overrides them.

### Artifact content outside the spec's data model — omitted

The spec fixes the data model (User, Course, Module, Lesson, Enrollment,
LessonProgress) and forbids hardcoded dashboard numbers and decorative
buttons. These artifact elements have no data behind them, so rendering them
would mean inventing numbers:

| Artifact element | Where | Decision |
|---|---|---|
| Learning streak ("learned 4 days in a row") | desktop p7 | omitted — no event-history model |
| Weekly goal dial + `M T W T F S S` strip | desktop p7 | omitted — no goal entity |
| "Recommended next" card | desktop p7 | omitted — no recommendation logic in scope |
| Instructor name / avatar / "6 courses" | desktop p5 | omitted — `Course` has only `createdById`, surfaced on the admin side |
| "Watch trailer · 1:40" | desktop p5, mobile p4 | omitted — no trailer field |
| Transcript / Resources tabs | desktop p6 | omitted — no transcript or attachment model |
| "Where learners stop" drop-off chart | desktop p8 | omitted — needs per-lesson funnel analytics beyond the spec |
| Trend deltas ("6.2% vs prior 7 days") | desktop p8 | omitted — needs a time-series snapshot table |
| "Video ready · HLS" | desktop p9 | replaced with a real "Has video / No video" state read from `videoUrl` |
| "Keep me signed in for 30 days" | desktop p3, mobile p2 | omitted — the refresh TTL is a fixed 7 days server-side |
| "Forgot password?" | desktop p3 | omitted — no mail transport in scope |
| Prototype shortcuts ("Demo learner") | desktop p3 | omitted — seeded credentials are in the README instead |
| Sort "Most popular" | desktop p4 | replaced with the spec's sorts (newest / oldest / title / duration) |

Every remaining control on every screen is wired to a real endpoint.

### Visual adjustments

| Change | Reason |
|---|---|
| Muted `#5F6577` is used for meta text only, never for body copy | AA contrast: body copy uses Slate `#4A5060` (7.4:1 on Canvas) |
| The "In progress" amber is darkened on tinted backgrounds | keeps 4.5:1 when the pill sits on `#EAEEFF` rather than white |
| Status pills always pair a Lucide icon with the word | the artifact's own principle 3: "Status = icon + word + colour. Never colour alone" |
| Skeletons mirror the final card geometry, shimmer disabled under `prefers-reduced-motion` | stated on desktop p10 |
