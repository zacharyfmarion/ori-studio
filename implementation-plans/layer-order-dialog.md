# Layer order dialog

Draft for review, 2026-10-20. Revised the same day after an adversarial
review (47 findings over feasibility, sequencing and fidelity), and again
after your five questions (Fold wasm loading, saved files, landing, paper,
flags). The blocker and every major finding are folded in below.

**Implementation started 2026-10-23,** on `claude/layer-order`. #476 merged
into #475 on 2026-10-21, and #475 is current with main, so the branch is cut
from #475's head (01669590d). The research's `path:line` citations are at
`eb4b51c54`, 174 commits earlier; check them against the branch before relying
on them.

- **Spec:** [product-spec.md](../research/2026-10-19-layer-order-constraints/product-spec.md).
- **Approved design:** "A3 · Constraint builder" on the
  [design canvas](https://claude.ai/artifact/48ECv5vgTcaKZTCHwxwFbu). The
  artboard is `artifacts/layer-order-design/project/Round3.dc.html`
  (gitignored), cited below as Round3:line.
- **Code research behind this plan** (`path:line` at `eb4b51c54`, the head of
  PR #476):
  - [plan-research/engine.md](../research/2026-10-19-layer-order-constraints/plan-research/engine.md);
  - [plan-research/hosts.md](../research/2026-10-19-layer-order-constraints/plan-research/hosts.md);
  - [plan-research/blocks.md](../research/2026-10-19-layer-order-constraints/plan-research/blocks.md).

  This plan cites them as engine §n, hosts §n and blocks §n. Where this plan
  and a research report disagree, this plan wins.

## Goal

Ship the Layer order dialog: steer a flat folded figure's layer order with
subject–verb–object constraints ("C in front of D"), picked on either pane,
previewed before Add.

- **Hosts:** Edit's flat folded figures, an Edit crease-pattern selection,
  Diagram steps, and Pose. On the web and on desktop.
- **Three properties hold throughout:**
  - with no constraints, Edit's and the Diagram's results, and their saved
    files, stay byte-identical to today (Oriedita parity);
  - a chosen order is saved as constraints plus a result, never a case number;
  - nothing the user made is dropped or overridden silently.

## Approach

### The shape of the system

```
Host (Edit figure · CP selection · Diagram step · Pose)
  │ openLayerOrderDialog({ source, record, look })     ▲ apply({ record, relations, source })
  ▼                                                    │   host: fold_with_order → new handle, one undo step
LayerOrderModal (lazy chunk): hook + pure model, PaperPane ×2
  │ comlink
  ▼
Dialog worker (Fold wasm): ConstraintSession over LayerSource::from_oriedita(source)
  + the solution count, in short slices between calls (one cursor serves the count,
    the "3 of 12" index and the stepper)

Host engine (no dialog needed): resolveLayerOrder(source, record, limits)
  a short-lived Fold-wasm worker → per-constraint statuses + the full relations
  used by refold, reopen, Diagram capture and Refresh, Pose, "Another solution"

Display: the host's CP kernel (CP wasm on the web, native through Tauri on desktop)
  fold_with_order(segments, starting face, relations) → a new handle
```

1. **One engine object for the dialog: a constraint session** (engine §1.3).
   - **Where:** a new `oristudio-fold` module, `steer/`, that wraps #476's
     `CompletionSession`.
   - **What it holds:** the committed constraints, the order on screen and the
     forced pairs.
   - **What it adds:**
     - the open pairs, from which TypeScript derives the pickable subjects and
       each subject's open objects. Pairs only the Fold view sees as
       overlapping, which no Oriedita subface shares, are dropped: the host
       couldn't draw them;
     - a preview that never commits, with a deadline;
     - the changed spots per side;
     - the smallest clashing set (traced root seeds, then a deletion filter);
     - packed stacks per side;
     - save, and a restore that resolves face by face (below).
   - **What it adds to the Flat-Folder port** (`treemaker-flatfold`, ours,
     beside the port): `deduce`, a resumable `enumerate`, `traced_roots`, and
     a `check` option that keeps the preferred order on components the seeds
     didn't reach. Without that option, a preview after a stepper move can
     reset faraway components to the open's first order
     (`session.rs:504-531`).
   - #476's `import_session` / `import_check` bindings are not used. They hang
     off Import CP, commit on every fit, and send counts, not data
     (engine §1.1). #476 should drop them before it merges, since nothing
     calls them.
2. **The solver sees exactly Edit's faces** (engine §2.2).
   `LayerSource::from_oriedita(segments, starting_face, aux)` builds the
   solver's folded view from Oriedita's own wireframe over the very segments
   the host folded. So:
   - dialog face *k* is Oriedita face *k*, and the face bridge is the
     identity;
   - any sheet shape or selection works;
   - F lines stay out of the problem, as in Edit.

   **The edge rule is Oriedita's, not the line colours.** Every wireframe line
   that borders two distinct faces is a fold. It is a mountain if the line is
   red, otherwise a valley, so an interior black line folds as a valley, as it
   does in Edit (`initial_hierarchy_from_graph`, `folding.rs:4886-4893`). Only
   a line that borders one face is the paper's boundary. The kernel gains a
   public accessor for line→face adjacency (`line_face_border` is
   `pub(crate)` today, `fold_graph.rs:310`).

   `ImportedPattern` is not used: it is rectangle-only, folds unassigned
   lines, and drops the letters (engine §2.1).
   - **The guard:** a face-ring digest over ring vertex indices and the input
     segment coordinates, never folded or derived floats, so the native CP
     kernel and the Fold wasm agree despite libm differences. It is checked
     when the dialog opens, and again on the new handle at Apply.
   - **Not handled in v1:** non-convex faces (a reflex corner with no crease
     into it). They are refused (D4).
3. **The panes paint with the host's paper, through an existing pipeline. No
   new painter** (blocks §2.2).
   - **The folded pane** is the third user of the pipeline that Fold's folded
     pane (WebGL) and the Diagram, Pose and Edit's export (SVG) already share:
     1. `folded_paper_scene_with_order`, a Rust-only wrapper over
        `paper_scene_impl` with `HierarchySource::Solved` (`folding.rs:2892`),
        reached through the Fold wasm;
     2. `foldedFlatPaperScene({ markHidden: !xray, toScenePx, scale })`
        (`foldedFlatScene.ts`, on main);
     3. `paperSceneToFoldedGeometry(scene, look.style, { policy, faceAlpha })`
        (#475's `cpFoldedToScene.ts:850`, over main's
        `foldedSceneLocalGeometry`), on a `useCpSurface` pane.

     The back is a second scene drawn from the back (`Back1`), as Edit does.
   - **The crease-pattern pane** uses Edit's crease builder, the core of
     Fold's `useFoldCreasePatternStrokes`, with Edit's line colours, whatever
     the host.
   - **The active paper comes from the host,** as a resolved `look` (H1),
     because each host picks its paper differently:
     - Edit: the display style plus the figure's pinned fields
       (`effectiveObjectPaperStyle`), with X-ray on when the figure is in
       Transparent3;
     - Diagram and Pose: the document's style (`diagramScenePaintStyle`) and
       the step's rotation and side;
     - an Edit selection: the display style, with no pins.

     The dialog never sees a figure entry or a Diagram style.
   - **Where the dialog differs from its host,** by design (D18): no layer
     shadows; no Wire2, Transparent3 or Development display styles (X-ray
     stands in); a Diagram step's spread is ignored, because spread faces
     leave their spots; and pens keep a constant width on screen, where the
     Diagram's and Pose's scale with the picture.
   - Only two of Fold's helpers don't apply, `creasePatternPaneLines` and
     `sheetToScene`: the kernel scene has no creases or face transforms
     (`folding.rs:672-705`).
   - **One frame for paint, tints and hits.** A step's turn goes through the
     same map for the scene and for the pane's `modelToSvg`, as FoldPane does
     with its offset.
   - **Hit tests and tints** are TypeScript, through a shared stack hit index
     and tint ladder (blocks §3, §6). The index is built from the same
     subfaces the painter reads, takes non-convex cells (an even-odd test),
     and keeps a convex fast path for Fold.
4. **Hosts display a chosen order through one seeded Oriedita entry**
   (engine §3.2, route C).
   - **The core:** `overlap_enumerator_from_segments_seeded`. With empty seeds
     it runs today's code line for line.
   - **One entry point,** `fold_with_order(segments, starting_face,
     relations)`, which returns a **new handle**. It folds exactly the
     segments the dialog analysed, passed back with their digest, never lines
     reselected from the document, whose order can renumber faces.
   - **Every host uses it:** Edit's Apply, refold, reopen and Fold with layer
     order…, the Diagram's capture, and Pose. A new handle keeps undo correct
     (hosts §1.3c). There is no in-place "show order" in v1: on Pose's held
     fold it would survive an undo, and Pose would redraw the undone order.
   - **Failure:** a typed refusal. The new handle is discarded and the figure
     keeps its picture. Apply checks first and refuses inside the dialog
     (D3).
   - **The snapshot** gains `shown_order`, with
     `skip_serializing_if` so it is written only when an order was given, and
     unconstrained files keep their bytes. (engine §3.2's `#[serde(default)]`
     would write "searched" on every figure.)
5. **Two engine paths over one wasm.**
   - **The dialog's** one worker: its session, which also advances the
     solution count in short slices between calls. It never touches Fold's
     singleton, and closing terminates it (blocks §5).
   - **The hosts'**, `resolveLayerOrder(source, record, limits)`: a
     short-lived Fold-wasm worker spawned per job and terminated after, as in
     `cpExactSolveSession`. A Refresh All shares one across its steps. It
     returns each constraint's status and the full relations to seed. Refold,
     reopen, the Diagram's capture and Pose all go through it, because the CP
     kernel has no complete solver and can't find faces by paper point.
   - **The Fold engine never loads with the page.** #475 keeps its worker and
     wasm (1.26 MB gzipped) out of the service worker's warm set
     (`UNWARMED_PATTERNS`, `vite.config.ts:144-150`, commit 519aacf96), and
     spawns the worker only when something holds the Fold session. This plan
     keeps that:
     - the dialog's worker joins `UNWARMED_PATTERNS` (U6); the shared wasm
       stays excluded by its own name;
     - the host engine starts only on a user action: Apply, Refold, Refresh
       or Refresh All, Show as, Duplicate, a Pose verb, or pressing Layer
       order… or Another solution. Never at file open, on render, on
       selection, in link status, or in Edit's idle 3D rehydrate queue;
     - what hosts show at rest (the subtitle, the flag, a disabled reason, a
       pager's enabled state) comes from saved data, never the engine;
     - hosts reach the host engine through the dialog's lazy gateway, as
       #475's Diagram capture awaits `loadFold()`, so the workspace chunk
       stays as small as ac3f1bb57 made it. A prefetch on intent loads code
       only, never a worker;
     - any new `.wasm` (a dialog-only bridge, a crate rename) is warmed by
       default, so it must be excluded in the same PR.
   - **Cancelling.** The wasm has no cancel channel. Every call carries a node
     budget and a deadline; Stop and Cancel terminate the worker, and the next
     call reopens. A preview already running can't be dropped, only
     superseded when it returns, so the preview deadline is about 3 s, with a
     visible running state.
   - **Pure model:** the reducer, the sentence and a local undo history are
     pure modules beside a binding hook. The dialog component only composes
     (AGENTS.md panel rules, blocks §4).
   - **Keys:** ⌘Z/⇧⌘Z reach the dialog's history through the shortcut
     runtime, never a container `keydown` listener. It can't be a plain
     conditional scope: keys aimed inside a barrier dialog are dropped before
     any scope resolves (#475 `shortcutDispatcher.ts:157-168`), so it is an
     `insideBarrier` option on `handleShortcutKeyDown` (blocks §4.6). The
     native menu's Edit ▸ Undo goes to the open dialog's history, not the
     workspace behind it (today it reaches the workspace behind any modal).
6. **Saved form: one record, shared by both hosts** (hosts §4, engine §5).

   ```ts
   interface LayerOrderRecord {          // compact JSON string, "v":1
     faces: { at: [number, number]; area: number }[];   // paper points + area (split/merge detection)
     constraints: [subject, object, 1 | -1][];           // as built, FOLD sign, paper-relative
     order: [f, g, 1 | -1][];                           // the order at Apply: the pairs the creases leave free
     attention?: {                                      // set after an edit; the host shows it without the engine
       reason: 'conflict' | 'unresolved' | 'timeout' | 'route-3d' | 'detached';
       count: number;
     };
   }
   ```

   - **What a saved file holds.** Today an Edit figure stores its kernel
     snapshot (with `current_fold_case`) and its picture (`renderSnapshot`),
     and a reopened figure draws from that picture with no solver. All of that
     stays. A constrained figure adds one compact JSON string.
   - **Edit:** in the crease-pattern document's existing `extensions` bag,
     keyed by figure id (D15). Every release since v0.2.0 reads the bag, holds
     it and writes it back verbatim, so the reader version doesn't move.
     - **Linking on reopen:** the record attaches to its figure by id only if
       the figure's snapshot has `shown_order: "given"`, plus a `figureKey`
       (a hash of the source fingerprint, and the case). Figure ids are reused
       (`generated-N`), so without the snapshot check, an older build that
       deleted the figure and folded the same region again would inherit the
       record. Old files keep raw fingerprints of up to ~50 KB, so the key
       hashes the fingerprint and never copies it.
     - **Older builds** carry the bag and the snapshot unchanged, and replace
       the snapshot only when they fold again, which detaches the record. It
       is then flagged, never dropped.
   - **Diagram:** on `DiagramCpSource`, which survives Show as and a switch to
     3D (D15). Builds without the key lock that step: it keeps its picture,
     can only be moved or deleted, and is written back unchanged. Each
     constrained step carries its own record.
   - **Zero bytes by default.** A file with no constraints saves byte-identical
     to today, through four rules, each with a test:
     1. `nativeFoldedFigures` strips the in-memory record, set or not;
     2. the bag key is left out when no figure has a record (every CP
        document already writes `"extensions": {}`);
     3. `shown_order` is skipped unless given;
     4. `DiagramCpSource.layerOrder` is left out when absent (the `remembered`
        pattern, #475 `diagramFile.ts:1332`).

     There is no .osf reader bump and no `DIAGRAM_FORMAT_VERSION` bump.
   - **With constraints,** measured over 463 of the 484 cpoogle designs with
     #476's solver (Fold's import of whole sheets; the 21 others are
     non-rectangular or over its cap):

     | | p50 | p95 | max |
     | --- | --- | --- | --- |
     | Face pairs that overlap | 3,543 | 63,610 | 163,352 |
     | Pairs the creases leave free | 96 | 2,432 | 16,352 |
     | **The record** (free pairs) | **3.1 KB** | **40 KB** | **228 KB** |
     | The full order, for comparison | 46 KB | 804 KB | 2.3 MB |

     Deduction forces about 96% of the pairs at the median, which is why the
     record is small.
     The full order is what #475's Import CP already stores per step. A flat
     figure already costs 16–135 KB in a real file (Crane.osf), so a typical
     constrained figure grows by a few percent. The worst case is the iguana
     fixture: an 830 KB record, about 1.35× its ~614 KB figure. E4 re-measures
     through `LayerSource::from_oriedita`, including the 21.
   - **The order holds only the pairs the creases leave free.** The host never
     seeds Oriedita from the record alone: the host engine rebuilds the full
     relations (deduced pairs plus saved ones) first. That keeps files small
     and never leaves Oriedita to complete an order with its weaker closure.
   - **After an edit** (D10), each face is found again by paper point
     and area. Each constraint comes out intact, ambiguous or gone. The intact
     ones are applied, and the shown order is the fitting one closest to the
     saved one. If the intact ones clash, or the check runs out of time, the
     figure keeps its old picture and is flagged. Nothing is applied greedily
     and nothing is dropped. Statuses are recomputed whenever the dialog
     opens; only the summary is stored in `attention`.
   - `WitnessOrder::resolve` is not reused: it fails the whole record on the
     first missing face (`witness.rs:145-195`). The resolver gives a status
     per face, per constraint and per order pair, and reuses only its sign
     rule.

### Phases and pull requests

IDs carry the lane: **E** engine, **U** dialog UI, **H** hosts. "Design gate"
names the mock (listed under Checklist) that the owner approves before that PR
is built.

| # | PR | Size | Depends on | Design gate | Gate |
|---|---|---|---|---|---|
| **Phase 0: engine and proof** |
| E1 | **Kernel: seeded core.** `overlap_enumerator_from_segments_seeded`; seeds carried through `restart_inner` and the render fallback (`HierarchySource::Search`) | S–M | – | – | Oriedita folding oracle (29), render oracle and `tests/folding.rs` unchanged, with the oracle env set locally; property test: empty seeds give the same case sequence through Order 6 on every flat fixture |
| E2 | **Kernel: entry points and exports.** `folded_figure_source`, `fold_source_of_selection`; `FoldedRenderInputs` accessors, including line→face adjacency; `fold_with_order` (new handle, typed refusals); the face-ring digest; snapshot `shown_order` (`skip_serializing_if`); CP-wasm bindings, Tauri commands (`cp_engine.rs`, `lib.rs`), the native client and `cpFoldRuntimeBindings` for those; `folded_paper_scene_with_order`, Rust-only (the dialog reaches it through the Fold wasm, so it needs no binding or command); PORTING.md "Ori Studio native, additive" | M | E1 | – | An unseeded snapshot's JSON, and a saved .osf with a flat figure, equal today's; seeded reproduction on fixtures; the dialog's scene equals the scene read back from `fold_with_order`'s new handle on kabuto and `solution_sample_1`, front and back, so the dialog shows what Apply will; a refusal leaves no handle; native and wasm digests equal on fixtures; `check:desktop` |
| E3 | **Flat-Folder session additions.** `deduce`, resumable `enumerate`, `traced_roots` and the `roots` fields; the keep-untouched-components `check` option; PORTING.md's completion-session section. Lands inside #476 if you agree | S–M | – | – | Randomised test extended; after a stepper move, a preview changes no cell outside the components the seeds reached; `solver_differential` at 0 and the Flat-Folder corpus, run locally in release, results pasted |
| E4 | **Source and census 1 (native).** `LayerSource::from_oriedita` with Oriedita's edge rule, and refusal codes (non-convex, ambiguous overlap, tolerance); Fold-only pairs counted; `oracle-tests/tests/layer_order_witness.rs`; a fixture with an interior black crease | M | E2 | – | **Phase gate 1** (below) |
| E5 | **Constraint session core.** `steer/`: `open`, `open_pairs`, `preview` with a deadline, `commit(prefer)`, `stacks`, `scene`; the record codec with validation; the per-face resolver and `restore` (D10); `oriedita_relations()` | L | E3, E4 | – | Differential against `ImportedPattern` on square fixtures; Oriedita convention test; preview never commits; removal keeps the order; status units on synthetic splits and merges of kabuto; save → restore round trip; a tiny node budget reports a timeout, not "can't fit" |
| E6 | **Explain and solutions.** `explain` (smallest clashing set); the solution count with a stable order and the current solution's index; X-ray stepping (D5) | M | E5 | – | Counts equal brute force (kabuto 9/1, `solution_sample_1` 1/16, `colorconstrainttest` 12/2); property test over random small multi-component problems; the index stays stable across Add and remove |
| E7 | **Wasm bridge.** `layer_*` bindings with typed arrays and deadlines (`clock::now_ms`), a retry with a larger deadline ("keep trying"), close; a size row in the bridge README. Explain and count bindings follow E6 | M | E5 | – | Native bridge tests (the `tests/import_session.rs` shape); wasm bytes recorded |
| E8 | **Census 2 (wasm).** A Node 22 harness over the built bridge (`scripts/layer-order-census.mjs`, local, output pasted): open, preview and count timings and memory per worker, on cpoogle and iguana-c0. Fills the named constants for the count threshold and the label cap | S | E6, E7 | – | **Phase gate 2** (below) |
| E9 | **Stepping without a finished count** (added 2026-10-25, from H6's review). D7 promises ‹ › step when the count is skipped, but a step counted first, so on iguana-c0 (65,851 open pairs) › never moved in Edit, the Diagram or the dialog. A step now enumerates onward from the order on screen in the count's own stable order, remembering what it has seen so ‹ comes back, and reads "Solution k" | M | E6, E8 | – | Stepped sequence equals the counted sequence on the fixtures and in a property test; iguana-c0's › moves (times native and wasm); complete-count behaviour unchanged |
| **Phase 1: the dialog** |
| U1 | **Shared picking and tints.** `cp-workspace/picking/stackHitIndex.ts` (built from the subfaces the painter reads, in its model frame; non-convex cells, convex fast path), `cp-workspace/renderer/fillTint.ts` with Fold's alpha ladder named; Fold moves onto both. Creates `scripts/layer-order-dialog-check.mjs` with a Fold scene | S–M | – | – | Fold's picking, overlay and canvas tests unchanged; hits equal brute force in vitest, with p99 reported, not asserted; Fold before/after screenshots show no change |
| U2 | **ModalFrame.** Fold's Import CP moves onto it | S | – | – | Computed-style proof of no change; styling ratchets |
| U3a | **The native-menu guard** (straight to main). `commands/menuActions.ts` refuses undo, redo and workspace switches while a barrier dialog is open. It fixes today's bug for every modal | S | – | – | Menu-action tests; `check:desktop`; a Tauri dev run: ⌘Z with a modal open leaves the workspace alone |
| U3b | **Dialog keys.** An `insideBarrier` option on `handleShortcutKeyDown`, and a modal-history registration that the U3a guard routes undo and redo to | S–M | U3a | – | Shortcut tests (⌘Z claimed only while the dialog is on top); a Tauri dev run: the menu's Undo undoes inside the dialog |
| H1 | **Record, host contract, file formats.** `lib/layerOrder/layerOrderRecord.ts` (codec, `NEWER`, a 1 MB budget); `PaperFrame`s; `LayerOrderRequest` (`source: { segments, startingFaceId, auxSegments, model, digest }`, `record`, `look: { style, policy, turnDeg, xray }`) and `LayerOrderApplied`; Edit's `extensions` bag with the attach rule (approach 6) and orphan rules; `DiagramCpSource.layerOrder` (key set, lock). Written on #475's reworked `projectSlice`, `nativeProjectFile` and `diagramDocument`; merges after phase gate 1 | M | – | – | Round trips in `nativeProjectFile` and `diagramFile`; the four zero-bytes rules, including a load and save of a bag with foreign keys; an older-reader simulation keeps the bag; a record whose figure id was reused doesn't attach; a `v:2` record locks its step; a size fixture |
| U4 | **Dialog shell.** `layerOrderDialogStore`, a lazy gateway, the `App.tsx` mount, the empty dialog with Cancel and Apply, the opening state with Cancel; i18n scaffolding; a boundary test | S–M | U2, U3b, H1 | Opening | Store and mount tests; the boundary test: `layer-order/` imports no host, nothing outside the gateway imports the dialog, and no production module outside `workers/` imports the Fold wasm glue; `i18n:check` |
| U5 | **Engine client.** The `layerOrderEngine.ts` contract, `faceIndex.ts`, the worker shell and runtime (spawn, generation, dispose); `lib/latestWinsChannel.ts`, with Fold's preview channel moving onto it in a no-change commit | M | U4 | – | Fake-worker tests (dispose, stale counts dropped, Cancel terminates); Fold's preview tests unchanged |
| U6 | **Engine wiring.** The dialog's worker on the bridge, with the solution count advanced in short slices between calls; one worker file; that file joins `UNWARMED_PATTERNS`, so the service worker never downloads it ahead of time; the `sw.js` warm-set diff, chunk bytes and wasm bytes recorded in the PR | S–M | U5, E6, E7 | – | `layerOrderEngine.wasm.test.ts` on kabuto and `solution_sample_1`; a `.wasm.test.ts` that loads the CP and Fold bridges on the same segments asserts equal digests; a forged mismatch refuses the open; `scripts/webkit-pwa-check.mjs`, already in CI, asserts that neither the Fold wasm nor the layer-order worker is cached after the idle warm |
| U7 | **PaperPane.** Extracted from FoldPane at #475's head (no step playback since 4cd968128), which becomes a specialisation, with no visual change. The pure stroke step of `useFoldCreasePatternStrokes` moves into `cp-workspace/`, with line style and width as arguments; Fold's hook stays as a wrapper | S–M | U1 | – | Fold canvas tests unchanged; Fold before/after screenshots |
| U8 | **Panes.** `LayerOrderPanes` on the shared pipeline (approach 3): Front/Back, X-ray, Undecided, tints (hover and clash on the overlay layer; the persistent subject and object tints may use per-face ink) with face picks in `--face-pick` and their rings inside the face (D20), the changed-spot flash, letters and label placement, per-pane zoom and Fit both, the host's `look`, the turn through one map; tap equivalents (D6). Built against fixture scenes, so it doesn't wait on the bridge | L | U7, U4 | Phone, Horizon | Unit tests (tints, labels, letters, X-ray alpha); Playwright screenshots of front, back, X-ray and Undecided on kabuto, `solution_sample_1`, iguana-c0 and a non-convex-cell fixture, in the default and Horizon themes; one side-by-side per host look (an Edit figure on the canvas, a Diagram step card, Pose) with a non-default paper style, expecting the Diagram's and Pose's pens to scale differently |
| U9 | **Inspector model.** The pure reducer and history (behaviour list below); restored records with per-status rows and Apply waiting on a clash; the waiting and timed-out states | M | U4 | – | Reducer tests per behaviour, per status and per waiting state |
| U9b | **Compound constraints in the model** (D21). The sentence's object becomes a set: toggling picks, letter order, the carry-over rules per object; the preview and explain of the whole set through `previewList` and `explainList`; Add commits one constraint per object as one history entry; a selector that groups rows by subject and sign (and status, for carried rows) with per-object removal; the hint line and Add's label; the `objects` bucket on the two events | M | U9 | Compound constraints | Reducer and selector tests per rule above, including a clash on one of two objects, a duplicate skipped, undo of a compound Add, a grouped row's whole and per-object removal, and carried rows of mixed statuses kept apart |
| U10 | **Inspector.** `useLayerOrderDialog`; status and stepper; the sentence builder (face slots, verb menu, the reserved hint line with Keep trying); the constraints list (trash, statuses, faces that no longer exist); compound objects and grouped rows (D21); the five spec analytics events; 8 locales | L | U6, U8, U9b, U3b | Opening, counting, couldn't check, attention | Component tests by role and name; a tracker test per event; i18n; Playwright on kabuto, `solution_sample_1` and iguana-c0: pick, preview, can't fit, Add, undo, remove, back side, a forced timeout (tiny node budget on kabuto), coarse pointer in Chromium and WebKit; the fidelity list below |
| **Phase 1: Edit** |
| H2 | **Host engine.** `resolveLayerOrder(source, record, limits)` on a short-lived Fold-wasm worker (the U6 worker file), loaded through the dialog's lazy gateway; node budget plus deadline; Stop through `withFoldInFlight` and `runStepFold`; engine-loss rule; one worker across a Refresh All | M | E7, H1, U5 | – | Fake-worker tests for Stop and engine loss; a wasm test on kabuto that resolves after a synthetic split |
| H3a | **Edit: the Properties pane** (split from H3, 2026-10-25, so it needn't wait for the dialog). Stacked on its own pre-work PR, which moves the shared `.property-sheet` block into `PropertySheetView.module.css` with no visual change (your choice, 2026-10-25: "in a separate PR first"). The shared renderer gains optional parts other kinds don't use: header actions, a stacked segmented field, a stepper field (the Diagram's pager, moved to `components/ui/`) and a visible note line. A selected folded figure's pane laid out as the Diagram's Step pane, per the approved Properties board: the figure's verbs in the header (Export…, Duplicate, Delete), Render as above a full-width control, a Pose section (Rotation, Side, and a Layer order row whose ‹ › step through the solutions found, as the Diagram's do, ‹ being new in Edit), Camera on 3D, Appearance, Placement. No "Edit…" yet: H3 adds it and the D11 note | M | – | Properties | Component tests by role and name; the parity of every control it moves (each still calls what it called); the ‹ action's store test; computed-style proof for any block it moves; before/after screenshots of the five board states that exist without a record |
| H3 | **Edit: display and Apply.** The `'layer-order'` catalog entry with a disabled-reason `hint` (3D; "Layer order couldn't be determined for this figure"; no source; a newer record), read from saved data; `applyOristudioCpFigureLayerOrder` (`fold_with_order` on the analysed segments, digest re-checked, one undo entry; an Apply that changed nothing writes nothing); reopen through H2, on demand only, never in the idle rehydrate queue; Edit's `look` (`effectiveObjectPaperStyle`, X-ray for Transparent3, the figure's on-canvas rotation); Duplicate carries the record; on H3a's Layer order row, "Edit…" and the D11 note, with ‹ › disabled on a constrained figure until H6; "Another solution" per D9 | M–L | E2, H1, H2, U4, H3a; U10 for its browser gates | Entry points | Store tests, including undo then restyle; parity guard: with no record, exactly today's kernel calls in order; catalog tests; a `Worker`-constructor spy: opening an .osf with a constrained figure and selecting it spawns no worker; Playwright: Apply, undo, redo, reload, duplicate; desktop Apply in a Tauri dev run; `check:desktop` |
| H4 | **Edit: refold with constraints.** Resolve through H2, then a seeded fold; D10; `attention`; a "Review…" action opens the dialog on the flagged rows (D14); a stale figure (D12); a switch to 3D keeps the record (D13), and the idle 3D rehydrate ignores records; `layer constraints need attention` | M | H3 | Attention | Store tests per status; parity guard; Playwright: add two constraints, split a face with a crease, refold, reopen, remove a row, Apply |
| H5 | **Edit: Fold with layer order….** An icon button beside Fold in the selection toolbar only, never the viewport bar (Fold's glyph with a layers badge); a shortcut-registry entry in the Fold category beside Fold (G), shipped with no default chord and on Shift+G since your ask of 2026-10-26 (the checklist), named in the selection toolbar's tooltips, with a translated label in `i18n/shortcutLabels.ts`; the selection toolbar's Fold through a gesture (taking over the standalone undo fix); `prepareOristudioCpLayerOrderFold` (a private handle, freed on Cancel); the selection's `look` (the display style, no pins); one undo entry; `fold attempted`/`completed` with `via: 'layer_order'` | M | H3 | Entry points | Catalog and store tests (Cancel leaves no entry, Apply adds one); Playwright |
| H6 | **Edit: "Another solution" within constraints** (D9). An in-memory cursor on the host engine, created on the first press, never on selection; the enabled state comes from saved data; `fold solution cycled` with `constrained`. Completes Phase 1 as the spec defines it | M | E6, H3 | – | Store and action tests; Playwright |
| H10 | **Fold: Import CP chooses its order in the dialog** (added 2026-10-26, your ask after trying the branch: "when importing a CP in the fold workspace, the modal should open and i should choose a layer order that way"). This was spec decision 6, held out of v1; it comes in now. Fold's Import CP (and Collapse from CP and Update from CP, which also import a crease pattern into Fold) opens the Layer order dialog on the imported crease pattern; Apply imports in the chosen order, Cancel cancels the import, and the import withdrawing (Back, a reset) closes the dialog. With a single layer order there is nothing to choose, so the import goes straight through (my call). `surface: 'fold_import'` | M | U10, H2 | – | Import tests per outcome; the imported state's order equals the dialog's; parity: an import with one order, or with the dialog unavailable, behaves as today; Playwright through the real dialog |
| H11 | **Rotate in the dialog** (added 2026-10-27, your ask: "Can you add left and right rotate buttons here? I want to be able to rotate the model from here. That rotation should be applied in the edit workspace if it's open from there or the fold workspace if we're importing a crease pattern from there, or the diagram workspace if we're opening it from there."). Rotate Left and Rotate Right after Fit on the folded pane's bar, the Pose controls' icons and words; the crease pattern never turns. Your decisions: **15° a press**; the turn **reaches the host with Apply** (rotating alone enables Apply and answers `unchanged` with the turn, no record written, D16; Cancel discards it); **a Fold import stores the imported step itself at the turn** ("so there doesn't need to be a separate rotate step afterward"): `import_turn` turns the held import, and the `cp-jump` op stores `turnDeg`. The turn is a view action in the model, off the ⌘Z history, like Side and X-ray; `layer order dialog closed` gains `rotated` | M | U10, H3, H5, H7, H8, H10 | – | Reducer and outcome tests; each host's turn and its undo; the engine's turn (crate test, and the stored step replayed over the built bridge); one browser check per host |
| **Phase 2: Diagram and Pose** |
| H7 | **Diagram step.** Capture with a record through H2 and `fold_with_order` (Refresh, Refresh All, Show as, Duplicate, paperFaces); the Diagram's `look` (`diagramScenePaintStyle`, the step's rotation and side, no spread); the Step-pane entry, shown disabled with its reason on a 3D step; the pager stop-gap until H9; the readout and link status show the record's state from saved data, never the engine (not #475's `useFoldLinkContext` pattern); the annotation-carry rule; the `needs-attention` outcome and event | L | E2, H1, H2, U4; U10 for its browser gates | Entry points, attention | `captureFolded` and action tests with the parity guard; a `Worker`-constructor spy: opening a Diagram with constrained steps spawns no worker; Playwright on a linked diagram (Apply, undo, Refresh after an edit, Show as round trip), and the dialog drawn in the Diagram's style |
| H8 | **Pose.** Pose's `look` (as H7); the source comes from Pose's held fold; Apply replaces the held fold with a `fold_with_order` handle; `FoldKey` and `linkedFoldKey` include the record's digest, and `historyMoved` releases a held fold whose record no longer matches; the `layer-order` pose request (one "Adjust pose"); the toolbar's ‹ › with no readout, each disabled at its end, and "Edit order…"; Pose's keys stand down; Reset Pose keeps the constraints | M | H7 | Entry points | `linkedPose` and `poseController` tests, including Apply → undo → turn over draws the pre-Apply order; Playwright |
| H9 | **The Diagram's ‹ › within constraints** (D9) | S–M | H6, H7 | – | Action tests; Playwright |

**Phase gate 1 (E4).** Run over the cpoogle designs Oriedita folds flat, plus
the fixtures. The thresholds are proposals for you to accept.

| Measure | Pass | If it fails |
| --- | --- | --- |
| The source's letter seeds equal Oriedita's initial hierarchy, pair for pair | every admitted design | A bug in the edge rule. Fixed before E5 |
| Source refusals | ≤ 5% of designs | Stop. The top refusal code decides: tolerance means fixing the normalisation; non-convex means convexifying moves into v1 |
| `fold_with_order` reproduces a witness from its full relations (Apply) | ≥ 99% of witnesses; every fixture | D3's alternative (draw the order directly when it covers every subface pair) moves into v1 |
| Relations rebuilt from the saved free pairs plus a fresh session's deduction equal the witness's (reopen) | every witness | A bug in the record or the deduction. Fixed before H1 merges |
| Record bytes through `LayerSource::from_oriedita` (Fold's import measured 3.1 KB / 40 KB / 228 KB at p50 / p95 / max; iguana-c0 830 KB) | every design under the 1 MB budget | Apply refuses above the budget, with a reason. A smaller encoding is built only if a real file crosses it |
| Fold-only pairs | reported | – |

**Result, 2026-10-24 (#503): passed on every measure.** It was run natively,
in release, over 489 designs (484 cpoogle, iguana-c0 and the fixtures), all of
which Oriedita folds flat.
- Letter seeds matched on 480 of 480 admitted designs.
- The source refused 9 (1.8%): 8 too deep, 1 with 4,722 faces. None were
  non-convex, ambiguous or out of tolerance.
- `fold_with_order` reproduced 1,467 of 1,467 witnesses, and the reopen
  rebuild matched all 1,467.
- Records ran 3.8 KB / 46 KB / 249 KB, and iguana-c0's was 863 KB.
- There were no Fold-only pairs on any design.
- Watch: on iguana-c0, 1 of 5 checks reached its 30 s deadline with no
  verdict.

**Phase gate 2 (E8).** In wasm, against spec §6.9's targets.

| Measure | Pass | If it fails |
| --- | --- | --- |
| Open p95 | ≤ 1 s | The opening state carries it; above a size threshold the count is skipped |
| Preview p95 | ≤ 200 ms | Previews past it show the running state; past the deadline, "couldn't check in time" |
| Memory per worker, with Fold's, the dialog's and the host engine live | reported | The count's caps are lowered |

If either target misses on most designs, we stop and talk: clause learning is
the known fix, and it isn't built.

**Result, 2026-10-24 (E8): both targets met; memory reported.** It was run
through the built bridge in Node 22 (`scripts/layer-order-census.mjs`), over
the 480 designs the source admits, one at a time.
- Open p95 818 ms on the 475 corpus designs (max 2.3 s; 14 over 1 s).
  iguana-c0 takes 2.3 s, which the opening state carries.
- Preview p95 10 ms (max 57 ms; none over 200 ms). iguana-c0's previews take
  0.66 s at the median and one of eleven passed 30 s: the running state, then
  "couldn't check in time".
- Memory, per instance at its peak (p50 / p95 / max): the dialog 3.6 / 46 /
  118 MiB, the host engine 3.5 / 43 / 116, Fold's worker on the same file's
  Import CP 4.2 / 56 / 155; all three at once 11 / 147 / 388 MiB. The
  count's stored orders are cut from 16 to 4 MiB, with every tally the same,
  which takes up to 48 MiB off the dialog's peak.
- The count's longest call is 59 ms on the corpus, so a preview waits at most
  that behind it. On iguana-c0 its calls reach 454 ms, and in 30 s it shows
  only "at least 1", so above 20,000 open pairs the count isn't started.
- D7's label cap is 50: it letters every open object of 96% of subjects.

The census also found that a position past 2⁵³ (X-ray stepping on three
designs) threw instead of answering. It is now sent capped, as counts are.
For U6: a step while the count is unfinished first counts for half its
deadline, so on the 5 designs whose count doesn't end, 19 of their 20 steps
took 1.4 to 2.5 s of a 5 s deadline. The stepper's deadline should be short.

**E9, 2026-10-25: the stepper without the count.** A step before the count
has what it steps through now searches for the solution the count would
list next, in the count's order, within nine tenths of its limits, and the
count gets the tenth held back, unless the answer came from what earlier
steps proved or the cursor was started with `countInSteps: false` (row E9).
A step that runs out answers `timed_out`; `end` is always a proof. On
iguana-c0, with no count and the dialog's 3 s, in wasm: X-ray › moves in
0.3 s a step (0.9 s the first; with `countInSteps: false`, 2–3 ms, 0.6 s
the first), ‹ back over what it found takes 1 ms, and the positions read
"2 of 2+", "3 of 3+". By picture it does not move: the picture on screen is
the first from the front and the last from the back (each proved in under
1 s), and the next one hinges on whether a picture with the first top of
one and the second of the other exists, which a check leaves undecided
after 600 s (the converse is refuted in 13 s); those steps now say
`timed_out`, at 3, 12 and 48 s. Keeping the count's order there needs that
answer; the options (keep the order, step out of order on figures the count
skips, or clause learning) are in the PR, and the choice is open.

**Where the gates run.**
- **CI:** small fixtures only (kabuto, `solution_sample_1`,
  `colorconstrainttest`), in the workspace test step, not added to the
  Flat-Folder step. That keeps CI spend where it is.
- **Locally, in release:** iguana-c0 and cpoogle, behind an env var (the
  `stacking_corpus.rs` convention), with results pasted into the PR.
- **Canvas gates:** the WebGL canvas needs the Playwright script, run locally,
  with screenshots pasted into each PR. Each host PR extends the same script
  with its flow. It stays out of CI.

**Critical path.** E1 → E2 → E4 → E5 → E6/E7 → U6 → U10 → H3 → H4, H5, H6, then
H7 → H8, H9. E3, U1, U2, U3a, U3b and H1 start on day one. U4, U5, U7, U8 and U9 then
proceed against fixture scenes and fake workers while the engine lane runs.
The dialog meets the engine at U6 and the hosts at H3.

**From 2026-10-25** (the engine lane is done): U4 and H3a first. Once U4's PR
is up, U8, H3 and H7 stack on it. The hosts call the dialog only through U4's
gateway, which takes H1's `LayerOrderRequest` and resolves to its
`LayerOrderApplied` or nothing on Cancel, so their code and unit gates need no
working dialog; their browser gates run once U10 has merged. U10 stacks on U8;
H4, H5 and H6 on H3; H8 on H7; H9 on H6 and H7.

**Landing and launch** (D17).
- **There are no flags, so merged means launched.** A merge to main deploys
  the web app at once (`deploy-web.yml`, on push to main). The desktop ships
  on a `v*` tag, as a prerelease until it's armed. PostHog's feature flags
  would gate product behaviour on analytics, which AGENTS.md rules out.
- **Almost everything needs the Fold PRs.** Only E1, E2 and U3a build on
  main as it is. U1, U2, U4, U5, U7–U9 and H1 build on #475: on FoldPane,
  Fold's picking, import dialog and preview channel, `keyboard/`, reader 11,
  the reworked Diagram source types, `projectSlice` and Edit's folded-figure
  display. E3, E5–E8, U6, U10 and H2–H9 also need #476.
- **Decided (D17): one feature branch,** `claude/layer-order`, cut from #476
  once #475 and #476 are current with main. Every E, U and H PR targets it.
  This overrides AGENTS.md's main-by-default rule for this feature, on the
  owner's word, so it is written here for agents to follow.
  - CI runs on those PRs (`ci.yml`'s `pull_request` has no branch filter),
    but they get no preview: `deploy-pr-preview.yml` builds only PRs to main.
  - Around U10 or H3, a draft umbrella PR from the branch to main gives a
    `pr-N` preview to try, and a dispatched Desktop Build gives a DMG. It
    opens then, not at the start, because every merge into the branch
    re-runs its full CI.
  - Never dispatch Deploy Web App on the branch: it deploys to production.
  - The branch merges to main after H6, when Phase 1 is done as the spec
    defines it, and a release follows. The desktop release is cut and armed
    straight away, because older desktop builds lock Diagram steps that
    carry a record. Phase 2 continues on the branch, re-cut from main, as a
    second release. Until H7, a Diagram step of constrained creases shows
    Oriedita's order, so the release notes say the Diagram follows.
  - This is how #475 is being built (a long-lived branch that `fold-launch/*`
    branches merge into) and how the Diagram was (#436 with PRs stacked on
    it).
- **Straight to main:** U3a, and the first two fixes under "Found in passing".
  None of their files change in #475.
- **E1 and E2** need neither Fold PR (#475 adds one 20-line function to
  `folding.rs`), but they merge into the branch, not main: E1 changes live
  fold code (`restart_inner`, the render fallback), and phase gate 1 can
  change E2's API.
- **If #475 merges first,** the Fold-only refactors (U1, U2, the channel move
  in U5, U7) can go to main directly, so Fold's own fixes don't collide with
  them for weeks.
- E3 goes into #476 itself, if you agree: #476 is a draft that exists for this
  dialog.
- Branch updates are detached merges.
- **The alternative,** if you'd rather land on main as we go: a build-time gate
  on the entry points. Detect CP did this, on main behind `import.meta.env.DEV`
  for six weeks (99bc06908 to f0559ece3). The cost is four entry points, each
  tested both ways, and previews (production builds) wouldn't show the
  feature without a preview-only variable.

**Working rules for every PR.**
- In a fresh worktree, run `scripts/setup-worktree.sh`. After any engine PR,
  rebuild `build:oristudio-cp-wasm` and `build:oristudio-fold-wasm` before
  trusting vitest or the browser. A body-only kernel change leaves the glue
  identical and passes over a stale `.wasm` silently.
- Vitest runs in `apps/web`, on Node 22.
- E1's oracle gate skips silently unless `ORIEDITA_GEOMETRY_ORACLE` is set.
  Build it with `tools/oriedita-oracle/build_geometry_oracle.sh`.
- Rust lanes run with `CARGO_INCREMENTAL=0`, after checking `df`, and at most
  three at once.
- Every PR that adds `t()` strings runs `i18n:extract`, fills the 8 target
  locales, then runs `i18n:stamp` and `i18n:check`.
- The Fold wasm is imported only inside `workers/` and is never warmed. U6, H2
  and any bridge change paste the built `sw.js` warm-set lists into the PR.
- **CI headroom.** The web job already takes 23–28 of its 30 minutes on #475
  and #476, and each PR into the branch costs about 42 runner-minutes. New
  tests go into existing steps. If the timeout bites, it is raised in a PR of
  its own; no new jobs.
- PostHog is off on previews, so the analytics events are checked with
  tracker tests and in dev.
- **Styling.** `.cp-folded-figure-toolbar` (H3) and `.cp-selection-toolbar`
  (H5) are shared blocks: another panel's test and `cpSelectionToolbarDebug.ts`
  look them up. Neither PR should need a new rule, since an entry is a
  catalog item. If one does, it stops and asks you whether to move the block
  first.

**The inspector's behaviour** (U9, from the approved artboard; where blocks.md
disagrees, the artboard wins):
- Only faces with open faces are pickable; the subject slot fills first
  (Round3:1016-1019).
- Changing the subject keeps the object if it is still open, and clears it
  quietly otherwise (Round3:1021-1026).
- A click on empty paper clears the object, then the subject.
- Add commits and clears the whole sentence (Round3:1137, 1230).
- A row click puts its subject in the builder; when it has nothing left to
  choose, the hint line says so in the quiet tone, and the subject slot stays
  active (Round3:1007-1008).
- ⌘Z undoes any inspector action, not only commits: picking or clearing the
  subject, picking or removing an object, changing the verb, Clear, Add (one
  step, however many objects), a row's removal, Clear all, a solution step
  (your words, 2026-10-26: "cmd + z should undo adding a single constraint or
  setting the subject (so basically any action)"). The view toggles (Front/Back,
  X-ray, Undecided) and the panes' zoom are no step (my call): undo in the app
  covers what is saved, never the view. Edit's Flip is undoable because it
  changes the figure the file saves; here Front/Back is a lens Apply never
  writes (spec §5, §6.2).
- Remove and Clear all re-solve for the fitting order closest to the one on
  screen, and flash the spots that changed (Round3:1150-1190). Undo and redo
  restore the exact order the action started from or landed on (my call,
  2026-10-26, from #539's review: relative re-solving made a step's undo stick
  or land on another picture, and undoing everything didn't come back to the
  opening order), and flash the spots that changed.

**Fidelity list** (U8, U10 acceptance):
- The verb menu previews the verb under the pointer or focus (Round3:457, 893).
- On a can't-fit preview, the clashing faces get danger tints and labels on
  both panes, and the clashing rows are marked. Pointing at the reason
  strengthens the tints (Round3:473, 883).
- The faint subject tint is on the crease pattern only (spec §6.4).
- Each pane has its own zoom toolbar, and Fit frames both (Round3:385-389,
  421-425). Each pane fits its own content (the crease pattern it came from,
  the host's `region`, never the rest of a document of many; the folded
  figure itself), filling about 70% of the pane: in your words
  (2026-10-26), "it should not fill totally edge to edge, but like 70% or
  something larger than what it currently does".
- The flash is one 1.6 s fade (Round3:172-176).
- The status dot turns to success when the order is decided (Round3:200).
- The footer note ("Apply keeps the order on screen…", Round3:1536) is
  dropped, per spec §6.7's "no routine status notes".

**Analytics** (spec §10, plus D21's bucket):
- `layer order dialog closed`'s `outcome` is `applied`, `cancelled`,
  `unchanged` (an Apply that changed nothing), `refused` (with the refusal
  code as an enum), `crashed` or `unavailable` (the engine couldn't load),
  so refusals and crashes can be measured (U10's review, 2026-10-25).
- U10 fires `layer order dialog opened` (`solutions_bucket: 'pending'` until
  the count arrives), `layer constraint added`, `layer constraint blocked` and
  `layer order dialog closed`. `subject_origin` and `object_origin` gain `menu`
  (the keyboard face menu) and `list` (a row click).
- `layer constraint added` and `layer constraint blocked` carry
  `object_count_bucket` (D21): how many objects the sentence named, `<=1`,
  `<=2`, `<=5` or `>5` (one, two, a few, many). Each fires once per Add or
  per blocked sentence, however many constraints it makes, and
  `object_origin` is where the sentence's first object was picked. Built in
  U9b (`model/layerOrderAnalytics.ts`); `docs/analytics.md` gets the dialog's
  rows when U10 fires them.
- H4 and H7 fire `layer constraints need attention`.
- H5 tags `fold attempted`/`completed` with `via: 'layer_order'`. H6 tags
  `fold solution cycled` with `constrained`.

**What stays out.** These come later:
- copying constraints from the previous Diagram step (spec decision 5);
- more verbs (spec §6.10);
- 3D;
- convexifying non-convex faces;
- flaps as subjects.

### Decisions

**All decided.** D17 is decided. D1–D5 are taken as recommended: on
2026-10-23 you said "Okay great, please implement" to this plan, which assumes
them. D6–D20 are approved as recommended, with the revised Round 4 boards and
the Properties board, in your words on 2026-10-25: "Approve the revised Round 4
boards, the Properties board, and decisions D6–D20 as recommended." D19's
notice has no board of its own; U10 builds it from the approved copy.

*Before E1:*

- **D1. Engine route C** (spec decision 1). The dialog analyses on the Fold
   solver's session; hosts keep Oriedita and display through the seeded entry.
   *Recommended*, and this plan assumes it.
- **D2. First-version scope** (spec decision 3). *Recommended:* flat figures
   only, the two verbs "in front of" and "behind".
- **D3. When Oriedita can't draw the chosen order**, or can't order the figure at
   all, as with Crane and Heart.
   - *Recommended for v1:* "Layer order…" is disabled with "Layer order
     couldn't be determined for this figure." on figures Oriedita didn't
     solve. Apply refuses inside the dialog if `fold_with_order` can't
     reproduce the order. (No copy names Oriedita: your rule, 2026-10-25.)
   - *Alternative:* draw the order directly when it covers every Oriedita
     subface pair. Phase gate 1 tells us whether we need it.
- **D4. Non-convex faces** (a reflex corner of the paper or selection, with no
   crease into it). *Recommended:* refused in v1, naming the face ("Face B
   isn't convex. Layer order can't work with non-convex faces yet."); convexify
   later.
- **D5. X-ray steps through every layer order** (spec decision 7), before E6.
   *Recommended:* yes, because hidden layers are visible then.

*Before U8–U10:*

- **D6. Phone layout and touch.** *Recommended:* one pane at a time, switched
   from the title row ("Folded | Crease pattern"), with nothing floating over
   either pane (pinch zooms, a double tap fits), and the inspector below,
   capped at about 45% of the height. The hover-only feedback gets tap
   equivalents:
   - a tap on a pickable face picks it and shows its hint;
   - a pressed or focused row lights its faces;
   - picking a verb previews it at once.
- **D7. Large figures.**
   - *Label cap:* the hovered face plus the nearest N keep letters, and the
     hint says "Pick one of the 37 tinted faces". *Recommended*, with N from
     phase gate 2.
   - *A stepper with no total:* when the count is skipped, ‹ › still steps
     ("Solution 3"). *Recommended* over removing the stepper.
   - *Added in U8, 2026-10-25 (my call while you were away; say if not):*
     on iguana-c0 the 50 capped letters piled into one unreadable block at
     fit. So a plain face keeps its letter only where its chip fits on screen
     and has a clear spot; the rest stay tinted, and appear as you zoom in.
     Picked, clashing and pointed-at faces always keep theirs. The hint's
     count still counts every tinted face.
- **D8. Add after a preview runs out of time.** *Recommended:* disabled, with
   "Couldn't check in time" and Keep trying in the hint line.

*Before H3:*

- **D9. The existing pagers on constrained figures** (spec decision 4).
   *Recommended:* "Another solution" and the Diagram's ‹ › step through the
   solutions that fit (H6, H9). Until those land, both are disabled on a
   constrained figure or step, with the hint "Step through solutions in Layer
   order…". With no constraints they behave exactly as today.
- **D10. After an edit, when saved constraints clash or the check runs out of
    time.** *Recommended:* the spec's rule. The figure keeps its old picture
    and is flagged; nothing is applied greedily; the dialog marks the
    clashing rows and Apply waits until one is removed; a timeout offers
    "couldn't check in time" with a retry.
- **D11. What Properties and the Step pane say.** *Recommended:* "3 constraints",
    or "2 layer constraints need attention", on the Layer order row's note line
    in both (the Properties header's subtitle keeps states only). The solution count lives in the
    dialog, because the host never runs the count. The alternative, saving
    "1 of 4 that fit" at Apply, goes stale after the first edit.
- **D12. "Layer order…" on a stale figure.** *Recommended:* it opens on the
    current creases, with a visible notice that Apply also refolds.
- **D13. A constrained figure or step whose creases now fold in 3D,** in Edit and
    the Diagram. *Recommended:* show the 3D picture, keep the record and flag
    it. On a 3D Diagram step, the Step pane shows the entry disabled with its
    reason (spec §7.6).
- **D14. Constraints that need attention.** *Recommended:* the dialog opens on
    them when asked, through a "Review…" action on the flag, never by itself.
- **D15. Saved forms.**
    - *Edit, recommended:* the crease-pattern document's `extensions` bag.
      Older builds carry it unchanged, the snapshot check and `figureKey`
      catch their edits (approach 6), and no file is refused. *Alternative:* a field on the figure plus reader 12,
      which makes older builds refuse the whole file.
    - *Diagram, recommended:* on the step's source, so it survives Show as and
      a switch to 3D.
- **D16. Apply.**
    - An Apply that changed nothing writes nothing.
    - An Apply with no constraints but a browsed solution saves a record with
      no constraints. The figure then leaves Oriedita's enumeration, and
      "Another solution" follows D9.

    *Recommended* on both.

*Added after your questions on 2026-10-20:*

- **D17. Landing and launch. Decided 2026-10-20.** In your words: "Yes, use
  a claude/layer-order feature branch off #476 for every layer-order PR."
  An umbrella PR to main gives previews; the branch is merged and released
  after H6 (see "Landing and launch"). The alternatives were landing inert
  pieces on main and launching with H3, which adds the first entry point, or
  a build-time gate on the entry points, as Detect CP had.
- **D18. Where the dialog's drawing differs from its host** (before U8).
  *Recommended:* the dialog draws paper plus its own X-ray, opening with X-ray
  on when an Edit figure is in Transparent3. It skips Edit's layer shadows
  and its Wire2, Transparent3 and Development styles. It honours a Diagram
  step's rotation and side but not its spread, and it follows an Edit
  figure's on-canvas rotation. The crease-pattern pane always uses Edit's
  line colours.

*Added 2026-10-25, from E5's census:*

- **D19. When the order Edit shows can't fold** (before U10). On 15 of 480
  cpoogle designs (about 3%), Oriedita's own order puts a face inside a fold
  whose crease runs through it. Upstream does the same, and Flat-Folder
  independently rejects that order on the same faces.
  - **The cause:** one of the face's corners sits on the crease, about 1e-11
    off it. Upstream's inside test (`isInside_sweet`) allows only 1e-12
    there, so Oriedita never creates the three-face condition. The port copies
    this, as porting discipline requires.
  - **What happens now:** the dialog can't hold that order. It opens on the
    closest valid order, which Flat-Folder rates valid on all 15. That order
    differs from Edit's picture on 163 spots in total, 0 to 68 per design.
  - *Recommended:* open on the closest valid order and say why in one line,
    with the face and crease lit on both panes: "Edit's order can't fold here:
    face H sits inside the fold at a crease through it. Showing the nearest
    order that folds." Apply then writes the valid order, as any Apply does.
    This becomes a mock.
  - *Also proposed:* report the bug upstream to Oriedita, with the
    triceratops polygon as a self-contained repro.

*Decided in your Round 4 review, 2026-10-25:*

- **D20. Face picks have their own colour.** In your words: "standardize
  around non-theme colors that read well everywhere". The accent was
  Horizon's danger pink and One Dark's valley blue.
  - A picked, pointed-at or pressed-row face is tinted and ringed in
    `--face-pick`: violet, #a78bfa on dark themes and #6d28d9 on light. It is
    set per dark or light type in `applyTheme`, as `--cp-reference-*` are,
    and never from a theme. Over all 23 preset themes it sits 42° from the
    valley blue, 83° or more from every danger colour, and reads at 5.3:1 or
    better on every canvas; a theme test holds it there, as
    `selectionColor.test.ts` holds selections.
  - Its ring sits inside the face, so it never covers a crease's colour.
  - A clash keeps the theme's danger, with its dot and icon. Controls (the
    active slot, pressed toggles, primary buttons) keep the accent.
  - The one hue it shares is the crease palette's purple, which only an
    auxiliary line can have; a fill inside a face and a line don't read alike.
- **"Open spots" is "Undecided":** the toggle tints where the face on top
  isn't decided yet.

*Added 2026-10-25, after the Round 4 approval:*

- **D21. Compound constraints.** In your words: "I should be able to make
  compound constraints, so you should be able to put D in front of H and K …
  The subject should always be singular, just the objects can be multiple.
  Internally they can be stored as individual constraints but in the
  constraints list it should be together." The rules, with my calls marked:
  - **The builder.** The subject slot holds one face; the object slot holds
    one or more. In the object step, a pick on an unpicked face adds it and a
    pick on a picked one removes it, by pointer, tap or the keyboard face menu
    (whose object items become checkable and stay open). Objects read in
    letter order ("H, K"), whatever order they were picked in. The sentence
    stays on one line: the object chips sit inline after the verb, and the
    object slot wraps when it fills (your call, 2026-10-25, over a separate
    line for the objects). So that two objects fit on a line in the approved
    grid, an object chip in the builder is just its letter: a click on it
    removes that object ("Remove H"), and the slot's one × clears them all
    (my call; the list's rows have no per-object ×, your call 2026-10-26).
  - **Which faces can be objects** (my call): the faces open against the
    subject in the committed order, as now, whatever else is picked. Picking
    one never changes which others are offered, so the tints hold still.
  - **The preview** checks the whole set: the committed list plus one
    constraint per object (`previewList`, `explainList`; no engine change). On
    a can't-fit, the smallest clashing set marks the objects in it, on their
    chips and both panes.
  - **Add** reads "Add constraint" with one object and "Add constraints" with
    more. It commits one constraint per object, skipping any already
    committed, as one undo step.
  - **The other rules carry over per object** (my calls): a new subject keeps
    each object still open against it and drops the rest quietly; a pick of
    one of the objects as the new subject removes it from the objects; a click
    on empty paper clears every object, then the subject.
  - **The hint line,** once an object is picked: "Pick more faces to add them,
    or a picked face to remove it."
  - **Saved as before.** The record holds one constraint per object, so H1's
    codec, the engine and the hosts don't change.
  - **The list** (my calls) shows one row per subject and verb: committed
    constraints with the same subject and the same verb, as read from the
    side shown, read "D in front of H, K", at the place of the earliest, and a
    later Add for that subject and verb joins its row. (Not by the stored
    sign: one verb gives objects facing different ways different signs, so
    sign would split your own example.) The row's trash removes
    the whole row, as one undo step. A row has no per-object remove: in your
    words after trying it (2026-10-26), "I don't want individual xs in the
    constraints list if there are multiple objects, they can delete the whole
    constraint if they want." Carried rows group the same way, within one status, so a row
    never mixes statuses; intact and clashing count as one there, since both
    still apply and a clash is marked per object, as on committed rows. A
    row keeps its place and identity when an undo removes one of its
    objects.
    When a row's own objects are the whole clash, it says they can't all fit
    together. A pressed or hovered row lights its subject and all
    its objects; a row click puts its subject in the builder, as now. A clash
    marks the clashing objects within their rows.
  - **Analytics:** `layer constraint added` fires once per Add, and `layer
    constraint blocked` once per sentence (a subject and its verb, until
    either changes, an Add or a clear), each with an `object_count_bucket`
    (`<=1`, `<=2`, `<=5`, `>5`, the events' existing bucket style).
  - **Where it lands:** U9b changes the merged inspector model; U10 builds the
    UI from the "A5 · Compound constraints" board.

**Settled by the spec or the design** (no answer needed):
- Escape closes an open menu first, then cancels (Round3).
- Front/Back is a lens: constraints are paper-relative, and Apply never turns
  the host over (spec §5, §6.2).

**Calls I've made** (say if you disagree):
- **The saved order holds the free pairs only,** and hosts always rebuild the
  full relations through the host engine. It is about 3 KB per constrained
  figure at the median (approach 6), against 46 KB for the full order.
- **A 1 MB budget per record.** Above it, Apply refuses with a reason. No
  cpoogle design comes near it (228 KB at most); the iguana is 830 KB.
- **The count runs in the dialog's own worker,** in short slices between
  calls (decided 2026-10-25, from E6). The stepper and its index need the
  count's cursor in the worker that holds the session; a second worker would
  count twice and hold a second copy of the wasm. A slice delays a waiting
  preview by at most its own length.
- **The dialog reuses the Fold bridge** (about 1,047 KiB gzipped, already
  over its budget, which hasn't been raised). A dialog-only bridge would mean
  another wasm build in CI, and a new `.wasm` the service worker downloads
  for every visitor unless excluded. E7 records the bytes; if the dialog's
  bindings add more than about 50 KiB, I'll come back with the split.
- **Pose uses a new handle,** not an in-place "show order" (approach 4).
- **The keys:** an `insideBarrier` option in `keyboard/`; a keyboard and screen-reader
  face menu by letter; the builder's word order from a translated template,
  so Japanese and Korean can put the verb last.
- **Sizes:** the dialog is `min(1320px,100%) × min(880px,100%)`; X-ray alpha
  is `1 − 0.4^(1/depth)`.
- **The stepper keeps a stable order** ("3 of 12"), not the current solution
  first.
- **Reset Pose keeps the constraints.**
- **The footer note goes.**

**Found in passing**, as separate small PRs straight to main:
- the selection toolbar's Fold seems to skip the undo stack
  (`CpSelectionToolbar.tsx:182` calls the fold directly, where the viewport
  bar wraps it in a gesture). H5's shared `foldBarActions` later takes this
  over;
- undo after "Another solution" probably redraws the undone solution after a
  restyle (hosts §1.4 R4).

Found while building H3 and H7, on main too (own PRs to main, after the
host lane settles; the owner merges):
- undo during a fold then redo brings back a folded figure stuck `loading`
  (entries capture the live list mid-fold); entries should record figures at
  rest everywhere they capture `oristudioCpFoldedFigures`;
- an edit made while a Refold runs can be lost, or its verb can close the
  Refold's gesture under its own label;
- a background 3D rehydrate can adopt onto a figure a Refold is folding;
- Another solution and step-to-case land on whatever figure has their id
  after an undo (#495 lists this as out of scope).
- Already sent: #521 (Pose controller under StrictMode), #522 (undo keeps the
  folded figure's kernel slot; a late fold lands only where it started).

A third, the on-demand flat rehydrate re-enabling "Another solution" and
Duplicate on reopened unconstrained figures (hosts Q8), is a side effect of
H3's new rehydrate, so it can only follow H3.

Settled while building H4, for the PRs that meet it:
- **The request gained two fields:** `applyRefolds` (D12: the foot's note,
  and an untouched Apply on a record still writes, `untouchedApplyWrites`;
  with no record the dialog opens on the order a plain Refold draws, and
  Edit runs that Refold for an untouched Apply) and `review` (D14: opened
  from a flag's Review…; Edit's and the Diagram's both set it). The
  reducer reads them through one helper,
  `layer-order/dialog/layerOrderDialogInit.ts` (`layerOrderRequestInit`),
  which `useLayerOrderDialog` spreads into its init (with its own
  `surface`, `side` and clock), merged after U10: its D16 verdict
  (`no_change`) then honours `applyRefolds`, so an untouched Apply on a
  stale figure whose record restores whole answers applied and refolds it.
- **The foot's note** is U10's `note` prop on `LayerOrderDialogFrame`: D19's
  notice, else D12's note.
- **A 3D figure's record attaches by its key** (D13). Its one blind spot: an
  older build that deletes a 3D constrained figure and folds the same
  creases in 3D again on the reused id inherits the record, flagged as
  waiting; flat figures have the snapshot check for that, 3D ones have no
  flat snapshot.
- **Detached by an older build** (the Refusals board's frame), built in H4.
  A released build detaches a record only by editing the creases and
  refolding, which changes the source fingerprint, so the figure is
  recognised by what every build's Refold keeps instead:
  - **The refold key.** Saved entries carry a `refoldKey`, a hash of the id,
    the title, the placement, the starting face and the region (rounded).
    An `order-not-given` record whose figure is still there, flat, with
    that key is shown for review ("Not applied", Review…, Dismiss), never
    used to fold. The dialog restores it on the figure as folded now, so a
    row whose faces are gone reads as not applied.
  - **Through this build.** The figure holds it through a Refold, a move or
    a rename, and the save keys its entry to the figure as it is then.
  - **Settled.** An Apply takes it up and Dismiss lets it go, each one undo
    entry; the save then drops its entry from `detached[]`, and an undo
    keeps it.
  - **Deleted.** The save marks an `order-not-given` entry whose figure is
    gone `figure-missing`, so a figure folded on the reused id is never
    shown it. `figure-missing` entries stay in the bag, unshown.
  - **No id reused in a session.** Figure ids come from a session high-water
    mark (`foldedFigureIds.ts`) that opening a file raises past every figure
    id it holds and every id its bag names, so a fold after a Delete, with
    no save between, never takes the deleted figure's id.
  - **The session's bag follows each save** (`foldedFigureLayerOrdersAfterSave`):
    an entry a save dropped stays dropped, and a figure that shows a record,
    after an undo, writes its entry again.
  - **`sourceKey`,** the key development builds saved before `refoldKey`, is
    known and ignored: those entries never lock a figure, and are not shown.
  - **Blind spots, display only.** A figure the older build moved or
    renamed shows nothing. One it deleted and folded again from the same
    region, unmoved, on the reused id with the same title, is shown the
    record. Entries saved before the key existed (dev builds only) are
    never shown.
  - **Dismiss** is on the Properties pane's notice only: the toolbar's chip
    is one button, and a second would need a rule in the shared
    `.cp-folded-figure-toolbar` block.
- **A 3D figure whose creases fold flat again,** and whose record a
  refold on them could not draw, is a stale figure on flat creases:
  flagged, opened on them, refolded flat by its Apply.

Settled while building H10 (Fold's Import CP):
- **The engine route: the import is seeded with the dialog's relations,
  over faces matched one for one.** Fold's import traces its own faces
  (`ImportedPattern`), the dialog Oriedita's, so the Fold engine matches the
  two (`oristudio_fold::steer::ImportedFaces`) by the rule a saved record's
  faces are found again by: each Oriedita face's interior point lies in one
  import face, no two in the same one, areas within `AREA_TOLERANCE`, as
  many faces on each side. `import_layer_opening` builds the dialog's
  source from the import's own stored `cpJson` the way Edit folds it whole
  (`CpSession::fold_source_of_selection`, every line, face 1), matches the
  faces, and draws the import's default pick over Oriedita's faces as the
  `shown` scene; `import_pick_layer_order` turns Apply's relations into the
  import's seeds through the match (`ImportedPattern::oriedita_face_seeds`,
  the body Start from Edit's figure already used) and lands the unique
  completion as a pick lands a card. Exact: every pair the dialog relates is
  fixed as it chose it, the letters decide the rest, and an order left open
  is refused rather than guessed. Tested natively (every order the dialog
  steps through lands as that order, and they are the chooser's orders, on
  kabuto and `solution_sample_1`), in wasm (stack for stack) and in the
  browser.
- **The dialog opens on the import's default pick,** held whole, so an
  untouched Apply (`unchanged`) lands that pick: today's import, step for
  step. Its look is Fold's: the sequence's paper through Fold's policy, from
  the side Fold shows and turned as Fold turns it (`ImportedFaces::look`).
- **One order goes straight through,** as it did: the import's own count
  says so for free. A truncated count opens the dialog.
- **When the dialog can't take it** (`busy`, `unavailable`, or the engine
  can't match the faces — an unassigned crease Fold folds and Edit doesn't),
  the canvas chooser asks, as before H10; `busy` says so in a toast, and the
  gateway already says why for `unavailable`.
- **From the review (#541):**
  - *A host can withdraw its ask:* `openLayerOrderDialog(request, { signal })`
    closes the dialog when the signal aborts, answering `cancelled`. Import
    CP's flow aborts it when it lets the import go: a reset, a dispose (Back
    or a workspace switch unmounts Import CP), a newer request, or the step it
    goes after moving under the dialog (an undo).
  - *The mount closes the dialog when the route or the workspace changes
    under it,* for every host: an Apply never lands in a place the user left.
  - *A refusal of the dialog's order* (`import_order_open`,
    `import_budget_exceeded`, any) says "Fold couldn't land this layer order.
    Nothing was imported.", with no Search longer; the pick spends the limits
    the import was opened with.
  - *The dialog's code is fetched only once an import reports several
    orders,* never on Import CP's open.
  - *The face match is checked both ways:* each import face's witness lies in
    the Oriedita face it was matched to (`face_at_paper`), as a restore checks.

### Risks

- **Display fidelity on real files.**
  - `fold_with_order` reproduced 1,685 of 1,685 Fold-generated states. Real
    Edit files are untested.
  - Crane and Heart fail in Oriedita before any seeding.
  - Phase gate 1 measures this on cpoogle, right after the kernel PRs.
- **Deep stacks.**
  - On the iguana a preview takes 0.66 s (median) and up to 2.3 s in wasm,
    and explaining a clash costs a few such checks.
  - "Couldn't check in time" will happen. It rests on node budgets and the
    new wasm deadline, and a running call can only be stopped by terminating
    its worker.
- **Memory.**
  - An iguana import peaked at 170 MB on the old solver. Up to three wasm
    instances may be live: Fold's, the dialog's and the host engine.
  - Mitigations: the count's caps, the host engine is short-lived, and the
    dialog's worker is terminated on close.
- **Two kernels must number faces identically:** the host's CP kernel (wasm
  or native) and the Fold wasm. The digest is checked at open and at Apply,
  and refold and reopen find faces by paper point, never by reused ids.
- **Tolerances on real files.** The Fold view's 1e-6 against Edit geometry may
  refuse some figures as ambiguous. Phase gate 1 reports the refusal codes.
- **Merge order.** #475 and #476 are unmerged. A review change in either can
  conflict across three lanes. The PaperPane extraction touches FoldPane in
  #475.
- **Older builds.**
  - A Diagram step with a record locks in builds without the key, by design.
    The Diagram is live, so real files will meet this.
  - With D15's recommendation, an Edit figure's record survives older
    builds but can be detached by their edits. It is flagged, never dropped.
  - The web ships on merge, but installed desktop apps lag until the release
    is armed. Files saved on the web will open in them, so the desktop
    release follows the merge at once, and its notes say constrained Diagram
    steps lock in older builds.
- **The Fold engine's first-load optimisation** is protected by name lists
  and conventions, and nothing checked it before this plan. U4's boundary
  test, U6's WebKit-lane assertion and the `Worker` spies in H3 and H7 are
  the gates.
- **CI time.** The web job is near its 30-minute limit on the Fold branches,
  and the layer-order tests add to it.
- **"Closest fitting order" is a warm-start heuristic,** not a proven minimum.
  E3's option keeps untouched components exactly as they were. Measured by
  E5's review, one constraint moved 3,721 pairs on one cpoogle design and
  changed the top face of 194 of its 386 spots. A search for the smallest
  change may be worth building later.
- **Oriedita sometimes shows an order that can't fold** (D19, about 3% of
  cpoogle). The dialog opens on a different picture on those designs.

## Affected Areas

- **Rust:**
  - `crates/oristudio-cp` (`folding.rs`, `fold_graph.rs`, `session.rs`) and
    `crates/oristudio-cp-wasm`: seeded core, source export, `fold_with_order`,
    scene with order, digest;
  - `apps/tauri/src-tauri` (`cp_engine.rs`, `lib.rs`): the same entries as
    native commands;
  - `crates/treemaker-flatfold/src/session.rs`, `constraints.rs`;
  - `crates/oristudio-fold/src/steer/` (new);
  - `crates/oristudio-fold-wasm` (`steer/` bindings, README size row);
  - `crates/oracle-tests/tests/layer_order_witness.rs` (new);
  - `PORTING.md`.
- **Web, new:**
  - `apps/web/src/layer-order/`: model, engine client, host engine, canvas
    helpers;
  - `apps/web/src/components/layer-order/`;
  - `apps/web/src/workers/layerOrderWorker.ts`;
  - `apps/web/src/lib/layerOrder/`;
  - `apps/web/src/lib/latestWinsChannel.ts`;
  - `apps/web/src/components/ui/ModalFrame.tsx`;
  - `apps/web/src/cp-workspace/surface/PaperPane.tsx`;
  - `cp-workspace/picking/stackHitIndex.ts`;
  - `cp-workspace/renderer/fillTint.ts`;
  - `keyboard/dialogShortcuts.ts`.
- **Web, reused as they are:** `cp-workspace/folded/foldedFlatScene.ts`
  (`foldedFlatPaperScene`), `cp-workspace/adapters/cpFoldedToScene.ts`
  (`paperSceneToFoldedGeometry`), `cp-workspace/paper/objectPaperStyle.ts`,
  `diagram/pictures/diagramPaperStyle.ts`.
- **Web, changed:**
  - `engine/oristudioCpNativeClient.ts` and the CP worker API;
  - `commands/menuActions.ts`, `keyboard/shortcutDispatcher.ts`
    (`insideBarrier`);
  - `fold/canvas/useFoldCreasePatternStrokes.ts` (its stroke step moves to
    `cp-workspace/`);
  - `cp-workspace/folded/useFolded3dRehydration.ts` (ignores records);
  - `cp-workspace/folded/foldedFigureActions.ts`, `useFoldedFigures.ts`,
    `foldedFigureNotice.ts`;
  - `store/workspaceStore/slices/creasePatternSlice.ts`, `cpFoldRuntimeBindings.ts`;
  - `lib/nativeProjectFile.ts`, `store/.../projectSlice.ts`;
  - `diagram/document/*`, `diagram/capture/*` (including `captureSession.ts`),
    `diagram/actions/diagramLinkedPoseActions.ts`, `poseController.ts`;
  - `components/diagram/DiagramLinkedPoseControls.tsx`, `DiagramStepPose.tsx`;
  - `CpSelectionToolbar.tsx`;
  - the viewport Fold group;
  - Fold's `FoldPane`, `foldPicking.ts`, `foldPaneOverlays.ts`, import dialog
    frame and preview channel (no visual change);
  - `App.tsx`;
  - `vite.config.ts` (`UNWARMED_PATTERNS`);
  - the analytics events;
  - the locales.
- **Scripts:** `scripts/layer-order-dialog-check.mjs`,
  `scripts/layer-order-census.mjs` (both local only);
  `scripts/webkit-pwa-check.mjs` (in CI, one assertion added).
- **Docs:** the spec (§11 links here), `tests/corpus/README.md` (the cpoogle
  run), `PORTING.md`.

## Checklist

- [x] D17: the `claude/layer-order` feature branch (2026-10-20)
- [x] D1–D5: taken as recommended with "please implement" (2026-10-23)
- [x] D6–D8 and D18 (approved 2026-10-25)
- [x] D9–D16 (approved 2026-10-25)
- [x] D19 and D20 (approved 2026-10-25)
- [x] D21: compound constraints (your ask, 2026-10-25; the list's rules are my calls)
- [x] Mocks, each approved before the PRs that name it (canvas v17, approved 2026-10-25):
  - [x] **Entry points:** Edit's figure toolbar and context menu, Fold with
        layer order…, the Step pane row (and its disabled 3D state), Pose's
        toolbar
  - [x] **Opening:** working, with Cancel
  - [x] **Counting:** "at least N", a stepper with no total, a preview
        running, a clash being explained
  - [x] **Couldn't check in time,** with Keep trying
  - [x] **Attention:** rows by status, including faces that no longer exist;
        the clashing set with Apply waiting; the host's flag and "Review…"
  - [x] **Refusals:** "Layer order couldn't be determined for this figure",
        a non-convex face, a digest mismatch, a failed reopen, the stale-figure notice,
        the detached, 3D and newer-record locks
  - [x] **Large figures:** the label cap
  - [x] **Phone layout** and its tap equivalents
  - [x] **Horizon theme** (the accent and danger colours are the same; face
        picks take `--face-pick`, D20)
  - [x] **Properties:** Edit's Properties pane for a selected figure, laid
        out as the Diagram's Step pane
  - [x] **Compound constraints** (D21): the builder with several objects, a
        clash on one of them, grouped rows with per-object removal, phone
        (A5, canvas v19, approved 2026-10-25)
- [x] E1: kernel seeded core (#494)
- [x] E2: kernel entry points and exports (#500)
- [x] E3: Flat-Folder session additions (#502)
- [x] E4: source and census 1 (#503; phase gate 1 passed)
- [x] E5: constraint session core (#504)
- [x] E6: explain and solutions (#509, landed through #505)
- [x] E7: wasm bridge (#505; kept in the Fold bridge, +195 KiB gzipped)
- [x] E8: census 2 (#513; phase gate 2 passed)
- [x] E9: stepping without a finished count (#536)
- [x] U1: shared picking and tints (#497)
- [x] U2: ModalFrame (#493)
- [ ] U3a: the native-menu guard (to main)
- [x] U3b: dialog keys (#498)
- [x] H1: record, host contract, file formats (#496)
- [x] U4: dialog shell (#516)
- [x] U5: engine client (#506)
- [x] U6: engine wiring (#511)
- [x] U7: PaperPane (#501)
- [x] U8: panes (#518)
- [x] U9: inspector model (#510)
- [x] U9b: compound constraints in the model (#515)
- [x] U10: inspector (#525)
- [x] Your feedback from trying the branch (2026-10-26): a grouped row has no
      per-object ×, and ⌘Z undoes every inspector action, not only commits
      (`claude/lo-inspector-undo-all`)
- [x] H2: host engine (#512)
- [x] Your test feedback: Fit at ~70% and only the folded crease pattern (#540)
- [x] Your test feedback: no per-object × and exact undo of every action (#539)
- [x] H10: Fold's Import CP chooses its order in the dialog (#541)
- [x] H11: Rotate Left and Right on the folded pane, your ask 2026-10-27
      ("I want to be able to rotate the model from here"): 15° a press, the
      host takes it with Apply (Cancel discards it), and a Fold import stores
      the imported step at the turn, with no rotate step after it
- [x] Deeper stacks: measured; the dialog's own cap is 20 million triples (#542; 4 of the 8 now open). Going further for your hand model (51.4 M, opens in ~35 s): your call 2026-10-26, "is there a way to cancel and a loading state? If so then raise to 60s" — open and restore deadlines to 60 s, the cap just above it, a "Large figures can take up to a minute" line after 5 s (#545)
- [x] H3a pre-work: `.property-sheet` into a module (#514, no visual change)
- [x] H3a: Edit's Properties pane (#517)
- [x] H3: Edit display and Apply (#520)
- [x] H4: Edit refold with constraints (#529)
- [x] H5: Fold with layer order… (#526)
- [ ] H5 on Shift+G: your ask 2026-10-26, "can you please wire up Shift + G
      to be fold with layer constraints" — Shift+G under both layouts, named
      in the selection toolbar's tooltips beside Fold's G (#553)
- [x] H6: Edit "Another solution" within constraints (#528)
- [x] H7: Diagram step (#519)
- [x] H8: Pose (#523)
- [x] H9: the Diagram's ‹ › within constraints (#532)
- [x] E9 in the hosts and the dialog: ‹ usable and "Solution k" until the
      count is exact, both proved ends kept, Keep trying after a step times
      out, and steps that don't also count in the dialog or above 20,000 open
      pairs (#548)
- [x] CI: cache the Tauri apt packages, after the mirror timed out the native
      job five times on 2026-10-26 (#546; #547 on main)
- [x] Merge main into `claude/layer-order` (the Fold workspace launch #475,
      0.7.0 and 0.7.1; #549)
- [ ] The umbrella draft PR into main, for a preview and a desktop build
