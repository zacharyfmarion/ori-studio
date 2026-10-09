# Simulator Pull Tool

## Goal

A third tool on the Simulate rail, after Orbit and Pin: **Pull**. Grab the
paper anywhere and drag. The pinned faces hold still, and the creases between
them and the grabbed point open (or close) as far as the paper's hinges allow,
computed by the same solver that folds the model. Let go and the paper **stays
where it was left**. It is how you partially open or unfold a model by hand:
pin a crane's body, pull one wing down, look at it, then pull the other.

- **Physical, not canned.** The drag is a force on the paper and the solver does
  the rest. No fold angles are interpolated or set directly.
- **No spring-back.** Letting go keeps the shape. Call the kept shape a
  **pose**.
- **What ends a pose.** It lasts until the fold control takes the paper back:
  Play, scrubbing, the arrow keys, either jump, or Restart. A **Spring back**
  button in the tool window does the same on purpose.
- **Escape mid-drag puts it back** to where the press began.

Scope: the Simulate workspace, the same scope Pin has. Inline simulation windows
and folded 3D windows keep orbit-only input.

*Since (October 2026):* a Diagram step's Pose is getting Pull too, through the
same binding (`diagram-pose-simulator-tools.md` on the Diagram workspace
branch, #436). Pose frames the shape rather than the pins (the worker's
`framing: 'shape'` load option); Simulate keeps this plan's framing, which is
the default (`'anchor'`).

### Decisions to confirm

| # | Question | Proposal |
| --- | --- | --- |
| 1 | Pull with nothing pinned | **Refused.** The press does nothing, the cursor shows not-allowed, and the window says "Pin the faces that should hold still, then pull", with a button that picks Pin. Why: the solver's damping only acts between neighbouring nodes, so motion of the model as a whole is undamped. An unpinned pull would set the whole model drifting or spinning, and the camera would follow its centre, so on screen it would look like a clumsy orbit. The alternative is a "free swing" that stops dead on release. |
| 2 | What ends a pose | **Any change to the fold target**: Play, a scrub, a fold step, Cmd+←/→. Also Restart and Spring back. These do **not** end it: pin edits, orbit and zoom, tool switches, material edits. You said "reset or played". A scrub drives the same target that Play drives, so it is the same event; a pose can't survive under a slider that just moved. |
| 3 | What release keeps | **The whole shape.** Release fixes the crease angles, facet bends, edge lengths and face angles as the paper's rest state. It is the only option measured to give zero spring-back (table D). The price: whatever stretch the paper holds at release is kept while posed. `bench:pull` measured single edges up to 9% on a part-folded kabuto, of which 5.5% was the fold's own before any pull; it is invisible at that size, and Spring back or Play removes it. The physics-pure alternative locks only the crease and facet angles. That springs back by up to 0.10, about 25 px, on part-folded models. |
| 4 | Escape or a second finger mid-drag | **Cancel.** The creases go back to their rest angles from the press, and the paper springs back to where it was. |
| 5 | Shortcut | **U** (for "unfold"). G is Oriedita's Fold estimate in Edit. U and H are free across the app's scopes and Oriedita's defaults; verify against the registry's duplicate checks. |

## Feasibility

### Why everything springs back today

Every crease is a spring toward `foldPercent × its target angle`:

- GPU: `targetTheta = creaseMeta[2] * u_creasePercent` in
  `webgl/passes.ts:272`.
- CPU: `ReferenceSolver.creaseForce` in `referenceSolver.ts:476`.

