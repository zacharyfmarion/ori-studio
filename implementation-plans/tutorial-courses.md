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

### Progress

`completedLessonIds` stays flat — lesson ids are globally unique, and flattening
means a lesson that moves between courses keeps its completion.

`lastLessonId` becomes insufficient: "resume" should mean "resume the course I was
in". Persisted shape gains a course:

```ts
interface PersistedProgress {
  completedLessonIds: string[];
  lastLessonId: string | null;
  lastCourseId: string | null;   // new
}
```

`readProgress` already tolerates missing and malformed fields, so an existing
payload loads with `lastCourseId: null` and the catalog simply shows no resume
button until the next lesson is opened. No migration needed.

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
pages have no practice document, so they should not be sitting beside a live CP
canvas pretending to. Two options, and the second is recommended:

1. Keep the workspace layout and render the catalog in the lesson pane. Cheap,
   but the canvas beside it is meaningless.
2. Render catalog and course pages as **full-width routes** without the workspace
   shell, the way `/welcome` already does. Only `/learn/:courseId/:lessonId`
   mounts the editing layout.

Option 2 also removes the current oddity where `/learn` provisions a practice
document nobody is about to draw on.

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

## Decisions to confirm

1. **Does `/learn` show a catalog of one?** Recommended: yes — it is honest and
   sets the shape, and a card showing `0 / 11` is a better entry point than a
   wall of lessons. The alternative is redirecting to the only course until a
   second exists, which hides the concept exactly while it is being built.
2. **Full-width catalog, or inside the workspace shell?** Recommended: full
   width (option 2 above).
3. **Do courses have prerequisites?** Recommended: not yet. Ordering them in the
   catalog is enough signal, and gating content on completion is a product
   decision that wants a second course to exist first.

## Checklist

- [ ] `LessonCourse` type and `courses.ts` registry; `courseId` on each chapter
- [ ] Course-scoped `nextLesson`, `lessonsInCourse`, `firstLessonInCourse`
- [ ] Content tests: every chapter names a real course, every course is non-empty
- [ ] `paths.ts`: `coursePath`, three-segment `lessonPath`
- [ ] Router: catalog, course, lesson; legacy `/learn/:lessonId` → redirect
- [ ] Router test for the redirect
- [ ] `CourseCatalogPanel` with per-course progress
- [ ] `LessonIndexPanel` scoped to a course, with a back link to the catalog
- [ ] Lesson panel: back and finish target the course page
- [ ] `lastCourseId` in persisted progress; resume returns to the right course
- [ ] Layout: only `/learn/:courseId/:lessonId` mounts the editing workspace
- [ ] Catalog styles
- [ ] Walk it in the browser: catalog → course → lesson → finish → course
