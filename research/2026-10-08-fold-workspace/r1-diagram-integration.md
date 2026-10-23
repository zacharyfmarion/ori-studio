## Summary

- **VERIFIED:** A Diagram step stores one captured picture plus where it came from. It never re-runs a fold on open (`diagram-workspace.md` D2/D4). On PR #436 (31e1d6d84) a flat-folded picture comes from the Oriedita kernel. The step's region is folded, a layer order is picked by index (`foldCase`), and the kernel returns an `OristudioCpFoldedPaperScene` (schema 3). That scene goes through `foldedFlatPaperScene` and is stored as `sceneJson` plus `paperFaces`.
- **VERIFIED:** Everything after the fold consumes that kernel scene shape: painter's order, woven patches, the depth and affine spreads, `paperFaces`, mirror axes and Upright, behind-flap dotting, and moving annotations when the pose changes. **INFERRED (main recommendation):** if the Fold engine emits a superset of `OristudioCpFoldedPaperScene` (schema 3) for each step, the Diagram can draw, pose and annotate a Fold step without the Oriedita kernel and without re-running the fold.
- **INFERRED:** A Fold step should be a new source kind, `fold-step`. It should not reuse `cp` (the source that links a step to a region of the Edit crease pattern). The `render` pose type should be shared, so the existing verbs (turn over, rotate, spread, Upright, Show as) work on both. The layer order is fixed by the history, so there is no ‹ Layer order n of m ›.
- **VERIFIED:** The annotation kinds a Fold step needs already exist: valley, mountain, fold-and-unfold, push and pleat arrows; valley, mountain and hidden lines; callout; and turns between steps. A planned mechanism for tagging imported marks, not built at 31e1d6d84, would let generated marks stay editable. The References geometry code works on a single flat sheet, so the Fold engine must supply the geometry of each action.
- **VERIFIED:** Neither roadmap mentions diagramming or fold sequences. `PRODUCT_ROADMAP.md:288` and `WEB_ROADMAP.md:181` mention only fold-assignment display. The Diagram plan lists "Generating a fold sequence from a crease pattern" as a non-goal (`diagram-workspace.md:91-93`). A Fold workspace builds sequences forward, so it does not hit that non-goal.

---

## Diagram data model

All paths below are at commit `31e1d6d84`. None of the `apps/web/src/diagram/**` code is on this branch (VERIFIED: `ls` finds no `apps/web/src/diagram`, and `regionIdentity.ts` exists only on the PR).

| Type | Where | What it is |
|---|---|---|
| `DiagramDocument` | `apps/web/src/diagram/document/diagramDocument.ts:1020-1033` | `{formatVersion, id, title, hanStyle, style, page, steps: DiagramEntry[], assets}`. It belongs to the project, not to the CP document (D1, plan `:307-340`). |
| `DiagramEntry` | `:1003` | `DiagramStep \| DiagramTurn`. A turn has no number (D22, `:982-1000`). |
| `DiagramStep` | `:937-976` | `{id, revision, source, picture, annotations, annotatedPictureKey, text, breakBefore, zoom?, place?, placeNewer?, unknown?}` |
| `DiagramStepSource` | `:478` | `upload \| cp \| references-step` |
| `DiagramCpSource` | `:341-359` | `{kind:'cp', scope, fingerprint, thumbnail, render, remembered?}` |
| `DiagramCpScope` | `:109-115` | `{kind:'segment', region}`. The doc comment says the `kind` "leaves room for another way in a later file". |
| `DiagramCpRender` | `:121-152` | `crease-pattern{rotationDeg, side?}`, `folded-flat{side, rotationDeg, foldCase, spread?}`, `folded-3d{camera, side}`, `simulated{foldPercent, view}` |
| `DiagramReferencesSource` | `:431-471` | A snapshot of a References card: region, fingerprint (or null), thumbnail, mode, settings, card, line, side, plan?, way?, sentence? |
| `DiagramPicture` | `:574-578` | `asset \| scene \| fixed \| step-diagram` |
| `DiagramScenePicture` | `:508-525` | `{sceneJson, paperScale, styleKey, key, paperFaces?}` |
| `DiagramPaperFaces` | `:536-547` | `{points:[paperX, paperY, sceneX, sceneY][], rings, levels}` |
| `DiagramAnnotationKind` | `:596-615` | 19 kinds (listed under Auto-annotations) |
| `KnownDiagramAnnotation` | `:772-883` | Picture units: origin at the frame's top-left, longer side = 1. Fields include `from`, `to`, `bend`, `path`, `back`, `behind`, `kinks`, `mirrored`, and others. |