Upstream's drag (`third_party/origami-simulator/js/3dUI.js:57-68`) fixes the
vertex nearest the press and moves it with the mouse. On mouse-up it unfixes the
vertex (`:30`), and every crease returns to its target. Nothing in either
backend can hold a crease anywhere else. The pinned faces (PR #437) use the same
fixed-node flag, `u_mass.y`.

### The spike

A copy of `ReferenceSolver` was given a grip, per-crease rest angles and a yield
rule (scratchpad; reference only). It was driven the way the app drives the GPU:

- fold with a 300-steps-per-percent ramp, then settle;
- pin;
- pull for 40 frames of 80 steps, which is `GPU_STEPS_PER_TICK`;
- hold for 20 frames, let go, and settle.

Three models were used:

- **Kabuto at 100%.** `tests/fixtures/kabuto-simulation.fold`, flat-folded, no
  internal stress.
- **Kabuto at 60%.** Its creases miss their targets by a mean of 14° because the
  fold fights itself.
- **Iguana at 90%.** `iguana-split-crease.fold`, with 28 facet creases and
  frustrated mid-fold.

The two largest faces (or a corner) were pinned, and the triangle farthest from
the pins was grabbed. Distances are in the solver's units, where the model's
radius is 1. **0.01 is about 2.5 px when the model is 500 px across.**

**A. Creases must yield.** Kabuto 100%, the far flap pulled 0.5 along its
normal, with a target at fixed depth as upstream does:

| Creases | Grip | Got there | Kept after release | Peak stretch |
| --- | --- | --- | --- | --- |
| Elastic, not held (upstream) | vertex, kinematic | 100% | **0%**: all the way back | 6.2% |
| Elastic, held on release | spring, uncapped | 81% | 65% | 9.7% |
| Elastic, held on release | spring, force-capped | 7% | 7% | 0.0% |
| Yield past 2°, held | spring, force-capped | 32% | 33% | 0.3% |
| Yield past 5°, held | spring, uncapped | 89% | 86% | 6.4% |

A crease that stays a spring can only be opened by a force that stretches the
paper 10–30%. Cap that force and the crease does not open. A crease that
**yields**, so that its rest angle follows it once it is pushed past a small
elastic range, opens under a bounded force. That is also how creased paper
behaves: it holds the angle you push it to.

**B. The grip should be a ray, not a point.** Kabuto 100%, drags of 0.25 in the
screen plane. Each cell is "under the cursor at release / kept":

| View, drag | Target at fixed depth (upstream) | Ray, depth free | Ray + toward-viewer bias |
| --- | --- | --- | --- |
| Top, outward | 11% / 0% | 11% / 0% | **68% / 71%** |
| Top, sideways | 6% / 0% | 6% / 0% | **45% / 41%** |
| Oblique, sideways | 97% / 97% (spring-back 0.014) | 99% / 99% (0.002) | 99% / 99% (0.003) |
| End-on, outward | 97% / 99% (0.011) | 98% / 99% (0.006) | 98% / 99% (0.008) |
| End-on, inward | 72% / 72% | 90% / 89% | 92% / 92% |

"Keep the grabbed point under the cursor, at whatever depth the paper lets it
reach" beats a fixed-depth target wherever the flap has to swing. Seen from
above, a flat-folded flap can only reach the cursor by rising out of the plane.
Up and down are a symmetric tie: the solver has no collisions, so either way is
open to it. Neither constraint will start that motion on its own. A small pull
toward the viewer breaks the tie, so **the flap comes up toward you**, which is
the side a finger is on.

**C. Yield angle.** Dropping the yield from 2° to 0.25° raised the kabuto's
top-view outward pull from 71% to 99% kept, end-on from 99% to 100%. The number
of creases that moved stayed at 6–8 of 20. Nothing off the load path flopped.

**D. What springs back after release is in-plane stretch.** Yield 0.25°, ray
with bias, force cap 1.2. Each cell is "kept, spring-back":

| Model, view, drag | Hold crease and facet angles | Hold the whole shape | Stretch held in the pose |
| --- | --- | --- | --- |
| Kabuto 100%, top, outward | 99%, 0.008 | 99%, **0.000** | 0.9% |
| Kabuto 100%, end-on, inward | 95%, 0.009 | 98%, **0.000** | 1.1% |
| Kabuto 60%, top, outward | 81%, 0.072 | 98%, **0.000** | 3.3% |
| Kabuto 60%, end-on, sideways | 48%, 0.037 | 56%, **0.000** | 1.7% |
| Iguana 90%, top, sideways | 62%, 0.101 | 99%, **0.000** | 1.3% |
| Iguana 90%, oblique, sideways | 92%, 0.018 | 100%, **0.000** | 0.8% |

For reference, holding nothing (yield 2°) springs the iguana back 0.155, about
39 px.

- **Why angles alone are not enough.** The simulator's paper is soft in-plane
  (axial 20 against creases at 0.7), and the grip stretches it by 1–3%. When a
  path through the paper is pulled nearly straight, that small stretch lets the
  grabbed point overshoot a long way. A 1.4% stretch lets a taut strip bow out
  by about √(2 × 0.014), roughly 17% of its length. On release the stretch
  relaxes, and the only thing resisting it is the weak crease springs.
- **The diagnosis was confirmed** by also holding edge lengths and face angles:
  spring-back went to zero everywhere.
- **Settling.** Holding the whole shape gave 0.000 spring-back in all 21 runs
  (9 views and drags on the kabuto at 100%, 6 at 60%, 6 on the iguana). It
  settled in 600–5,300 steps in 20 of them; one took 19,700. Holding only
  angles took 3,000–57,400 steps. At about 4,800 GPU steps a second, that is
  about a second against up to 12 s of visible creep.

**What was ruled out, measured:**

- **Anneal at release.** Hold the grip and let creases flow freely: no change.
- **Stiffer posed creases** (×4): −40% on kabuto 60%, little on iguana, and the
  facets bend more instead.
- **Slip on stall.** Drop the grip when it stops making progress: it stops held
  stretch when blocked, but it also stops slow lifts from starting (kabuto top
  view, inward: 9% kept down to 0%).
- **A strain-limited grip.** Back off past +0.3% stretch: spring-back falls
  4–10×, but reach falls to 0–12% on most pulls. The default material needs
  about 1% stretch to move anything.

**Other findings:**

- **Pins are exact.** Pinned nodes moved 0.0 in every run.
- **Press without moving.** Nothing moves (0.000) when each crease's existing
  deviation from its target becomes its baseline. Zeroing the deviation instead
  relaxes the paper by 0.004–0.010 at the press, a visible twitch. So use the
  baseline.
- **Taut directions.** Where the paper cannot go, the grip saturates and the
  point stays 75–97% short of the cursor. That is right: it shows the paper is
  taut. The whole-shape hold then keeps the small stretch rather than springing
  it back.
- **Facets bend while pulling, up to 15° on the iguana.** The default panel
  stiffness equals the crease stiffness, so faces flex. They are held with the
  shape.
- **Dense patterns pull slowly.** The step is set by the shortest edge. The
  lamprey segment (shortest edge 0.0003) took 232 s of CPU just to fold, and a
  pull will lag the cursor there just as Play lags the slider. Measure it on
  the GPU; it is not a correctness problem.

### Constraints found in the code

- **The force shader is at WebGL2's texture-unit floor.** `FORCE_SHADER_SAMPLERS`
  is 15 samplers. Verlet adds `u_lastLastPosition` for 16, and 16 is the
  guaranteed `MAX_TEXTURE_IMAGE_UNITS`. A new sampler would fail to link
  `positionCalcVerlet` on any GPU that reports only the minimum. The design
  adds none:
  - the posed crease rest angle rides in `u_theta.y`, which `thetaCalc` writes
    as `diff` (`passes.ts:118`) and nothing in the solve reads;
  - the grip is uniforms only;
  - the posed edge lengths and face angles go in the textures that already
    hold them, `u_beamMeta[2]` and `u_nominalTriangles`.
- **Upstream has none of this.** The pull is our addition, as pins are. With no
  pull and no pose, both backends must stay bit-identical to today. Golden
  traces and the parity benches are the guard.
- **The strain readout stays honest.** `nodeError` measures against the original
  sheet (`nominalDist`), not `beamMeta[2]`, so stretch held in a pose still
  reads as stretch.
- **No self-collision.** A flap pulled into the model passes through other
  layers, as it can while folding today. This is the main limit on "physically
  accurate", and it is out of scope here.

## Approach

### The model

**During a pull**

- **The grip** is the point under the press: a triangle and its barycentric
  weights, not upstream's nearest vertex. A vertex can sit on the hinge itself,
  and pulling it tears the hinge.
- **The force** pulls that point toward the cursor's ray, perpendicular to the
  ray only, so depth is free. It is:
  - critically damped;
  - capped at about 6% of the axial stiffness (1.2 at the default 20);
  - biased toward the viewer by 0.3 × its own size, which is zero once the point
    is under the cursor.
- **Creases yield** past 0.25° from the deviation they had at the press: rest
  becomes `clamp(rest, θ − e₀ − y, θ − e₀ + y)` each step. "Crease" means
  whatever the solver gives crease stiffness. Facets, triangulation diagonals
  and auxiliary `F` creases use panel stiffness and never yield; they stay
  elastic.
- **Pinned nodes** stay fixed, as they are now.

**On release ("keep")**

- Every crease's rest angle becomes its current angle. This includes facets.
- Every edge's rest length becomes its current length, clamped to ±10% of the
  sheet's. The clamp stops repeated taut pulls from piling up stretch. It was
  planned at ±3%, and `bench:pull` showed that was wrong: a kabuto at 60% already
  stretches single edges 5.5% before anything is pulled, and up to 8.9% after,
  so a 3% clamp undid the fold's own stretch and the pose sprang back 0.033.
  At ±10%, every bench run springs back under 0.0003.
- Every face's rest angles become its current angles.

The paper is now at rest in the shape on screen, so it has nothing to spring
back with.

**On cancel**

The crease rest angles go back to their state at the press, and the paper
springs back elastically. Edge lengths and face angles only ever change on
release, so there is nothing else to restore.

**Pose ends**

Crease targets go back to `foldPercent × target`, and edges and faces go back to
the sheet. The paper springs to the fold state physically.

**Starting constants**

These are the spike's values, in one `pull.ts` module in the package with the
measurements beside them:

| Constant | Value |
| --- | --- |
| yield | 0.25° |
| force cap | 0.06 × axial |
| grip stiffness | the stiffest edge's, `axial / shortest rest length`: inside the stable step by construction |
| grip damping | critical, `2√(k · m)` with `m = 1/Σw²` |
| toward-viewer bias | 0.3 |
| length clamp | ±10% |

Not user settings in v1.

### Architecture

```
SimulatorPanel                         composition only (+ drawnCamera for canvas-2D)
 ├─ SimulatorToolRail / ToolWindow ─┐
 ├─ SimulatorViewport ──────────────┼─ props from ─ useSimulatorTools ──► runtime (worker calls)
 └─ context menu, shortcuts ────────┘                │  pull lane: begin → moves (coalesced) → end
          pure, React-free  ▼
   simulator/tools/engines/pullGesture.ts   down/move/up/cancel → live pull gestures
   simulator/tools/intents.ts               pull intent (phase, CSS point, surface)
   simulator/tools/catalog.ts, actions.ts   Pull tool, its window, Spring back
                                            │
   worker: simulatorSession                 beginPull / movePull / endPull / releasePose,
                                            hit test + ray, framing hold, fold-change policy
   packages/origami-simulator               pose + yield + grip on both backends, picking/rays
```

### Engine (`packages/origami-simulator`)

1. **`SolverBackend` gains a pull and a pose.**

   ```ts
   interface PullGrip {
     nodes: readonly [number, number, number];
     weights: readonly [number, number, number];   // barycentric, sum 1
     ray: CursorRay;                               // world space: origin + unit direction
   }
   beginPull(grip: PullGrip): void;     // baselines e₀ = θ − rest; a no-op pose becomes one
   movePull(ray: CursorRay): void;      // uniforms only on the GPU
   endPull(outcome: 'keep' | 'cancel'): { movedCreases: number };
   releasePose(): void;                 // targets back to the fold, rest shape back to the sheet
   readonly posed: boolean;
   readonly pulling: boolean;
   ```

   `reset()` also ends a pull and releases the pose, because flat paper has no
   pose. That includes the clock's NaN guard, which calls `reset()`.
   `arrestDynamics()` keeps the pose. `setMaterial` while posed rebuilds
   `beamMeta` from the posed lengths. Stiffness, damping and the timestep stay
   the sheet's; only the rest length moves.

2. **GPU (`WebglSolver`, `passes.ts`).**

   - **`THETA_CALC` gains three uniforms**, `u_posed`, `u_pulling` and
     `u_yield`, and one sampler, `u_creasePull` ([e₀, isCrease, -, -]). That
     brings it to 6 samplers. When not posed it writes `diff` exactly as today.
     When posed it carries the rest angle in `.y`, and applies the yield while
     pulling.
   - **The force main** aims creases at `thetas[1]` in a posed twin of each
     integrator's program (`velocityCalcPosed`, `positionCalcVerletPosed`),
     which the solver runs while posed. Built as a branch first, it changed the
     unposed solve: any condition on the target stops SwiftShader fusing
     `creaseMeta[2] * u_creasePercent - theta` the way it did, and an
     over-constrained pinned run in `bench:gpu-stability` flipped from stable to
     unstable. As a compile-time variant the unposed program's output matches
     the base commit's on every `bench:gpu-parity` row.
   - **The grip** is uniforms:
     - `u_gripActive`, `u_gripNodes`, `u_gripWeights`;
     - `u_gripRayOrigin`, `u_gripRayDir`;
     - `u_gripStiffness`, `u_gripDamping`, `u_gripMaxForce`, `u_gripBias`.

     A fragment whose node index is a grip node adds `w · F`, where `F` comes
     from the three nodes' positions and velocities fetched from textures
     already bound. Both integrators share the main, so Verlet gets the grip
     too.
   - **Begin, keep and cancel** are once per gesture, done on the CPU:
     - one `readTexture('u_lastTheta')` to baseline or latch;
     - one `readTexture('u_lastPosition')` on keep, for the lengths and face
       angles;
     - then `updateTexture` of `u_lastTheta`, `u_creasePull`, `u_beamMeta` and
       `u_nominalTriangles`.

     The snapshot for cancel is a CPU copy of the rest angles. A move costs no
     readback.

3. **CPU (`ReferenceSolver`)** mirrors it, as the oracle. Rest angles, e₀,
   isCrease and the grip all fold into `creaseForce` and `forceForVertex`.
   Posed lengths and angles override `nodeBeams[].restLength` and
   `nominalAngles`. It backs fold profiles and the canvas-2D fallback, so it is
   not optional.

4. **Picking and rays** are pure functions beside `picking.ts` and `camera.ts`:
   - `cursorRay(point, camera, { perspective })`: through the eye in
     perspective, along the view axis in the canvas-2D fallback's orthographic
     projection.
   - `frontmostHitAt(...)`: the existing one-sample raster picks the triangle,
     then a ray–triangle intersection gives exact barycentric weights and the
     source face.

   Both go through the shader's own matrix, reflection included (see
   `viewRotation` in `webgl/camera.ts`).

