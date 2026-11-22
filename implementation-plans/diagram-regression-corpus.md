# Diagram regression corpus

**What Phase 1 gives you.**

- One command runs every diagram file twice: on the commit your branch started
  from ("before"), and on your working copy ("after").
- It writes one local page showing only the steps that changed, with before and
  after side by side.
- Checks that need no comparison run on both sides. On today's main they flag
  the rose's buried aux lines and the missing Refresh as "already broken
  before".

Everything after Phase 1 is optional later work.

## Goal

A private corpus of real `.osf` projects with Diagram workspaces, kept outside
the repo, and a harness in the repo that runs them before and after a change.
A change to how diagrams are captured, painted, laid out or saved then shows
what it did to every step before it ships.

It exists because of three problems found in a rose diagram on 2026-11-22:

1. **Buried aux lines drawn on top.** Folded-3D steps draw buried aux lines
   over the paper that covers them, so the lines seem to end mid-face. This is
   a regression from 90591a0ca, shipped in 0.10.0.
2. **No Refresh after aux edits.** Adding aux lines never marks folded steps
   out of date, so Refresh Picture stays off. Broken since 92e79cd0e
   (2026-10-03).
3. **A crumpled Simulated step.** The solver crumples a Simulated step at 80%.
   This is a quality problem, not a regression.

Done means:

- One command runs all 38 files before and after and writes the page. The two
  biggest Bodo files run on request. Each side takes about two minutes.
- On today's main, the checks that need no comparison flag bugs 1 and 2.
- With main as "after" and main with 90591a0ca undone as "before", the rose's
  four unspread 3D steps appear on the page, and the 3D window check calls them
  new problems. (The spike already measured this; see the checklist.)
- A diagram PR states the run in one line without naming a file, for example
  "diagram corpus: 0 of <n> steps changed" or "6 steps changed on purpose: aux
  lines under edges".

## Approach

### What the history says

A search of git history and PRs since the Diagram workspace landed (2026-10-02)
found about 50 distinct bugs in diagrams and folded pictures. Four findings
shape the design.

- **Saved pictures are frozen.** Opening a file never captures a picture again.
  - Flat and 3D scenes keep the draw order they were captured with. Only
    simulated scenes are reordered when painted.
  - A capture bug therefore reaches a file only when a picture is captured:
    Link, Show as, Refresh, Pose, or an import. The bad picture is then what
    gets saved.
- **So the comparison is code against code.** The same file is captured by the
  code before the change and by the code after it. A file's stored picture
  can't be the reference: the rose's 3D steps were captured by 0.10.0 and
  already contain bug 1.
- **A synthetic test approved the regression.** 90591a0ca re-blessed
  `foldedFigureExportGolden.json`'s 3D entries as "the same elements in a new
  order". It also passed the 3D window comparison in `folded3dScene.test.ts`.
  None of those fixtures had aux lines; real files with aux lines would have
  shown the bug.
- **The capture code runs headless** (the spike, 2026-11-22).
  - `captureStep` takes the kernel as an argument. The spike ran it in
    vitest's node project through the app's own CP worker API, in-process,
    and `createBoundCpCaptureRuntime`.
  - Crease-pattern, flat (Affine, Depth, none) and unspread-3D captures are
    TypeScript over wasm.
  - The Default spread is not: it goes through three web workers (prepare,
    solve, clip). Each is a thin wrapper over a pure function
    (`connectedSpreadSource`, `solve_layer_spread`, `connectedPaperScene`), so
    the harness runs them in-process.
  - Still out of reach: bitmap fallbacks, WebGL, Pose's GPU solver, and the
    spatial-spread service (Phase 2).

**Bug classes, and what is meant to catch each:**

