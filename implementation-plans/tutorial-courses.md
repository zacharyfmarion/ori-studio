# Tutorial courses

## Goal

Turn `/learn` from a single flat list of eleven lessons into a **catalog of
courses**, with the existing content becoming the first course, **The Basics**.

The tutorial today assumes there is exactly one thing to learn: `/learn` lists
every lesson in the app, `nextLesson()` walks one global array, and finishing the
last lesson of a chapter silently drops you into the first lesson of the next.
That works while all the content is one arc. It stops working the moment there is
a second arc — box pleating, designing from a tree, tessellations — because those
are not later chapters of the same story, they are separate things a user picks
between.

A course is that unit of choice: a titled, self-contained arc with its own
ordering, its own progress, and its own ending. Chapters stay, as the section
headings *inside* a course.

Non-goals: writing a second course, changing lesson content, or changing how a
lesson checks the user's work.

## Approach

### The model

Three levels instead of two, adding one above what exists:

```
Course        The Basics                    ← new
  Chapter     Basics                        ← unchanged
    Lesson    The paper and the canvas      ← unchanged
      Step    What a crease pattern is      ← unchanged
```

`LessonChapter` gains `courseId`, exactly as `Lesson` already carries
`chapterId`. That keeps the parent-pointer convention already in the codebase and
avoids a course having to restate its chapter list in a second place that can
drift.

```ts
export interface LessonCourse {
  id: string;
  title: string;
  /** One line on the catalog card: who this is for and what they end up able to do. */
  blurb: string;
  /** Rough total, shown on the card. Derived, not authored — see below. */
  icon?: string;
}
```

Lesson count and completion are **derived** from the registry rather than
authored on the course, so they cannot go stale.

### Content layout

One course does not justify moving files. `tutorial/lessons/basics.ts` and its
siblings stay where they are; a new `tutorial/courses.ts` declares the course and
each chapter gains `courseId: 'basics'`.

When a second course lands, move to `tutorial/courses/<course-id>/<chapter>.ts`.
Doing that now would be a large diff proving nothing.

### Routes

| Path | Today | After |
| --- | --- | --- |
| `/learn` | lesson index | course catalog |
| `/learn/:courseId` | — | course page: chapters and lessons |
| `/learn/:courseId/:lessonId` | — | a lesson |
| `/learn/:lessonId` | a lesson | redirect to its course |

The old two-segment form has to keep working: it is what every link in this repo
and any bookmark uses. `/learn/:idOrCourse` resolves against the course registry
first, then the lesson registry, and a lesson match redirects to the canonical
three-segment path. That keeps one route entry rather than two overlapping ones,
and the redirect is `replace` so Back does not bounce.

### Progress and persistence

Target shape:

```ts
interface PersistedProgress {
  /** Flat. Lesson ids are globally unique — see the constraint below. */
  completedLessonIds: string[];
  /** Which course the catalog's resume button points at. */
  lastCourseId: string | null;
  /** Per course, the lesson to resume. Deliberately not a step — see below. */
  resumeByCourse: Record<string, string>;
}
```

This replaces `lastLessonId`, which cannot answer the question each course card
needs to ask — *where was I in **this** course* — and which, paired with a
separate `lastCourseId`, would be two fields free to disagree.

**No migration is needed, and this does not have to land before the tutorial
merges.** `readProgress` validates field by field with a fallback per field, so
the change is additive in the only field worth keeping: `completedLessonIds`
survives untouched, unknown fields are ignored, and a missing `resumeByCourse`
yields `{}`. The cost to a user mid-tutorial is one lost resume click.

Three constraints that make that true, worth stating because breaking any of them
turns a free change into a migration:

1. **Lesson ids stay globally unique and un-prefixed.** Course-scoping them
   (`basics/line-types`) would silently invalidate every stored id — no error,
   just a user whose progress quietly reads zero. Uniqueness is already enforced
   by `lessons.test.ts`.
2. **Progress is derived, never counted.** A renamed or deleted lesson leaves a
   stale id behind, so a course card must show
   `lessonsInCourse(id).filter(l => completed.has(l.id)).length`, never
   `completedLessonIds.length`. Getting this wrong ships a card reading `12 / 11`.
3. **Step index is not persisted, on purpose.** The practice document is not
   persisted either, so resuming at step 4 would mean a blank canvas under a step
   whose check refers to work that is no longer there — and for a `camv-clean`
   step that check *passes on a blank sheet*, handing out a completion for
   something the user never did. Resume therefore means "the top of that lesson".
   This is a decision, not an omission; do not "fix" it without persisting the
   canvas too.

No version field: the tolerant reader covers additive change, which is the only
kind the constraints above permit. If a future change does break `completedLessonIds`,
add one then and discard rather than migrate — the value at stake is a few
minutes of a tutorial.

### Ordering and endings

`nextLesson(id)` currently walks the global array. It becomes course-scoped:
the last lesson of a course returns `undefined`, and the lesson panel's "Finish
lesson" then lands on the **course page** rather than the next course's first
lesson. That is the behavioural bug this change actually fixes — today, finishing
Foldability would silently start Box Pleating.