5. **A `bench:pull` harness** ports the spike. It runs the kabuto at 100% and
   60%, the iguana at 90%, and the book fold through the views and drags above,
   on both backends (GPU through the existing Playwright harness). It reports
   reach, kept, spring-back, stretch and settle steps. It is where the
   constants are tuned and where the acceptance numbers below are checked.

### Worker and runtime (`apps/web/src/simulator`)

**`simulatorSession`**

- **`beginPull(at, drawn?, token)`**:
  1. hit-tests against the frame the user aimed at. The GPU path uses
     `view.drawn` in perspective; the canvas-2D path passes the camera it drew
     with, orthographic.
  2. refuses with `missed`, `pinned-face` (all three nodes fixed) or `no-pins`;
  3. otherwise starts the pull, holds the framing (below), invalidates the
     clock, and redraws.
- **`movePull(at, drawn?, token)`** sets the ray and invalidates the clock. It
  answers `false` once the pull has ended underneath it.
- **`endPull(outcome, token)`** keeps or cancels and returns `movedCreases`
  for analytics. A kept pose keeps the framing hold; a cancel with no pose
  releases it.
- **`releasePose(token)`** is the Spring back verb.
- **Policy.** `setFoldPercent` with a *different* percent cancels any pull and
  releases the pose; this one place covers Play, scrub, step and jump. `reset`
  does the same.