| Class | Past examples | Meant to be caught by |
| --- | --- | --- |
| Draw order and line visibility | rose 1; simulated fold lines kinked (#600); aux ends over black edges (#453) | Before/after re-capture; 3D window check; before/after repaint |
| Spread and layer order | otters grey strip (#601); stray precrease lines (#594); Bodo step 168 slivers | Before/after re-capture with each step's own spread (spatial in Phase 2) |
| Staleness | rose 2; a moved sheet read "Pattern missing" | Edit probes |
| Capture failures | a refused Default spread failed the whole capture (#587); Flip creases redrew nothing | Step actions (Phase 2) |
| File contract | `joined` flags dropped on read; a newer build's fields dropped on save; unsaid page settings | File check |
| Pages and marks | saved pages re-packed on open; title block shifting hand-moved steps; collapse steps without marks (#603) | Page checks; Fold-step marks (Phase 2) |
| Simulator | rose 3; a stale saved shape kept after Refresh | Simulated steps (Phase 2) |
| Export and performance | butt-cap gaps; RangeError painting huge scenes; overlap-region cap (#605) | Repaint; timing on the big files (Phase 3) |
| Not in any file | Safari annotate offset; WebKit card layout; Pages view blanking; Share's fold cache; Defox M/V swap | Out of scope: they have their own tests or need a browser |

Phase 1 demonstrates this for bugs 1 and 2 only, plus one older fix undone on
purpose. The other rows describe what each check is built for; none of them has
been shown yet.

### Decisions (each can be overruled)

1. **The harness lives in the repo; the data lives outside it.**
   - The origami.me corpus reaches the app through a `repo` symlink. That
     tested whichever checkout the link named, with stale wasm and no
     typecheck.
   - In the repo, the harness is typechecked against the code it calls and
     runs on the worktree under test.
   - Existing private-corpus suites already work this way, for example
     `CP_SHEET_INDEX_CORPUS` and `ORI_DEFOX_CORPUS`.
2. **Before and after, not stored references.**
   - "Before" is the commit your branch started from (its merge-base with
     main), or any commit you name.
   - "After" is your working copy, uncommitted edits included.
   - Nothing is approved or kept as a reference picture.
3. **The corpus holds frozen copies.** Files are copied in on a date and never
   re-saved in place. The rose is still being edited, so a newer copy is a new
   commit.
4. **Every run uses every file**, except the two 430–455 MB Bodo files, which
   run on request.
5. **Local only.**
   - It runs whenever we change how pictures are captured or drawn, not in CI.
   - CI typechecks the harness along with the rest of the app, so it can't
     quietly break.
   - Each bug fix adds its own synthetic unit test.
6. **Saved simulated shapes are replayed exactly.** Strain and bend metrics
   become a check only once there is a re-solve, because a saved shape's
   numbers can't change with the code.
7. **Fold-linked steps join in Phase 2.** Bugs 1 and 2 are both on
   crease-pattern links. The origami.me corpus already replays Fold landings.

### Where things live

The corpus is `~/Documents/datasets/diagram-corpus/`, a private git repo with
no remote:

```text
README.md        privacy rule, layout, commands, full file list, bug map (file | what it exercises | fixed in)
manifest.json    one entry per case
models/<slug>.osf  frozen, read-only copies (the two big Bodo files are not tracked by git, about 0.9 GB)
results/         git-ignored; "before" results, one folder per commit, reused by later runs
reports/         git-ignored; one page per run
```

The harness is a vitest suite under `apps/web/src/diagram/dataset/`.

- It is gated by `ORI_DIAGRAM_DATASET_DIR`.
- It runs in vitest's jsdom environment, so `readDiagram` sanitizes SVG uploads
  with the app's own default. Without a DOM, Node's `readDiagram` silently
  drops them.

Privacy follows the origami.me and cpoogle corpora:

- Nothing the harness writes goes into the repo or a PR.
- It never uses vitest snapshots, which write beside the test.
- It refuses any output path inside the checkout.
- The report shows third-party designs, so it stays local. Agents send Zach its
  path and never attach it to a PR.
- Synthetic tests are built from scratch, never cut from a corpus file.

### Cases

Each manifest entry holds:

- slug, file, sha256 and the original path;
- the version and date that saved it, and its branch provenance;
- tags (`3d`, `aux`, `spatial`, `simulated`, `fold-step`, `legacy-format`,
  `big`, …);
- the steps expected to open locked;
- every status other than current, with its reason (for example, the box step
  linked to a sheet that no longer exists).

Steps are named by step id and picture key, never by position.

The inventory found 61 candidate files.

- 21 are left out: copies, older saves of the same diagram, or files with
  nothing main can redraw.
- That leaves 40. The default run uses 38 of them, about 400 steps.

The cases that matter most:

- **rose.** Four 3D steps with aux lines and no spread (bug 1). Folded steps on
  aux sheets (bug 2). A saved simulated shape.
- **box.** Its "In progress view": a 3D step with no spread and 13 aux lines
  that no face owns. The spike found it does not show bug 1. Also three
  spatial spreads, and a link to a vanished sheet.
- **crane and heart.** Linked flat folds on aux sheets, References, uploads,
  enlarged steps, flat and crease-pattern backs, and simulated steps on aux
  sheets.
- **Fold-step diagrams** (eight) for Phase 2.
- **Bug repros:** the otters strip, the stray precrease lines, the
  overlap-region cap, the Perspective cases, and others.
- **Older file shapes**, and one file from an unmerged branch whose step opens
  locked.

### Checks

Comparisons are before against after. The checks that need no comparison run on
both sides. Each problem they find is then labelled new, fixed, or already
broken before.

**File check** (no wasm):

- `readDiagram` opens the file writable.
- The locked steps equal the manifest.
- Every asset survives the read, with its kind and bytes.
- Every scene parses, and its key equals `scene-` + digest(sceneJson). This
  holds for the 1,208 scenes in the first 52 files scanned.
- One save reaches a fixed point.
- What the first save changes is the same string before and after, so field
  order counts.
- The whole project serializes with a `minimumReaderSchemaVersion` its content
  allows.

**Repaint** (no wasm, no fonts). Every stored picture is drawn through
`paintedScene` and the scene-to-SVG painter with the diagram's style. The SVG
must be the same before and after. This catches changes that alter saved
pictures at paint time, as open PR #614 does on purpose.

**Status check** (crease-pattern links in Phase 1, Fold links in Phase 2). For
each step, these must be the same before and after:

- link status and refresh kind;
- whether the lighting or style changed;
- paper faces, marks in step, and the zoom area.

**Re-capture.** Phase 1 covers crease pattern, flat (Default spread included)
and 3D without a spread. Each step is captured the way Refresh does it:

- the CP document as `parseNativeProjectFile` reads it;
- the sheet index, and a `sheetPaper` built as `storeSheetPaper` builds it;
- no aux lines when the document has none;
- `knownCreasesOf(source)`, the diagram's style and the spread start;
- English text and counter ids.

Steps the harness can't capture yet are listed as skipped, never passed:
layer-order records, Simulated above 0%, Defox renders, and spatial spreads
(Phase 2).

Before and after are compared in stages:

1. A capture is the same only when the key, the snapped `paperFaces`, and the
   new source (render, fingerprint, thumbnail) all match. The key alone ignores
   paper faces, which drive x-ray, zoom and mark carry.
2. Otherwise, compare counts per kind, role and side.
3. Then compare items in order, within one snap step, with flags matching
   exactly.
4. The same items in a new order are reported as "draw order changed". Such a
   picture can look identical, and that is how 90591a0ca got through.

Default spread runs in Node without the app's time limits. So:

- The harness turns a complexity error into an over-budget scene, as the app's
  capture worker does.
- It records solve and clip time.
- A step over 10 s is marked timing-sensitive and not compared exactly, so a
  busy machine never shows up as a picture change.

**3D window check** (needs no comparison):

- Move the window comparison out of `folded3dScene.test.ts` into a test-support
  module both use.
- Run it on every unspread 3D capture, with the step's own aux lines and
  camera. It counts ink the picture draws where the depth-tested window shows
  bare paper.
- Aux ink there fails. Fold and edge ink is held to the before side's count,
  because the window itself loses concave creases. The existing test allows
  200–600 px for that.
- A synthetic 3D fixture with an aux line on a buried layer goes into the
  window check's own unit test.
- The spike confirmed it flags the rose's stubs, and only them (see the
  checklist). Fold and edge ink the window loses ran to 0–154 px, with or
  without aux lines.

**Edit probes** (Phase 1 is the aux probe). Each runs on a fresh copy:

1. Refresh the sheet's steps, so each link carries this build's fingerprint.
2. Make the edit.
3. Rebuild the snapshot and the sheet index.
4. Capture again.

The rule behind bug 2 is then checked in both directions:

- A step whose capture changed must read out of date. Simulated steps above 0%
  need Pose.
- A step whose capture didn't change keeps its status.

The aux probe's edit is a short Cyan3 segment strictly inside one face of each
linked sheet, added with `insert_line_segments`, which splits nothing.
References cards read stale but are never refreshable, by design. The probe
fails today because of bug 2. Run on the fix branch, it also shows the fix
doesn't over-correct.

**Phase 2 probes and step actions:**

- **Move a sheet.** rc1 links stay as they are; the crane's three old cs1 links
  read missing, by design.
- **Other edits:** swap a fold between mountain and valley, delete a sheet,
  change the light, and toggle #621's "bend along auxiliary creases" setting.
- **Refresh twice.** The second Refresh changes nothing and records no undo
  step.
- **Flip creases** on a back-side crease-pattern step.
- **Default spread** on every flat step: the outcome (solved or refused) is the
  same before and after.
- **An injected spread refusal** still stores a `spreadFailed` picture.
- **Page edits and mark carries.**

**Simulated steps** (Phase 2):

- All 13 distinct simulated pictures go through the repaint.
- For the 5 with a saved shape:
  - The sheet key must still match. A mismatch is a finding for Zach: Pose
    would refold that step from flat without saying so.
  - The redraw from the shape must be the same before and after.
- #621 (merged 2026-11-22) changes the sheet key of a saved pose on a sheet
  with aux lines, and on one whose border has crease-free subdivision points.
  Measured on 2026-11-22; see the checklist.

### The report

- **Only steps that changed are on the page.** It says how many steps were
  checked, how many were skipped, and why.
- **For each changed step, before and after appear side by side** at the same
  scale and framing, so they line up. Nothing is drawn on top of either.
- **One plain line says why the step is listed:**
  - picture changed;
  - draw order changed;
  - status changed, for example from current to out of date;
  - or a check that now fails or now passes.
- **Problems a check finds on both sides go at the end** under "already broken
  before", so they don't crowd out new changes.
- The page is local only.

### Running it

`npm run diagram-corpus` runs `scripts/diagram-dataset/run.mjs`. It works in
four steps:

1. **Check Node.** It stops unless Node is 22.
2. **Before.**
   - Find the base: the merge-base with origin/main, or `--base <ref>`.
   - If results for that base are saved, use them.
   - Otherwise, set up a second checkout of that commit, or reuse one. Copy the
     harness from your working copy into it, so both sides run the same checks.
     Reuse your wasm build when the Rust is the same on both commits; otherwise
     build there, in that checkout's own Cargo target (a shared one would go
     stale silently: Cargo judges freshness by modification times). Run, and
     save the results.
3. **After.** Rebuild what's stale in your working copy (the simulator dist and
   the CP and layer-spread bridges), then run. This happens first in practice,
   because "before" copies the working copy's bridges. Bare `vitest` and
   `node scripts/…` runs skip the npm pre-hooks, and bug 1 lived in
   `packages/origami-simulator`, which the app reads from its built `dist`.
4. **Write the page.**

Every child runs on the runner's own Node, and vitest starts from each
checkout's own `node_modules` with the default reporter. On this machine
`npx` would otherwise find Node 26, and vitest under an agent picks a reporter
that hides output. `--remove-checkouts` deletes the cached checkouts.

Options are `--base <ref>`, `--case <slug>` and `--with-big`. They are passed
to vitest as env vars, because vitest rejects unknown flags.

"Before" can't run on a commit older than the harness. Until the harness is on
main, the only before is the proof's: main with a revert.

**When to run it:** before opening a PR that changes how pictures are captured,
painted, laid out or marked out of date. Each of these places has held a
diagram regression:

- `apps/web/src/diagram/{capture,pictures,pages,document,fold}`
- `cp-workspace/{folded,regions,sheets}`
- `lib/paper` and `lib/nativeProjectFile.ts`
- `layer-spread` and `simulator`
- `packages/{origami-simulator,layer-spread}`
- the CP, fold and layer-spread crates

Diagram changes that only touch the UI don't need it.

## Affected Areas

- **New, outside the repo:** `~/Documents/datasets/diagram-corpus/`.
- **New in the repo:**
  - `apps/web/src/diagram/dataset/`, the harness and its support;
  - `scripts/diagram-dataset/run.mjs`;
  - an npm script.
- **Changed:**
  - `apps/web/src/workers/oristudioCpWorker.ts` moves its API into a factory
    (`oristudioCpWorkerApi.ts`), which the harness calls in-process. Existing
    tests keep their own clients.
  - The window comparison moves from `cp-workspace/folded/folded3dScene.test.ts`
    into test support.
  - `tests/corpus/README.md`, and one line in `AGENTS.md`.
- **Unchanged:** app behaviour. The fixes for bugs 1 and 2 are separate PRs.

## Checklist

Phase 0 — seed the corpus

- [x] Create the private repo with its README (privacy, layout, commands, full
      file list, bug map) and a `.gitignore` covering `results/`, `reports/`
      and the two big files.
- [x] Copy the 40 files (never move them), and write their sha256 list and the
      manifest. Done 2026-11-22: APFS clones made read-only, corpus commit
      8458571; 38 files and 420 steps run by default. `scripts/manifest.py`
      adds, replaces and checks copies. The rose was copied after its 17:14Z
      save, which has two simulated steps with saved shapes.

Phase 1 — before and after on crease-pattern links, catching bugs 1 and 2 (the
spike first; several days in all)

- [x] Check whether saved Simulated poses still load on main after #621. Done
      2026-11-22, by computing each saved shape's sheet key through the app's
      own mesh code on e3f5fb698 (before #621) and on 6056bfaa0 (main):
  - `test-sim-diag` and `start-garland` match on both.
  - The rose's two poses match main but not the older commit. They were saved
    with #621 in, so they load on main and would refold on 0.10.0.
  - `fish` matches the older commit but not main: 960 mesh nodes become 818.
    The sheet has no aux lines, so the cause is #621's border-point merge
    (21e42f26f). Pose would refold it from flat without saying so (read from
    `useDiagramSimulatedPose.ts`, not seen in the app).
- [x] Spike, in two throwaway vitest files (kept untracked under
      `apps/web/src/diagram/dataset/spike/`). Done 2026-11-22 on main:
  - The capture runs headless through the CP worker API in-process (comlink's
    `expose` mocked to hand back the API) and `createBoundCpCaptureRuntime`.
    The Default spread needs its three workers stood in (see Approach).
  - Every linked step of the rose and the crane captured. Each took 0–63 ms;
    each file loaded in under 40 ms.
  - Two runs in separate processes gave identical keys and numbers.
  - Captures often differ from stored pictures, for reasons that are not
    regressions. The crane's flat pictures gained edge lines since October.
    The rose's 3D steps carry aux lines added after they were captured (bug 2
    at work). This bears out decision 2.
  - The window check, with each step's own aux lines and camera, finds 14,
    11, 118 and 117 px of stray aux ink on the rose's four unspread 3D steps
    on main. It finds none with 90591a0ca's simulator change undone, and none
    with the aux lines left out.
  - The box's "In progress view" shows no stray aux ink, so it does not
    reproduce bug 1.
- [x] Branch from current main. Move the CP worker API into its own module
      (`oristudioCpWorkerApi.ts`, an exported object rather than a factory:
      it holds no state of its own), in a commit that changes no behaviour.
- [x] The checks:
  - the file check, the repaint, and the status check (crease-pattern and
    References links; Fold links read with no replay);
  - re-capture with the staged comparison;
  - the 3D window check, moved into test support, with a unit test of its own
    (a stray line is put down to its role). The synthetic bug-1 fixture
    belongs to the bug-1 fix, where it can pass;
  - the aux edit probe, drawn as the Line tool draws an aux line.
- [x] The runner:
  - base detection and the second checkout;
  - wasm reuse when the Rust is unchanged;
  - the saved "before" results;
  - `--base`, `--case`, `--with-big` and `--remove-checkouts`.
- [x] The report page: changed steps only, before and after side by side, no
      highlights, and one line on why each step is listed. Captures are painted
      together on one projection; repaints are each side's own.
- [x] Safety rails:
  - it never writes inside the checkout;
  - without the corpus it skips and lists what it skipped;
  - `ORI_DIAGRAM_DATASET_REQUIRED=1` turns a skip into a failure.
- [x] The proof (2026-11-22, local proof commits never pushed; after = this
      branch):
  - Before = 90591a0ca's simulator change undone: 7 of 420 steps changed. The
    rose's four unspread 3D steps are on the page, each with "New problem: 3D
    window check" (14, 11, 118 and 117 px of aux lines over the paper that
    covers them); a fifth reads "draw order changed". The boat's 3D step 12
    also gains 148 px of fold ink over bare paper: a lead, not checked.
  - The aux probe fails on both sides: 113 steps under "already broken
    before" (bug 2), while every crease-pattern step goes stale correctly.
  - Before = #453 undone by hand (it no longer reverts cleanly: the face's aux
    lines emitted after its edges again): 89 of 420 steps changed, every one
    "draw order changed", in the three crane files (55) and ten more.
  - Confidence. Bug 1, high: the window check flags all four steps on main
    and none with the change undone, and the pictures show the stubs. Bug 2,
    high: 113 folded steps whose picture changes with an aux line still read
    current. The draw-order class, high for detection (exact item match);
    whether each such change is visible needs the pictures.
- [x] `tests/corpus/README.md` and the AGENTS.md line. Open a draft PR.
- [ ] Then fix bugs 1 and 2 in their own PRs, each with a synthetic unit test.
      The bug-2 PR's run shows how many saved steps change status; the
      expected number is 0.

Phase 2 — decide what goes in once Phase 1 has been used on a few real changes

- [ ] Fold-linked steps: status, and re-capture compared with imported marks
      and step text.
- [ ] A Node stand-in for the spatial spread, so spatial 3D steps join
      re-capture and the window check.
- [ ] Simulated steps: the sheet-key check, and the redraw from saved shapes.
- [ ] Pages: the held-page rule, and a store test that opening a file captures
      nothing.
- [ ] The rest of the edit probes and step actions.
- [ ] Bodo steps 147, 168, 190 and 204, named by id.

Phase 3 — when a bug calls for it

- [ ] Timing on the two big Bodo files.
- [ ] Authored cases for paths no real file reaches, added when a bug lands
      there. The gap list lives in the corpus README.
- [ ] Checks that need no comparison for flat pictures (from
      `foldedFlatScene.test.ts`) and for spreads (visibility, slivers, pieces
      on their lines).
- [ ] An opt-in CPU re-solve for simulated steps, graded by strain and bend.