`firstLesson()` becomes `firstLessonInCourse(courseId)`.

### UI

- **Catalog** (`/learn`) — one card per course: title, blurb, progress
  (`4 / 11 lessons`), and a resume affordance on the course you were last in.
  Reuses `.lesson-index__lesson` card styling; no new visual language.
- **Course page** (`/learn/:courseId`) — what `LessonIndexPanel` renders today,
  scoped to one course, plus the course title and a back link to the catalog.
- **Lesson panel** — the existing back arrow targets the course page instead of
  `/learn`, so the hierarchy is walkable without the browser Back button.

`LessonIndexPanel` is 74 lines and already renders "chapters, each with lessons".
The course page is that component with a `courseId` filter; the catalog is a new,
smaller sibling.

### Layout

`applyLearnLayout` mounts canvas + lesson + view-controls. The catalog and course
pages have no practice document, so they should not sit beside a live CP canvas
pretending to.

**Decided:** catalog and course pages render **full width**, without the
workspace shell, the way `/welcome` already does. Only
`/learn/:courseId/:lessonId` mounts the editing layout. This also removes the
current oddity where `/learn` provisions a practice document nobody is about to
draw on.

## Affected Areas

- `apps/web/src/tutorial/types.ts` — `LessonCourse`, `courseId` on `LessonChapter`
- `apps/web/src/tutorial/courses.ts` — new registry
- `apps/web/src/tutorial/lessons/index.ts` — course-scoped `nextLesson`,
  `lessonsInCourse`, `firstLessonInCourse`
- `apps/web/src/tutorial/lessons/{basics,construct,foldability}.ts` — `courseId`
  on each chapter
- `apps/web/src/routing/paths.ts` — `coursePath`, `lessonPath(courseId, lessonId)`
- `apps/web/src/routing/appRouter.tsx` — catalog / course / lesson routes
- `apps/web/src/routing/LearnIndexRoute.tsx`, `LessonRoute.tsx` — resolution and
  the legacy redirect
- `apps/web/src/components/panels/LessonIndexPanel.tsx` — scoped to a course
- `apps/web/src/components/panels/CourseCatalogPanel.tsx` — new
- `apps/web/src/components/panels/LessonPanel.tsx` — back target, finish target
- `apps/web/src/store/tutorialStore.ts` — `lastCourseId`, course-aware resume
- `apps/web/src/store/layoutStore.ts` — only lessons need the editing layout
- `apps/web/src/styles/theme.css` — catalog card styles
- Tests: `lessons.test.ts` (every chapter names a real course; every course has at
  least one lesson), `lessonFlow.test.ts` (a course ends rather than running on),
  `appRouter.test.ts` (legacy `/learn/:lessonId` redirects)

## Decisions (settled)

1. **`/learn` shows the catalog even with one course.** It is honest and sets the
   shape; a card reading `0 / 11` is a better entry point than a wall of lessons,
   and redirecting past the catalog would hide the concept exactly while it is
   being built.
2. **Catalog and course pages are full width**, outside the workspace shell.
3. **No prerequisites yet.** Catalog order is signal enough, and gating wants a
   second course to exist before it is designed.

## Checklist

- [x] `LessonCourse` type and `courses.ts` registry; `courseId` on each chapter
- [x] Course-scoped `nextLesson`, `lessonsInCourse`, `firstLessonInCourse`
- [x] Content tests: every chapter names a real course, every course is non-empty
- [x] `paths.ts`: `coursePath`, three-segment `lessonPath`
- [x] Router: catalog, course, lesson; legacy `/learn/:lessonId` → redirect
- [x] Router test for the redirect
- [x] `CourseCatalogPanel` with per-course progress
- [x] `LessonIndexPanel` scoped to a course, with a back link to the catalog
- [x] Lesson panel: back and finish target the course page
- [x] `lastCourseId` + `resumeByCourse` replace `lastLessonId`; resume returns to
      the right lesson *of the right course*
- [x] Course progress derived from the registry, not from `completedLessonIds.length`
- [x] Test: a stale id in `completedLessonIds` cannot inflate a course's count
- [x] Layout: only `/learn/:courseId/:lessonId` mounts the editing workspace
- [x] Catalog styles
- [x] Walk it in the browser: catalog → course → lesson → finish → course

## Outcome

Shipped. Three defects surfaced only by walking the flow in a browser, all of
them redirect races, and one predating this change:

- `startWorkspaceUrlSync` replaced any deep link with its workspace root on a
  workspace transition, so cold-loading a lesson landed on the catalog. It now
  skips when the current path already resolves to the workspace being activated.
  This was live before courses — `/learn/:lessonId` was clobbered the same way —
  and the catalog only made it visible.
- `LessonPanel` redirected when it had no active lesson, racing the route's
  open-from-effect and bouncing every lesson back on its first render.
- The practice-document effect looped forever when a load failed or had not yet
  resolved, because one of its conditions was `!document` and its own
  bookkeeping re-triggered it. Reached by cold-loading a lesson before the CP
  engine is up.

Worth keeping in mind for the next surface: every one of these is a redirect
that fires before the state it reads has settled, and none of them is visible to
a unit test of the thing being redirected.