- **Frames carry `posed`** (a pose kept, not a pull still in the hand), and
  `poseEnded: 'fold' | 'reset' | 'request' | null`, so the UI can show the pose
  and analytics can say what ended it.
- **Framing hold.** `followFraming` gains a hold: no measure, no ease, from
  the press until the pull ends or, kept, until its pose does. The camera
  otherwise rescales as a flap swings out, which slides the paper out from
  under the cursor; and if it re-fit on release, the whole picture would jump
  the moment the paper was let go. (The first build released at let-go, and
  the browser check caught exactly that: 143,914 pixels changed on release.)
  The session owns the hold for both renderers and puts it on every frame as
  `framingHeld`, which the canvas-2D path, framing on the main thread, obeys.
  The camera follows the shape again when the pose ends; the pinned-centroid
  anchor keeps the pins still on screen.

**`useSimulatorRuntime`**

- **One pull lane.** `beginPull` and `endPull` run in order, and an end waits
  for its begin.
- **`movePull` is coalesced**: one in flight with the newest queued, the
  `sendCamera` pattern. Moves after a refused begin are dropped.
- All of it carries the same token and model checks as `setPinnedFaces`, and
  every call marks the model unconverged, as `retarget` does.

### Tool layer and viewport

- **`tools/types.ts`** adds:
  - `'pull'` to `SimulatorToolId`, `SimulatorInputMode` and the icon set;
  - a live gesture, `{ kind: 'pull'; phase: 'begin' | 'move' | 'end' |
    'cancel'; point; touch }`.

  The contract's "a finished gesture" becomes "what the tool acts on now",
  which a continuous tool emits on every sample.