**What a step stores (VERIFIED):**
- the source as provenance: scope, fingerprint, thumbnail, the pose (`render`), and the pose each other way of showing last had (`remembered`);
- the captured picture: `sceneJson`, hidden items dropped, quantized to 0.01 px (`captureGeometry.ts:54-90`), its key `scene-${digest}`, plus `paperFaces`;
- annotations in picture units, `annotatedPictureKey`, the instruction text, page placement and the zoom frame.

A simulated step will also store its mesh (`render.shape`: positions and crease angles, "not gestures"; `diagram-pose-simulator-tools.md:266-360`, D1 `:639`). That is the closest precedent for "store the state, don't re-run".

**What is derived and never stored (VERIFIED):**
- the step number (position, turns excluded; `:1164-1180`);
- link status `current | stale | missing | unknown` (`capture/linkStatus.ts:76-90`);
- lighting staleness and `refreshKind` (`:60-69`);
- the picture frame (scene bounds, `pictures/pictureFrame.ts:50-70`);
- picture geometry: snap points, layer covers (`annotate/pictureGeometry.ts:56-92`);
- page layout and scale;
- enlarge arrows;
- whether annotations are out of step with the picture (key comparison).

---

## Folded pictures today

**The pipeline for a flat fold (VERIFIED, `capture/captureFolded.ts`):**
1. `chooseStepCreases` finds the region in the kernel-space segmentation by its rim and fingerprint (`captureCreases.ts:103-125`). It returns `foldLineIds` (the region's foldable lines, in kernel order) and the `rc1:` fingerprints (`:44-64`).
2. `resolveFoldRoute` decides flat or 3D (`captureFolded.ts:411-413`).
3. `openFold(runtime, lineIds, captureModel(document, side))`. The model is pinned to `rotation 0, scale 1`, `Front0`/`Back1` (`:110-120`); the pose is applied to the picture, never to the fold.
4. **The layer order is a choice.** If `render.foldCase > 1`, `runtime.foldToCase(handle, n)` runs, clamped to the cases found so far (`:432-437`). Pose exposes this as ‹ Layer order n of m › (D23, plan `:1551-1553`). The capture session keeps `reached` because `foldToCase` backwards replays the search (`captureSession.ts:62-67`).
5. `readFoldedPicture` gives `{snapshot, scene: OristudioCpFoldedPaperScene}` (`lib/creaseExportFold.ts:89-93`).
6. `flatPicture` turns the result by `rotationDeg` and runs `foldedFlatPaperScene` (whole faces in painter's order, woven patches, optional spread). `flatPaperFaces` and `storeScene` follow (`captureFolded.ts:220-245`, `:128-152`). The kernel `snapshot` is used only for the fallback when there is no layer order (`:242-244`).
7. `setLinkedPicture` commits the new source and picture and carries the annotations (`diagramDocument.ts:1375-1402`).

**The kernel scene everything consumes (VERIFIED, `engine/oristudioCpTypes.ts:529-570` at the PR):**
- `faces[]`: `{outline, points (vertex ids), front_up, edges[{kind: border | fold | flat}]}`;
- `subfaces[]`: `{polygon, faces_top_to_bottom}`, which carries the layer order;
- `aux_lines`, `sheet`, `flipped` (the back pass is mirrored and its stacks read bottom-up);
- `sheet_points`: each vertex's place on the unfolded sheet (schema 3).

The same type feeds `layerLevels`/`layerSpread`/`affineSpread` (`cp-workspace/folded/foldedLayerSpread.ts:233-260`, which fits each face's map from `sheet_points`), `foldedMirrorAxes` (`capture/mirrorAxes.ts:163`), and `flatPaperFaces` (`capture/capturePaperFaces.ts:54-95`).

**Pose (VERIFIED).** `CaptureSession` (`captureSession.ts:95-153`) holds the kernel handle. It turns over by a model change, steps to the next solution on the same handle, and redraws turns and spreads from the held scene without calling the kernel. Annotations are carried only when the side and `foldCase` are unchanged (`annotate/annotationCarry.ts:170-196`).

**Where a Fold step fits (INFERRED).** A Fold step's layer order is a result of its history, not a search. Most of the pipeline does not apply: segmentation, route, `openFold`, `foldToCase`, and the handle and epoch bookkeeping. Steps 6–7 apply unchanged if the engine supplies the scene. It should be a new link kind (below), not another `foldCase`.

---

## Proposed Fold-step link

### Source kind or scope kind (INFERRED)

Two options:

- **A (recommended).** A new `DiagramStepSource` kind, `fold-step`.
- **B.** A new `DiagramCpScope` kind inside `cp`, which `diagramDocument.ts:110-114` anticipates.

I recommend A. `cp` means "a region of the Edit crease pattern", and many paths assume it:
- link status and segmentation (`linkStatus.ts`);
- Open in Edit, and Simulated through `CpSegment` (`captureFolded.ts:316-320`);
- thumbnails;
- the move-and-relink logic (`followedScope`, `captureCreases.ts:206-209`).

Under B, every `scope.region` reader would have to branch: 20+ reads of `scope`/`render.mode` across about 30 files (counted with grep). Under A, about 70 `source.kind` checks across about 30 files need review (also counted). Most of those only need "a posed flat fold". That suggests a small refactor: one accessor (for example `posedRenderOf(step)`) that returns the `render` of a `cp` or `fold-step` source. The pose verbs, Upright, spread, `paperFaces`, the carry and `paintDiagramStep` would key on it.

One trap (VERIFIED): `stepPictureSource` decides whether a scene is measured as a pattern sheet or a folded figure with `!(source?.kind === 'cp' && source.render.mode !== 'crease-pattern')` (`pictures/paintDiagramStep.ts:160`). A new kind would be measured as a crease pattern unless that line changes.

### What the link stores (INFERRED)

```ts
interface DiagramFoldSource {
  kind: 'fold-step';
  sequence: string;          // FoldSequence.id ('fold-<uuid>'), a project-level document like the diagram (D1)
  step: string;              // FoldStep.id ('fstep-<uuid>'): the action this picture depicts
  shows: 'before' | 'after'; // the state before the action (with its symbols) or its result
  fingerprint: string;       // 'fs1:' digest of the canonical state shown (see Identity)
  history: string;           // 'fh1:' digest of the action list up to `step`: a cheap "did anything change" check
  engine: number;            // Fold engine schema/version that computed it
  action: FoldActionSummary; // kind, M/V, layers spec, fold line in paper coords: draws the symbols without the Fold doc
  thumbnail: SheetThumbnail;
  render: Extract<DiagramCpRender, { mode: 'folded-flat' | 'crease-pattern' }>; // foldCase pinned to 1 or dropped
  remembered?: Partial<Record<'crease-pattern' | 'folded', DiagramCpRender>>;
  sentence?: string;         // the generated instruction, for D20's "words are the card's until edited" rule
}
```

The picture stays a `scene` with its `paperFaces`. Add one compact field next to it: `foldState?: string`, the step's `FoldedStateSnapshot` as a single JSON string, as `sceneJson` already is (the `.osf` pretty-printer would otherwise put each number on its own line; plan `:353-355`).

Why each part:
- **Ids, not geometry.** Fold step ids are UUIDs the Fold document owns, like the Diagram's own `step-<uuid>`. Plan `:77-84` bans ids because Edit's crease and segment ids are reassigned; that reason does not apply here.
- **`fingerprint` and `history`.** Inserting or editing an earlier fold changes every later state, but the `step` id still names the action the author drew. The digests tell `current` from `stale`.
- **`foldState`.** Pose verbs need the scene, not the picture: turn over needs the back pass, a spread needs `sheet_points` and subfaces, Upright needs the faces. Simulated steps keep their mesh for the same reason (pose-simulator-tools D1). It also keeps the step poseable if the sequence is deleted, which matches D6, where a References step stays a snapshot.
- **`action`.** Symbols can be regenerated, and Replace can swap tagged marks, without the Fold doc.

### Status, Refresh, pulling (INFERRED)

Status follows the D2/D3 vocabulary:
- `missing`: the sequence or step is gone;
- `stale`: the recomputed `fs1:` differs from the stored one;
- `current`: they match;
- `unknown`: the engine is not ready.

Refresh can be exact, unlike References: replanning there is "seconds to minutes and need not give the same step" (`diagramDocument.ts:425-430`), while a Fold sequence is deterministic. Still, never refold on open (D4) and never silently in bulk.

Pulling should copy D20's browser and `pullReferencesSteps`:
- the Fold sequence's turn-over and rotate actions become `DiagramTurn` entries, as a References turn-over card does (`references/referencesPulledSteps.ts:117-120`);
- each fold action becomes one step that `shows: 'before'`, with lifted marks;
- one final `after` step shows the result, like the "Finished" card.

Pose on a Fold step:
- a `FoldPoseSession` implements `flat`, `turnOver`, `flatPicture` and `flatMirrorAxes` of `CaptureSession` (`captureSession.ts:95-153`) from the held snapshot;
- `nextSolution` refuses: the order comes from the sequence;
- Show as offers Crease pattern and Folded only. Simulated needs a `CpSegment` and is out for V1.

### Validator (VERIFIED, then INFERRED)

`SOURCE_KINDS = {'upload','cp','references-step'}` (`document/diagramFile.ts:449`). An older build therefore reads a `fold-step` step as a newer build's and carries it locked (`:566-580`). Today a picture whose source the reader does not recognize is dropped (`:612-613`), so `readStep` needs a `fold-step` branch like the `cp` one, including a check that `paperFaces` matches the scene.

---

## Auto-annotations

**The kinds a Fold step would generate (VERIFIED, `diagramDocument.ts:596-615`):**

| Annotation kind | Generated for |
|---|---|
| `valley-arrow`, `mountain-arrow` | simple folds |
| `fold-unfold-arrow` | precreases |
| `push-arrow` | reverse folds, sinks, squash |
| `pleat-arrow` (`kinks` 1–5) | crimps, pleats |
| `valley-line`, `mountain-line` | the fold line |
| `hidden-line` (X-ray) | hidden fold lines, hidden edges (role `diagram-hidden`, `packages/origami-simulator/src/paperScene.ts:50-61`) |
| `callout` | "repeat behind" |
| `angle-mark`, `divisions`, `right-angle` | references a step folds to |

Turn over and rotate are not annotations. They are `DiagramTurn` entries (D22), and their Annotate tools were removed (plan `:1504-1507`).

Other relevant pieces:
- **Behind a flap:** `behind: {from?, to?}` dots an arrow from an end that lies under n layers. It is read from the stored scene's paint order (`annotate/behindFlaps.ts:1-18`, `pictureGeometry.ts:80-92`). A mountain fold, which swings a flap behind, maps onto it directly.
- **Existing creases** are not annotations. In References they are style `crease`, drawn with the `aux` role (`references/diagramToPaperScene.ts:125`). In folded scenes they are the kernel's per-face `aux_lines`.

**Where placement geometry is computed today (VERIFIED):**
- **References cards:**
  - `plannerDiagram.ts`: `movingSide` (`:561-598`) picks the side that swings by alignment, then by the smaller flap (`flapArea` `:502-505`); also `clipPolygonToSide`, `reflectAcross`, `creasedSpans`.
  - `foldMotion.ts` reads the swinging flap from the card's own arrow.
  - `stepDiagramGeometry.foldArrowArc` (`:480-489`) is a verbatim port of `RefDgmr::CalcArrow`: a 60° arc that bulges toward the sheet's middle.
  - `pushArrowOutline` and `pleatArrowShape` draw push and pleat arrows.
- **Hand-drawn Diagram marks:** `annotationModel.createAnnotation`/`defaultBend` (`:1062-1069`, `:1082-1140`) bulges away from the frame's middle, because Zach flipped nearly every arc (2026-10-06). Generated arrows should go through this path so they match hand-drawn ones.

**The gap (INFERRED).** All the References geometry assumes one convex sheet polygon (`sheetPolygon`). It cannot tell which layers of a folded stack move, whether the fold line is visible or under a flap, or where the moving flap's visible tip is. The Fold engine knows all of this exactly. It should emit a pose-independent `FoldActionGeometry` in the snapshot's folded coordinates (see Engine contract). A pure Diagram-side compiler `foldStepMarks(geometry, render, frame)` would then:
1. map folded coordinates to scene px by the capture's turn (`captureFolded.ts:228-232`), then to picture units by scene bounds (`pictureFrame.ts:61-63`);
2. build annotations with `createAnnotation`;
3. set `behind` from the stack;
4. swap valley/mountain on the back. RM7 plans this rename for carries (`diagram-references-annotations.md:529-550`).

The marks should arrive editable and tagged, reusing the planned `imported: 'untouched' | 'edited'` tag and the Replace and Way swap rules (`diagram-references-annotations.md:493-560`, RM6). That plan is DECIDED but unbuilt at 31e1d6d84: `grep imported` on `annotationModel.ts` finds nothing. A spread moves lower layers, and the carry follows the nearest layer only (`diagram-distortion.md:114-122`). Marks on lower layers should therefore be generated after the spread is applied, or anchored to faces through `paperFaces`, which the carry already uses (`annotationCarry.ts:234-280`).

---

## Identity

**Today (VERIFIED, `cp-workspace/regions/regionIdentity.ts`).**
- `rc1:` (`:31`, `:67-100`) is a set fingerprint of crease lines. Endpoints are taken relative to the lines' own lower-left corner and quantized to 2⁻²⁰ of their size, so dyadic coordinates never land on a rounding boundary (`:33-46`). Colour, customization and fold magnitude are included; the result is sorted and digested.
- A move is not a change; a rotation or flip is.
- `resolveMovedRegion` (`:174-195`) finds a region in its old place, else the nearest region of the same outline with an identical fingerprint, else none. It never guesses.
- A step keeps the fold-lines fingerprint or the drawn-lines fingerprint, depending on how it shows the pattern (`captureCreases.ts:197-199`).
- Status compares the two (`linkStatus.ts:76-90`).
- `cs1:` is the older absolute form. The prefix names the rule ("no lock-in").

**What Fold needs (INFERRED).** Fold does not need `rc1:` or `resolveMovedRegion` to find "which step": its ids are stable. It does need a content fingerprint of states:
- **`fs1:` canonical `FoldedState` digest.** Each face is keyed by its paper polygon (quantized like `rc1:`, relative to the sheet corner, ring rotated to a canonical start). Add each face's folded image (quantized, relative to the figure's lower-left), the stacking relation as sorted `(aboveKey, belowKey)` pairs for overlapping faces, and the crease list (paper segments, assignment, folded or flat). Digest with the same `keyDigest`.
  - This is independent of face numbering and engine internals.
  - A fix in the engine that changes a result marks steps stale, which is the honest outcome.
  - It doubles as a cache key and as the picture key's input.
- **`fh1:`** digest of the canonical action list (a prefix). Cheap, but it cannot see engine changes, so it supports `fs1:` rather than replacing it.
- **Face lineage across steps** (each face's parent face in the previous state) is worth emitting. Revision 2's enlarged frames find "the same paper" on each step by a point on the paper because "faces differ between steps" (`diagram-revision-2.md:1487-1496`, Z9 `:1509-1515`). With `sheet_points` the existing point lookup already works; lineage would make anchor choice exact. It is optional.
- If a sequence's crease pattern is later sent to Edit, its `rc1:` over the Edit lines could record provenance from the Edit region back to the sequence. This is optional and not needed for the Diagram.

---

## Engine contract

The minimum the Diagram needs to draw a Fold step without re-running the fold (INFERRED). It is pure data, deterministic, one per state:

```ts
interface FoldedStateSnapshot extends OristudioCpFoldedPaperScene /* schema 3, front pass: flipped=false */ {
  // Inherited, consumed today: sheet, faces[{outline, points, front_up, edges}],
  // subfaces[{polygon, faces_top_to_bottom}] (the layer order), aux_lines (existing
  // creases on each face), sheet_points (paper coords per vertex).
  fold_schema: 1;
  /** Paper → folded isometry per face (rotation, translation, reflect flag): exact, no fitting. */
  face_transforms: { a: number; b: number; c: number; d: number; tx: number; ty: number }[];
  /** The crease pattern so far, paper coords: for Show as Crease pattern and for fs1. */
  creases: { a: Point; b: Point; assignment: 'M' | 'V' | 'F' | 'B'; madeAt: number }[];
  /** Optional: the face this one was split from in the previous state. */
  parent?: (number | null)[];
  fingerprint: string; // 'fs1:…'
}

interface FoldStepRecord {
  id: string;                    // 'fstep-<uuid>'
  descriptor: FoldDescriptor;    // kind, line, assignment, layer selector: what produced it
  before: FoldedStateSnapshot;
  after: FoldedStateSnapshot;
  geometry: FoldActionGeometry;  // in `before`'s folded coords
  sentence?: string;
}

interface FoldActionGeometry {
  kind: FoldKind;                               // 'valley' | 'mountain' | 'fold-unfold' | 'inside-reverse' | ...
  line: [Point, Point];                         // fold line clipped to the silhouette
  spans: { from: number; to: number; hidden: boolean }[]; // along `line`: visible vs under layers
  assignmentFromFront: 'valley' | 'mountain';
  moving: { faces: number[] };                  // indices into before.faces
  grip: { at: Point; image: Point; hiddenAt: number; hiddenImage: number }; // arrow tail/tip and layers over each
  push?: { at: Point; toward: Point };          // reverse/sink/squash
  pleat?: { from: Point; to: Point; kinks: 1 | 2 | 3 | 4 | 5 };
}
```

How it maps onto existing consumers (VERIFIED that each consumes only these fields):
- `flatPicture({snapshot, scene}, rotationDeg, env, spread)` needs only `scene` when faces exist (`captureFolded.ts:227-241`). It needs a small change: `snapshot` optional, or a `flatScenePicture(scene, …)`.
- `flatPaperFaces`, `layerLevels`, `affineSpread` and `foldedMirrorAxes` read `faces`, `subfaces` and `sheet_points`.
- The back pass must match the kernel's `flipped` semantics: mirrored, stacks bottom-up (`oristudioCpTypes.ts:531`). The engine can expose `snapshotSide(state, 'back')`, or a pure TS `seenFromBack(scene)` can produce it. The mirror axis has to match the kernel's, because Turn Over negates the rotation (`renderToShowAs`, `diagramDocument.ts:387-394`).

**Units (INFERRED).** Fold paper should use the Edit document's units. `CAPTURE_PX_PER_UNIT` (`captureGeometry.ts:19-22`) then gives Fold steps the same `paperScale` as Edit captures, and D10's Fit-each scale runs keep the model visibly shrinking between steps.

---

## Open questions / risks

1. **Before or after.** I assumed a step shows the state before the action with its symbols, plus one final result step, as References cards do. A product decision for Zach. It decides whether `shows` is needed and whether a pull makes n or n+1 steps.
2. **Snapshot size.** `foldState` plus `sceneJson` plus `paperFaces` triples the geometry per step. Precedents: Z11 (`diagram-revision-2.md:1522-1530`), a whole-file budget of ≤1% growth; and a 1 MB writer cap for simulated shapes. Weigh this on real sequences before choosing between storing it inline and storing only a reference that needs the Fold doc to re-pose.
3. **The back pass.** If a TS flip and the kernel's `Back1` disagree on the mirror axis, Turn Over, `renderToShowAs` and the annotation carry break in ways that are hard to see. Golden-test it against kernel scenes of the same crease pattern.
4. **PR #436 is frozen** (Zach's rule: further Diagram features go in their own PRs based on #436), and the import tag is planned but unbuilt. The Fold→Diagram link has to stack after both, or after #436 merges. The Fold engine and workspace can be built on main independently if the contract above is fixed first.
5. **Blast radius:** about 70 `source.kind` checks plus the line at `paintDiagramStep.ts:160` (VERIFIED by grep). The `posedRenderOf` refactor is the risky part. It should be a separate commit series with no behaviour change, as the plan did for its earlier extractions.
6. **Existing creases** reuse `aux` lines, which a style's aux toggle can hide in folded pictures (`pictureGeometry.ts:137-139`). Precreases may need their own role so they always show.
7. **Woven layer orders.** Sequences of tucks and reverse folds can produce cyclic stacks. `foldedFlatPaperScene` patches these, but face-level "over" is wrong inside a woven region (`behindFlaps.ts:12-15`), so generated `behind` marks may be wrong there.
8. **Engine changes and staleness.** `fs1:` flags every step whose output changed after an engine fix. That is correct, but the copy should say why ("Fold engine updated"), and `engine` should be recorded.
9. **Lifecycle (D1).** The Fold document needs its own scoped keys and reset at every site that replaces the project. A Diagram link must survive Edit's CP being replaced (`clearOristudioCpDocument`), which `cp` links do not.
10. **Arrow conventions.** References arcs bulge toward the sheet's middle (`foldArrowArc`); Diagram arcs bulge away (`defaultBend`). Generated arrows should follow the Diagram's rule, and Zach should confirm it.
11. **Future non-flat states (V2+)** would need the `folded-3d` route and a camera. The contract above is flat-only; reserve `render.mode` space for it.
