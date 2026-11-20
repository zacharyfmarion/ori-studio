# Diagram: Simulated Pose saves on Done, exactly, with its positions

## Goal

Zach, on a step shown as **Simulated** in Pose: "as SOON as i press done,
whatever state the model was in should be saved and updated to the step. Idk
what the 4s wait is for. Then the UI should basically show that. the simuation
is paused with a button in the mimddle of the screen to play if the state we
saved was not settled."

Today Done often saves something other than what is on screen. Three causes,
each confirmed on main (e43165b84):

1. **Capture on rest, with a 4 s cap.** `useDiagramSimulatedPose` captures a
   picture whenever the fold and camera rest, waiting up to
   `MAX_SETTLE_WAIT_MS` (4 s) for the solver to settle. A model still moving
   at 4 s is captured mid-settle, and the motion after it is never captured.
2. **The same-pose skip.** `PoseController.wantsRest` and the `simulate`
   queue drop a rest whose fold % and camera equal the stored ones. The solve
   is path-dependent: 45 % → 100 % → 45 % gives another shape, and it is
   never captured.
3. **Done while playing saves nothing.** Play never marks the view dirty
   (only a pause, a scrub or reaching 100 % does), and the unmount path
   returns early on `!dirtyRef.current`. So Done mid-play leaves the step as
   it was.

What Done does instead:

- Done saves at once exactly what is on screen: the simulator's positions,
  the picture drawn from those positions at the current camera, the fold %,
  the camera, and whether the solver had settled. No settle wait, no closing
  settle (`CLOSING_SETTLE_STEPS`), no same-pose skip.
- Leaving Pose any other way (Escape, the step arrows, another step, the
  detail closing) saves the same way. Nothing is captured on rest any more.
- The step stores the simulator's positions (approved by Zach). Reopening
  Pose puts them back in the simulator, held still. If they were saved before
  the solver settled, a play button sits in the middle of the view; pressing
  it lets the solver go on from there.
- Older files without positions keep opening as today: Pose folds them from
  flat at the saved fold % and camera.

## Approach

### What a step stores

`render.shape` on the simulated render. Every build since diagrams shipped
(v0.6.0) has carried an unknown `shape` record verbatim (8a70f32f1) and drops
it when it captures a new render. So the field needs no format bump, and an
older build that edits the step can never leave positions beside a picture
they were not drawn from.

```ts
interface DiagramSimulatedShape {
  /** `sk1:`: the simulator's key for the region's flat sheet (`simulatorSheetKey`). */
  sheet: string;
  /** `ss1:`: base64 of little-endian float32s, each node's offset from flat (×3), then each crease's angle. */
  state: string;
  /** Whether the solver had settled when it was saved. Always written. */
  settled: boolean;
}
```

**Encoding: base64 Float32, the simulator's own `ss1:` encoding
(`simulatorShape.ts`), not rounded decimals.**
- It is exact. A restore writes back the very floats the picture was drawn
  from (`readShape` / `writeShape` round-trip bit for bit on the GPU), so an
  untouched reopen is the stored picture, and saving it again changes nothing.
  Rounded decimals would restore a slightly different mesh.
- It is smaller. The project file is pretty-printed, a number to a line, so
  a rounded decimal costs 15–20 bytes with its indent; a float32 in base64 is
  5⅓.
- It includes each crease's angle. Both solvers unwrap θ against its last
  value, so a crease folded near 180° restored from positions alone could
  resume on the wrong side.

**Keyed to the mesh.** `sheet` digests the region's simulator model: its node
count, every node's flat place, its triangles and each crease's target angle.
That is stricter than the step's fingerprint plus a vertex count: a changed
crease pattern, a renumbered region or another triangulation gives another
key, and the worker refuses the shape (`mismatch`), so the step falls back to
today's behaviour (folded from flat at its fold % and camera). A region moved
on the sheet keeps its key.

**Size.** 12 bytes a node and 4 a crease, ×4/3. `flapping_fan.osf` step 14
(49 vertices) is about 1–2 KB beside a 53 KB picture; the worker refuses a
shape over 1 MB (`SIMULATOR_SHAPE_MAX_BYTES`), and the step is then saved
without one.

**Reading it.** The file reader is unchanged: any `shape` record is carried as
it came and the step stays editable (decision 5, the launch review), and one
that is no record is dropped alone. Only Pose reads it (`savedShapeOf`): a
record with just `sheet` (`sk1:`), `state` (`ss1:`) and `settled` is put back;
anything else — a build with Pose's tools (`id`, `pins`, `posed`), another
encoding, damage — is not read, and Pose folds the step from flat as it does
today. `settled` unsaid reads as settled. A remembered simulated render (the
step shown another way) keeps no shape: coming back to Simulated keeps only its
camera.

**Not stored:** velocities (play resumes from rest), pins and poses (Pose has
no tools yet; `diagram-pose-simulator-tools.md` adds them to this record,
written only when said), whether the fold was playing.

### The worker: one call for the picture, the shape and the settle

`sessionScene` becomes `sessionCapture`, answering `{ scene, shape, settled }`
from one synchronous call, so the picture and the positions stored beside it
are of one moment. Two calls would let a tick of a playing model run between
them. The `settleSteps` option goes: nothing settles before a save any more.