- **`engines/pullGesture.ts`** is pure: down begins, move moves, up ends,
  cancel cancels, with no marquee. `pressRoute` gains its route. `Record` makes
  that a type error until it exists.
- **`SimulatorViewport`**:
  - hands `onGesture` every gesture an engine emits, not only the one on
    release. The box engine emits only on release, so Pin is unchanged.
  - `abandonDrag` forwards the cancel, which today it drops, so Escape, a
    second finger and a tool switch all cancel a pull.
  - The cursor state gains `pulling` (grabbing) and `refused` (not-allowed with
    no pins).
  - `drawnCamera()` joins the handle for the canvas-2D path, beside
    `pickDrawnFaces`.
- **`useSimulatorTools`** gains:
  - a pull branch in the executor;
  - `view.posed` from frames;
  - the `springBack(source)` verb;
  - refusal handling and analytics.

  If the pull lane grows into a concern of its own, it moves to a
  `useSimulatorPull` that the hook composes. The panel only passes
  `drawnCamera`.

### UI

- **Rail.** Orbit, Pin, then Pull, with lucide `Hand`. It shows a dot while
  posed, as Pin does while pins exist. The phone Tools sheet lists it from the
  catalog with no extra work.
- **Tool window, Pull active.**
  - Title "Pull"; meta "Instructions", or "Posed" while posed.
  - **Instructions:**
    - "Drag the paper to pull it. Pinned faces hold still."
    - "Let go and it stays. Play or scrub the fold to let it spring back."
    - "Esc while dragging puts it back."
    - "Cmd-drag turns the model", or the middle-button line.

    The touch versions drop the modifier lines.
  - **No pins:** the instruction "Pin the faces that should hold still, then
    pull" and a **Pin faces** button.
  - **Posed:** **Spring back**.
  - The pins' count and **Clear pins**, as now.