At 0 % the picture is the flat sheet, as today (so a step at 0 % is the
headless 0 % picture), and the shape stored is the flat sheet too, settled.

The runtime's `stillScene` becomes `stillCapture`. Resuming a held model needs
no new call: `setFoldPercent` at the same target starts the clock again.

### Pose

`useDiagramSimulatedPose`:
- Opens the runtime with `initialShape`, the step's stored shape decoded. The
  worker restores it before the first frame and counts it settled, so nothing
  moves it until something changes. `model.restored` says whether it took.
- **Held:** opened on a stored shape saved unsettled, and nothing has moved
  it since. The view shows a play button; play, a scrub, a step, Back to Flat
  or the transport's Play let it go.
- **Untouched:** opened on the step's own stored shape, and nothing moved
  since (fold, camera, play). Leaving then has nothing new to save, unless the
  step's picture is out of date (its pattern changed, or another light).
- **Saving** (`save`): capture now, through `stillCapture`, at the camera
  shown (the stored camera when it is the same, so float noise is not a
  change), the fold % shown, `settled` from the worker unless held. Handed to
  the controller as one `simulate` request.
- **Leaving** saves through the effect declared before the runtime, so its
  capture reaches the worker before the model is let go, the worker held
  until it answers. The panel can let the step's controller go in the same
  commit (another step opened, or Done with no step left inspected), so
  `dispose` waits for a save already handed over, as it waits for an orbit.
- **At 0%** a step with no positions counts as its own: the flat sheet. An
  untouched view there saves nothing.
- **Save now** (`registerSimulatedSaveNow`, was rest now): Refresh on a step
  open in Pose saves what is shown.
- **An undo or Reset from outside** moves the view to the render: its shape
  restored (`restoreShape`), or folded freely from flat when it has none.

`PoseController`:
- `simulate(save)` commits every save it is given, the newest waiting while
  one lands. No same-pose skip.
- `wantsRest` becomes `wantsSave(untouched)`: false unless the step is shown
  Simulated; for an untouched view, true only when its picture is out of date
  (`needsRecapture`).

`linkedPose.ts`: the `simulate` verb carries the shape into the render.

### The play button

`DiagramPoseResumeButton` (+ its module): a play button centred over the view,
shown while held, on the stage's overlay pill and the one control radius.
`panels:diagram.pose.resumeSimulation` "Resume simulation". It is counted as
`diagram simulation resumed` (no properties), since no menu action covers it:
whether saving a model on its way somewhere earns the held state. Each save
that changes the step is still a `diagram picture posed` `simulate`.

### Older files and older builds

- A file without positions opens exactly as today: folded from flat at its
  fold % and camera. Leaving Pose then saves what it shows, positions and
  all, as Done always does now — so opening an old step above 0% in Pose and
  leaving it is one "Adjust pose" undo step, and its page picture becomes the
  one Pose showed. That is the fix: a picture captured mid-settle by the old
  4 s cap is replaced by what Pose shows.
- A step whose pattern changed: the shape is refused, the step folds from flat
  as today, and its next save stores the new mesh.
- An older build (v0.6.0+) carries the shape untouched while the step stands,
  and drops it with the picture when it captures the step again.
- No `formatVersion` bump.

## Affected Areas

- `apps/web/src/simulator/simulatorSession.ts` (+ test): `sessionCapture`.
- `apps/web/src/simulator/useSimulatorRuntime.ts`: `stillCapture`.
- `apps/web/src/diagram/document/diagramDocument.ts` (+ test): the saved
  shape's type; a remembered render keeps none. `diagramFile.ts`: comments
  only (+ tests).
- `apps/web/src/analytics/` and `docs/analytics.md`: `diagram simulation
  resumed`, and `simulate` described as a save.
- `apps/web/src/diagram/capture/simulatedShape.ts` (new): the shape between
  the file and the worker.
- `apps/web/src/diagram/capture/useDiagramSimulatedPose.ts` (+ test).
- `apps/web/src/diagram/capture/poseController.ts` (+ test),
  `linkedPose.ts`, `useDiagramLinkedPose.ts`, `openLinkedPose.ts`,
  `useDiagramActions.ts`.
- `apps/web/src/components/diagram/DiagramPoseSimulatedView.tsx` (+ its
  module), `DiagramPoseResumeButton.tsx` + `.module.css` (new),
  `DiagramStepDetail.tsx`.
- Locales: one new string.

## Checklist

- [x] Confirm the three causes on main.
- [x] Worker `sessionCapture` + runtime `stillCapture`, with tests.
- [x] Saved positions in `render.shape`: written, carried, read by Pose; tests for old files and other builds' shapes.
- [x] Controller: `simulate` commits every save; `wantsSave`; `dispose` lands a save asked for as Pose closed.
- [x] Hook: no rest capture; save on leave and save now; restore held; undo-follow restores.
- [x] Play button, centred, while held; i18n; `diagram simulation resumed`.
- [x] Unit tests: Done mid-play saves the shown positions; 45 → 100 → 45 saves the new shape; unsettled round-trips; old files load.
- [x] `tsc`, `npm run lint:web`, relevant tests, i18n check.
- [ ] Browser proof on `flapping_fan.osf` steps 14–15: before and after.
- [ ] Draft PR.