- **Under the other tools,** the pins window also shows Spring back while
  posed.
- **Context menu.** A Spring Back row while posed (`simulatorToolMenuVerbs`).
- **Phone.** One finger pulls; a second finger cancels, through the touch
  arbiter that already aborts.

### Keyboard

- `simulator.tool.pull` is **U**.
- `simulator.pull.springBack` is unbound, like Clear Pins: it throws away
  manual work.
- Escape needs no new verb. `exitTool` already calls `cancelGesture`, which now
  cancels a pull in flight before falling back to Orbit.
- Each gets a `shortcutLabels.ts` case and a `runSimulatorShortcut` branch.
  Inline windows decline the tool verbs, as they do for O and P.

### Error handling

This follows the pins plan's rules: stale is not an error, a toast owns error
text, and the window carries notices.

| Situation | User sees | Reported |
| --- | --- | --- |
| Stale token, model replaced, pull ended under a move | nothing; the gesture ends quietly | no |
| Press misses the paper, or lands on a pinned face | nothing (the cursor already said not-allowed for no pins) | `simulator pull refused` |
| `beginPull` / `endPull` rejects unexpectedly | toast `toasts:simulatorPull.failed` | `reportError(e, { surface: 'simulator:pull', tags: { backend } })` |
| Worker dies, context lost | existing paths | existing |
| Blow-up guard resets mid-pull | the existing `recovered` notice, and the pose is gone with the reset | existing `simulator solver recovered` |

### Analytics

Hand-placed, through typed wrappers in `trackSimulatorTools.ts`. Enums and
buckets only.

| Event | Properties | Fires when |
| --- | --- | --- |
| `simulator tool selected` | `tool` gains `pull` | existing |
| `simulator model pulled` | `outcome` (`kept`/`cancelled`), `pointer` (`mouse`/`pen`/`touch`), `pinned_count_bucket`, `moved_creases_bucket` | a pull ends |
| `simulator pull refused` | `reason` (`missed`/`pinned-face`/`no-pins`) | a press is refused. `no-pins` is what tells us whether decision 1 is right |
| `simulator pose released` | `source` (`fold-control`/`restart`/`tool-window`/`context-menu`/`shortcut`) | a pose ends. Do people keep poses, or throw them away? |

Each gets a row in `docs/analytics.md`.

### i18n

New strings in all eight locales, stamped:

- `panels:simulator.tools.pull.*`: label, description, instructions, the no-pins
  line and button, Spring back, Posed;
- `tools:simulator.*`: the two shortcut labels;
- `toasts:simulatorPull.failed`.

### Out of scope

- Collision. Layers pass through each other, as they do when folding.
- A grab marker or rubber band from the point to the cursor while taut;
  hover highlight.
- Undo of single pulls, poses in `.osf`, and poses surviving a session reload
  or segment switch. A pose lives in its worker session; pins, unlike poses,
  live in the store. (Still out of scope for Simulate; a Diagram step will keep
  its shape, which needs the worker to read and restore one:
  `diagram-pose-simulator-tools.md`, #436.)
- Pull in inline simulation windows.
- Tuning the constants per model, or exposing them as settings.

## Affected Areas

- **`packages/origami-simulator`:** `solverBackend.ts`, `referenceSolver.ts`,
  `webgl/webglSolver.ts`, `webgl/passes.ts`, `webgl/packing.ts`, `picking.ts`,
  `webgl/camera.ts`, a new `pull.ts`; tests, plus `bench/pull.bench.ts` and the
  parity and stability harnesses.
- **`apps/web/src/simulator`:**
  - `simulatorSession.ts`, `useSimulatorRuntime.ts`, `framingFollow.ts`,
    `canvas2dFrame.ts`;
  - `SimulatorViewport.tsx`, `useSimulatorTools.ts`, `useSimulatorShortcuts.ts`,
    `simulatorContextMenu.ts`, `simulatorToolIcons.ts`;
  - `tools/types.ts`, `catalog.ts`, `actions.ts`, `intents.ts`, `pressRoute.ts`,
    `cursor.ts`, a new `tools/engines/pullGesture.ts`;
  - `SimulatorToolWindow.tsx`.
- **`apps/web/src/components/panels/SimulatorPanel.tsx`:** pass `drawnCamera`
  only.
- **Keyboard:** `keyboard/shortcuts.ts`, `i18n/shortcutLabels.ts`.
- **Analytics:** `analytics/events.ts`, `trackSimulatorTools.ts`,
  `docs/analytics.md`.
- **Locales:** `apps/web/public/locales/*/panels.json`, `tools.json`,
  `toasts.json`.

## Checklist

Each step is its own commit.

- [x] Feasibility. Read the solver, both backends, upstream's drag and the Pin
      tool's plumbing. Spiked crease models, grip constraints, yield angles,
      release latches and four spring-back mitigations on three model states
      (tables A–D).
- [x] Decisions 1–5 agreed (2026-10-05).
- [x] **Engine: pose and yield,** both backends, with tests:
  - golden traces and GPU parity unchanged with no pull;
  - pinned nodes bit-identical through a pull;
  - |θ − rest − e₀| ≤ y for creases while pulling; facets never yield;
  - keep leaves a book fold's free leaf where it was let go;
  - cancel returns it;
  - `releasePose` and `reset` restore targets, lengths and angles;
  - the length clamp holds.
- [x] **Engine: grip,** both backends. Tests:
  - force ≤ cap;
  - no force along the ray;
  - the bias is zero once the point is on the ray;
  - fixed grip nodes take no force;
  - the GPU sampler count is unchanged; Verlet still links at 16 units.
  Measured: the scripted pull in `bench:gpu-parity` (grip, keep, pull again and
  cancel, drop the pose) matches the reference within 4.8e-7 on every fixture
  and both integrators (3.2e-7 before posed paper got its own force program),
  with fixed nodes bit-identical and the same moved-crease counts. The
  book-fold test swings the free half to 89.8° and it drifts 0 after release.
- [x] **Picking:** `cursorRay`, `frontmostHitAt`. Tests:
  - a point along the ray projects back to its pixel, in perspective and
    orthographic;
  - the barycentric weights reproduce the press point;
  - the reflection is honoured.
- [x] **`bench:pull`** (CPU; the GPU is held to it by the pull rows in
      `bench:gpu-parity`). Acceptance:
  - after release, the grabbed point moves < 0.005 (about 1 px): 27 of 27 runs
    under 0.0003, pins unmoved;
  - on the bench's free-swing cases the point is within 3% of the drag of the
    cursor ray at release: 97–99%;
  - `bench:gpu-stability` stays finite with pulls on the lamprey: a grip, swing,
    keep and release across a 12,000-step ramp is stable on both backends.
- [x] **Worker and runtime:** the API, the fold-change and reset policy,
      `posed`/`poseEnded` on frames, the framing hold (the worker's; the
      canvas-2D path's comes with the viewport), the pull lane, coalesced moves.
- [x] **Tool core:** types, catalog, actions, engine, intents, `pressRoute`,
      cursor; all pure, all unit-tested.
- [x] **Viewport:** live gestures, cancel forwarding, `drawnCamera`, the cursor
      states. Pin's tests stay green.
- [x] **Bindings:** the pull lane in `useSimulatorTools`, Spring back, refusal
      handling. Hook tests with a fake runtime cover ordering, a refused begin,
      a stale end, and a fold change mid-pull. The stale end needed a fix: the
      runtime's `endPull` now takes the model, as `beginPull` does.
- [x] **UI:** rail, window, context menu, shortcuts, phone sheet.
- [x] **Analytics:** events, wrappers with tests, `docs/analytics.md`.
- [x] **Errors,** **i18n** (eight locales, stamped, `i18n:check`).
- [x] **Browser verification**, headless Chromium against the dev server (the
      agent pane was hidden), on Oriedita's `birdbase.cp` at 60% and a
      one-crease flap at 90% (the kabuto was swapped for the flap: a single
      hinge shows the swing plainly), GPU and canvas-2D, dark and light, and
      a phone at 390 px with CDP touch. Screenshots before and after every
      step, diffed pixel by pixel with the tool window and view cube masked:
  - let go, the paper moves 0 px, from the frame before release to three
    seconds after, on every run (after the framing fix above) bar one: the
    bird base with only its back pinned, where a pull that opened the petal
    fold (10 creases) settled by 27 antialiased edge pixels, sub-pixel;
  - a scrub ends the pose and the paper follows the fold; Restart goes flat;
  - Escape, and on the phone a second finger, put it back: identical to the
    Spring back frame, and on canvas-2D to the frame before the pull. On the
    GPU path the camera's 2% dead band can settle a pixel away after any
    motion, which is the residue there. A cancel restores the press's rest
    angles, not its positions, so a lightly pinned bird base settles a few
    pixels off where it started, as it does after any motion;
  - with no pins the cursor is not-allowed, the press steps nothing, and the
    window says why with a Pin faces button;
  - the pinned faces' tint is pixel-identical through the pull and after;
  - the Step counter stops after release: the worker goes idle.
  Found on the way: the bird base's front is one face at full fold, so every
  press there is `pinned-face` once it is pinned. Correct, and a hint that a
  model's pinnable and pullable faces are not always where a user expects.
- [x] `npm run lint:web`, `typecheck:web`, `test:web`, package tests, a
      production build.
- [ ] Draft PR against `main`.
