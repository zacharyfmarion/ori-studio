# Fold workspace: research on 3D folded states and animation

## Summary

- **VERIFIED.** A V0 simple fold (valley or mountain, through any number of layers) moves the paper as exactly two rigid groups. The stationary layers stay in the plane of the flat state. The moving layers rotate by `±t·π` about the fold line, taken in folded space. Each group keeps the layer order it had in the "before" state. Nothing has to be solved to animate it.
- **DERIVED.** With only two planar groups, an exact draw order exists and needs no depth epsilon. Draw the stationary group first when the eye is on the moving group's side of the stationary plane, and second otherwise. Inside each group, draw only the visible face of each cell (its "skin"). The 3D window already uses this skin method for static figures (`apps/web/src/cp-workspace/folded/folded3dMesh.ts:10-40`).
- **Do not re-run `Fold3dSession` per frame**, even though a CP whose new creases carry `t·180°` is a legal input to it. The kernel says itself that there is "deliberately no per-frame way" to get a render model (`crates/oristudio-cp/src/folding3d/model.rs:9-11`, `session.rs:243`). Running it again would also solve the layer order again. On a flat state that solve can return a different valid order from the one the folding sequence produced, so the picture would flicker. The kernel also changes constraint type at exactly 180° (`folding3d.rs:164-170`).
- **Do not use the origami simulator to step from one flat state to the next.** It has no self-collision, its rest state is always the flat sheet, there is no API to seed it with folded positions, and a fold profile forces the slow CPU solver (details under option C). It is a possible later tool for non-rigid steps, as a picture only.
- **Build on the 3D window path:** `folded3dMesh`, then `FoldedMeshSource` in the simulator worker, then `SimulatorViewport`. Add one extension, a *posed* mesh with per-group transforms. The Diagram PR already reuses this exact path for 3D step poses (`git show 31e1d6d84:apps/web/src/components/diagram/DiagramPose3dView.tsx`).
- **Reuse the precrease animation's transport.** Its pure leg state machine, rAF transport and pose-through-handle pattern carry over. Its surface model (one sheet, a curl that "stretches the truth") does not carry over as state.
- **Reverse folds and sinks are not two-group rigid motions.** I derived below that an inside reverse fold of a two-layer flap has no rigid path from "flap folded" to "reverse folded" that avoids unfolding the vertex flat. The architecture therefore needs a per-fold-type `StepMotion` provider with two kinds: rigid-kinematic and visual/non-rigid. Both kinds must hit the endpoints exactly.

## Existing 3D/animation stack

### Kernel: `crates/oristudio-cp/src/folding3d/` (VERIFIED)

The pipeline is ordered placement → admit → planes → census → cells → constraints/order → model → session (`folding3d.rs:8-35`).

- **Placement.** `Placement3d` holds `face_transforms: Vec<Rigid>` (`placement.rs:239-245`). `Rigid` is a quaternion plus a translation, with `compose`, `inverse` and `about_line(pivot, axis, radians)` (`placement.rs:57-127`). The convention is `M_child = M_parent ∘ Rot_paper(line, ρ)`, with ρ being the signed FOLD angle from `crease_fold_angle` (`model/mod.rs:737-744`). Angles are stored as `FoldMagnitude` in units of 1e-7° (`geometry/line_segment.rs:61-68`), so any `t·180` is representable.
- **Render model.** `Folded3dRenderModel` (`model.rs`) is struct-of-arrays:
  - face rings in 3D;
  - `face_attr` = `[plane, ring_start, ring_len, facing]`;
  - plane frames (`up, origin, u, v`);
  - `cell_attr` = `[plane, ring_start, ring_len, stack_start, stack_len, determinacy, draw_rank]`;
  - `cell_stack`: face ids, top first;
  - edges with `edge_fold_degrees`.

  Layer order is stored **per arrangement cell, never per face**, because a cyclic panel order is legal (`model.rs:13-27`). Nothing in the schema assumes the state is flat or static.
- **Session.** `Fold3dSession::new` runs admission, plane clustering, the census, the cell arrangement, the order enumerator and the render model, all in one call (`session.rs:137-212`). Cost was measured at about 0.85–0.97 s for a fold of the largest admitted corpus model, 5,010 segments (`implementation-plans/3d-folded-state.md:3953`).
- **Penetration checks.** Admission checks closure per vertex and local self-intersection only (`folding3d.rs:15-21`). Piercing between planes is modelled as constraints (`constraints.rs:748-825`). The research notes that the transversal-crossing detector "is sound but not complete" (`research/2026-08-07-3d-fold-feasibility.md:537-542`).

### Web renderers for folded figures (VERIFIED)

**3D window.** `Folded3dWindowLayer.tsx` builds `folded3dMesh` from the render model and drives `useFolded3dMeshRuntime`. That sends a payload to `FoldedMeshSource` in the shared simulator worker, which draws with the simulator's `MeshRenderer`. Frames come back as ImageBitmaps.
- Positions are uploaded once: the "texture is written once at load and never again" (`apps/web/src/simulator/foldedMeshSource.ts:16-20`).
- The per-frame work is a camera uniform and a draw.
- The live orbit goes through a side table (`subscribeFolded3dOrbitCamera`), not React. The reason is recorded: routing per-frame camera writes through the store cost 901 ms of main-thread time and caused stutter (`implementation-plans/folded-figure-viewport.md:80-92`).
- Orbit now exists (`folded/foldedFigureOrbitGesture.ts`, `useFolded3dOrbitFigures.ts`), so the "orbit deferred" note at `3d-folded-state.md:3982` is out of date.

**Vector path (export and Diagram capture).** `folded3dScene.ts` goes through `meshToPaperScene`: BSP, then hidden-piece culling, then coplanar runs. The CPU projector `foldedFigure3dProjection.ts` has been retired (`folded3dScene.ts:1-10`; the file no longer exists). Measured BSP cost was 5.04 ms per frame at 484 items, 12.1 ms at 1024, and crosses 16 ms near about 1,265 items (`3d-folded-state.md:999-1004`).

**Flat figure.** `foldedFlatScene.ts` turns the kernel's `OristudioCpFoldedPaperScene` into a painter's order. That scene holds faces (`outline`, `front_up`, edges) and subfaces (`polygon`, `faces_top_to_bottom`) (`engine/oristudioCpTypes.ts:529-570`). It topologically sorts the stacks and patches woven components.

### Precrease fold animation (VERIFIED, `implementation-plans/precrease-fold-animation.md`, `apps/web/src/cp-workspace/references/fold/`)

What it built:
- **One motion decision.** `stepFoldMotion` decides which side moves, and the card's arrow reads the same answer.
- **`foldSurface`.** A swing angle θ plus a "press", with a bend radius `r(s)=R(1−p·c(s))`. It deliberately stretches the paper so the flap lands exactly where a sharp fold would put it (`foldSurface.ts:14-24`). `rigidHinge` is the `r=0` case (`:71`).
- **`foldSplit`.** CP strokes are split at the chord once, when play starts.
- **`foldPoseGeometry`.** A top-down projection with depth taken from height (`DEPTH_FLOOR 0.05`, `DEPTH_SPAN 0.9`, `:118-119`). Paper colour and the mountain/valley ink swap follow the sign of the normal.
- **Transport.** `foldPlayback` is a pure run/leg state machine. `foldTransport` is the rAF loop with an injectable clock, pushes poses through `setFoldPose` on the view handle rather than React state, and handles reduced motion and auto-play.
- **Renderer.** Drawn through the `CpRenderer.setFolded` channel, which uses depth-ordered regl fill and stroke programs (`renderer/reglRenderer.ts:155-159`).

Scope and cost:
- It is a single sheet with no layers. "Out of scope, on purpose: layer ordering, folded intermediate states, folds through several layers, inside reverse folds" (`:34-36`).
- The plan names the seams it left for this work: a 3D-paper top-down stream with depth, `FoldMotion` as per-step data, and a per-layer z offset (`:321-345`).
- On a synthetic 50k-segment pattern, the split took 33 ms once and a frame took 37 ms, with allocation as the bottleneck (`:416-421`).

### Origami simulator (VERIFIED)

- **Rest state.** Positions are `originalPositions` (the flat sheet) plus a displacement (`prepare.ts:42-68`, `webglSolver.ts:448-450`). `reset()` returns to the flat rest state (`solverBackend.ts:30-34`). There is no API to seed positions.
- **Fold profiles.** `FoldProfile {edge, fromAngle, toAngle}` exists (`types.ts:29-37`, `model.ts:33-51`). The GPU solver ignores it (`webglSolver.ts:220-223`), and the session falls back to the CPU `ReferenceSolver` whenever a profile is set (`simulatorSession.ts:949-954`). Nothing in `apps/web` sets a profile today; I grepped for it.
- **Pull tool.** It adds poses (rest angles, lengths and face angles latched from the current shape) and pins. It states "**No self-collision.** A flap pulled into the model passes through other layers" (`implementation-plans/simulator-pull-tool.md:191`).
- **Speed.** About 4,800 GPU steps per second. A dense CPU fold took 232 s on lamprey (`:139`, `:169`).

### Diagram PR at 31e1d6d84 (VERIFIED by `git show`)

- `DiagramPose3dView.tsx` mounts `folded3dMesh` with `useFolded3dMeshRuntime` and `SimulatorViewport` for 3D step poses.
- `captureFolded.ts` captures step pictures as `PaperScene`s (flat through `foldedFlatPaperScene`, 3D through `folded3dFigureScene`), mostly by re-folding a CP through the kernel.
- `cp-workspace/folded/foldedLayerSpread.ts` adds two picture-only distortions: Akitaya's depth spread `D(v)=V(v)+p·z(v)/z_max·d`, and Morisue/DEFOX's affine spread. Neither changes layer order.

### Rigid kinematics solvers (VERIFIED)

- `solve_fold_angles.rs` solves for three unknown angles at a vertex with the rest fixed (Wong §5). On a degree-4 vertex this is exactly "drive one crease, solve the other three".
- `solve_k.rs` handles other arities. It refuses k ≥ 4 because the closure Jacobian has rank at most 3 (`solve_k.rs:20-33`).
- The closed form is complete only where the Jacobian has rank 3. Rank deficiency "is a snapped-geometry phenomenon" (`solve_fold_angles.rs:75-96`). Flat states are the worst case for it.

## Animation strategy options

### A. Two-group (later N-group) rigid pose on the 3D window — recommended for V0

A step's motion is: per-face group ids (on the before-state's faces after splitting by the new creases), plus a per-group `Rigid(t)`. For V0 that is group 0 = identity and group 1 = `Rigid::about_line(p, d, sign·t·π)`, with `p` and `d` the fold line in folded space.

The pose renderer:
- builds the posed mesh once per step, from the before state's cells clipped by the fold line;
- each frame, transforms vertex positions per group and rotates each skin's `up` and `centroid` by its group's rotation;
- runs the existing draw-pass logic.

The endpoints are drawn from the real states: before-model at `t=0`, after-model at `t=1`.

- **Pros.**
  - Exact: rigid motion is the physics of a simple fold.
  - No kernel call per frame.
  - Layer order is inherited, so there is nothing to flicker.
  - Orbitable, and the Diagram can reuse the same mesh.
  - Proper rotations keep triangle winding, so front and back colours keep coming from `gl_FrontFacing` with no re-winding (INFERRED from the winding contract at `folded3dMesh.ts:79-95`).
- **Cons.**
  - Needs a posed variant of `FoldedMeshSource`: a per-frame position upload through `GlCore.updateTexture` (`glCore.ts:248`), or a per-group transform in the shader.
  - Needs a per-vertex group id.
  - Needs the skin side test to change from a view direction to the eye point (see Rendering layers).
  - Depends on WebGL2 in a worker, with the existing capability gating.

### B. Top-down 2D pose on `CpRenderer.setFolded` (the precrease route)

Project to the plane and take depth from height. Painter's order puts the stationary stack first (by layer), then the moving stack. The moving stack is drawn reversed once its normal turns away from the viewer.

- **Pros.**
  - Main thread, no worker, no WebGL2-in-worker requirement.
  - The precrease plan already describes this extension (`precrease-fold-animation.md:325-334`).
  - Good for a diagram-like default view, and as a fallback.
- **Cons.**
  - Only near-top-down cameras.
  - Per-frame re-upload is allocation-bound (37 ms at 25k strokes).
  - A second picture path to keep consistent with A.

### C. Re-fold per frame through `Fold3dSession` with `t·180°` creases — rejected

- It is representable: the 3D route accepts mixed classic and non-classic creases (`3d-folded-state.md` §"What G does", row d).
- It is wrong in kind:
  - it re-solves the order instead of inheriting it, so a flat state with several valid orders can come out differently from the sequence's own order;
  - creases within `flat_snap_degrees` of 180 are snapped to full folds (`folding3d.rs:164-170`);
  - the constraint type is discontinuous at 180° ("strictly *more* valid layerings" when exactly flat, `research/2026-08-07-3d-fold-feasibility.md:531-536`);
  - it costs up to about 1 s, and the kernel offers no per-frame entry point.
- Small caveat: a single call at `t=0.5` could still serve as an **oracle in tests** to cross-check the poses that option A synthesises.

### D. Origami simulator driven by a fold profile — rejected for V0

- It would need a new seed API: writing `u_lastPosition` and `u_lastTheta`, with the correct ±180 sign history.
- It has no collisions, so stacked layers cannot keep their order.
- It forces the CPU backend.
- The mass-spring solve lands short of the exact after-state, so the last frame would pop.
- It is path-dependent, so scrubbing backwards means simulating again.
- Possible later use: a "physical preview" for non-rigid steps, with stationary nodes pinned (the pull tool's fixed-node mask), labelled as a preview and never treated as state.

### E. Rigid-origami kinematics for complex steps — later

Drive one angle, solve each vertex with `solve_fold_angles` / `solve_k` (propagating as in `fold-angle-propagation.md`), then place with the `Placement3d` walk. This needs branch tracking, because the solvers return finite branches per frame. Every motion that starts from a flat state starts at a bifurcation point: branches of a degree-4 vertex meet at the flat state ([Waitukaitis et al., PRL 114, 055503](https://link.aps.org/doi/10.1103/PhysRevLett.114.055503)).

**DERIVED — the inside reverse fold has no direct rigid path.** Take the vertex where the reverse-fold line meets the spine. In paper order its creases are S1, La, S2, Lb, with sectors θ, π−θ, π−θ, θ. Look at mirror-symmetric configurations, writing ψ=(π−ρ_S1)/2. Requiring S2 to stay in the mirror plane gives exactly two solutions for every ψ:
- φ=π: the straight fold along S;
- φ=2δ−π, with δ=atan2(sin θ cos ψ, cos θ): the reverse-fold branch.

The two coincide only at ψ=π/2, which is the vertex unfolded flat. At ψ=0 the second branch gives S2 reflected across La, which is the reverse-folded state.

So a rigidly correct animation of a reverse fold must open the flap's vertex fully and then refold it. That matches the "precrease, unfold, refold" wording of diagrams. What a human actually does involves bending the paper. Sinks are likely the same or worse: a closed sink needs bending (INFERRED).

### F. Visual (non-isometric) motion with exact endpoints

This is the precrease approach of "stretch the truth, land exactly", generalised to groups. It is acceptable only as a picture. The state at `t∈{0,1}` must always be the true model. It is probably the right default for reverse folds, squashes and sinks, as legs: spread, then move, then close.

**Architecture implied by A, E and F:** a step-type registry. Each type returns a `StepMotion` with:
- `groups` (per split face),
- `legs` (reuse `FoldLeg`/`FoldLegPace` from `foldPlayback.ts`),
- either `rigid(t) → Rigid[]` or `place(face, point, t) → Vec3`.

The transport and renderer never need to know which fold type produced it. This is the precrease plan's seam 2 (`precrease-fold-animation.md:335-338`) made concrete.

## Rendering layers

### What the code does today (VERIFIED)

- **3D window: skins, not displacement.** Displacing layers by an epsilon "was tried and it does not work". The displacement would have to be per cell, so each crease sits on a discontinuity, and the scheme collapses when viewed edge-on (`folded3dMesh.ts:10-40`). Instead each plane gets two skins: the top face of every cell, and the bottom face. The side is picked per frame by `up · viewDepthAxis` (`foldedMeshSource.ts:209-213`), skins are drawn far to near by centroid, and the fold-line tie is settled by draw order rather than epsilon (`:268-279`). Hinge creases are drawn only when the partner plane shows the required side (`folded3dMesh.ts` `Folded3dHingeGroup`). A crease depth bias breaks only the tie between a crease and its own face (`meshRenderer.ts:267-276`).
- **Vector export.** A BSP with coplanar items ordered by layer rank (`BspItem.order`), because sorting cannot express three-way depth cycles (`packages/origami-simulator/src/bsp.ts:1-9`).
- **Flat figure.** Painter's order from a topological sort of the subface stacks, with patches for woven components (`foldedFlatScene.ts:1-56`).
- **Precrease.** Depth taken from height, with the flap hovering a hair above the paper.
- **Diagram PR.** Depth and affine spreads distort only the picture.
- **Vestigial.** `FOLDED_3D_REQUIRED_DEPTH_BITS` and the `shallowDepthBuffer` warning still mention "layer displacement" (`foldedMeshSource.ts:392-401`) even though the displacement is gone. INFERRED: nothing depends on them anymore.

### What the Fold workspace needs

1. **During a V0 motion there are exactly two planes and no coplanar overlap between groups**, except at `t=1`.
   - At `t=0` the moving cells and the stationary cells sit on opposite sides of the fold line, so they share only an edge.
   - **DERIVED: the eye-point painter's rule is exact.** The moving group lies strictly in one half-space of the stationary plane P. If the eye is in that same half-space, every ray meets the moving group before it reaches P, so draw the stationary group first. Otherwise draw it second.
   - Inside a group, use its skin. No depth buffer is needed between the two groups, so there is no z-fighting near `t→1`. Without this rule, the final degrees would z-fight in the thin wedge by the hinge, since separation is only `d·sin φ`.
2. **Use the eye point, not the view direction, for the skin side.** The current test is exact only under an orthographic camera, and the code says so (`foldedMeshSource.ts:194-207`). A plane cannot be seen from both sides by a single eye point. Every swing passes through edge-on, so the existing approximation would flip a moving stack's visible layer early or late. INFERRED, and a small change.
3. **Switch to the after-model exactly at `t=1`**, as the precrease landing does. The after-state's layer order must be the *composition* of the sequence: the stationary stack with the moving stack reversed on top. It must not be a re-solve, or the last frame pops. This is a constraint on the folding kernel (another agent's area), stated here because animation is where a mismatch shows.
4. **Edge assignment.** `folded3dEdgeAssignment` maps `0°` to `EDGE_CODE.aux` (`folded3dMesh.ts`, `folded3dEdgeAssignment`). New creases at `t≈0` would therefore draw as aux lines. The posed mesh must carry the final M/V assignment.
5. **Framing.** Fix the camera to the bounds of before ∪ after ∪ the swept half-disc for the whole step. Re-fitting every frame makes the model visibly "breathe" (`apps/web/src/simulator/framingFollow.ts:4-17`), and the precrease plan's loudest complaint was the camera moving.

## Interactive preview

**Budgets (VERIFIED).** A frame is 16.7 ms on the main thread. Nothing per-move may go through Zustand: the viewport plan measured a re-render per frame at 2.85 ms with 30 figures (`folded-figure-viewport.md:520-530`), and per-frame store writes cost 901 ms of main-thread time. The CP kernel runs in a worker over Comlink (`store/workspaceStore/oristudioCpRuntime.ts:41-44`). The fold-cancellation bar is no uninterrupted stretch over 100 ms. `prepare_subface_segments` is O(n²): 56 ms on a 40×40 grid and 889 ms on 80×80 (`fold-cancellation.md:96-108`).

**Recommended split**

- **On each pointermove:**
  1. Compute the fold line in folded coordinates.
  2. Clip every before-state cell polygon by the half-plane. This is O(total cell vertices), with no arrangement and no solver.
  3. Compute the moving set and its validity from the cell stacks. Moving faces must form a contiguous run, starting from the side the fold goes toward, in every cell they occupy. The kernel's wall rule says the same thing (`research/…3d-fold-feasibility.md:523-530`).
  4. Draw the landed picture (DERIVED): front skin of the stationary side, then the reflected back skin of the moving side on top for a valley fold toward the viewer, or the mirror case.

  Inputs already exist: the cells and stacks are in the render model (`cell_stack`) and in the flat paper scene (`faces_top_to_bottom`).
- **Throttle** to one update per rAF, latest wins. Copy the fire-and-forget `setCamera` pattern in `useFolded3dMeshRuntime.ts:166-183`.
- **Preview fidelity, in increasing order of cost:**
  - an outline-only ghost;
  - the full landed picture in 2D (option B);
  - a posed 3D mesh at a fixed preview angle. This last one needs earcut per move (0.19 ms at 484 items, `3d-folded-state.md:1000`) plus a payload transfer to the worker.
- **On release:** compute the after-state (CP preimage and composed order) once in the kernel worker, cancellable, then play the motion.
- **Testing:** the agent browser pane issues no animation frames (`3d-folded-state.md:3988-3990`). Animation tests need `FoldTransportClock`'s injectable clock (`foldTransport.ts:44-50`) and headless frame capture.

## Reuse assessment

| Piece | Verdict | Why |
| --- | --- | --- |
| `folded3dMesh` (skins, hinges, ink, aux) | **Reuse** | Schema-driven. Works for one plane (flat) and two planes (pose). Needs a per-vertex group id. |
| `FoldedMeshSource` / `useFolded3dMeshRuntime` / `SimulatorViewport` | **Reuse and extend** | Add a posed upload (`updateTexture`) and transformed skin `up`/centroid. Worker mesh cap and eviction already exist (`simulatorLimits.ts`). |
| `folded3dDrawPasses` | **Reuse, with a fix** | Eye-point side test; exact two-group order. |
| `meshToPaperScene` / BSP | **Reuse for export only** | Mid-fold Diagram pictures. Too slow per frame above about 1k items. |
| `foldPlayback` / `foldTransport` | **Reuse after generalising** | `FoldPose {flap, angle, press}` is specific to precrease. Lives under `references/fold/`, so it would move to a shared module. |
| `foldSurface` / `foldSplit` / `foldPoseGeometry` | **Pattern only** | One convex sheet, CP strokes, no layers. The curl is cosmetic. |
| `Placement3d` / `Rigid` | **Reuse** | Group transforms and future kinematic walks. |
| `solve_fold_angles` / `solve_k` | **Later (option E)** | Bifurcation at flat states, branch tracking needed. |
| `Fold3dSession` per frame | **No** | Re-solves order, has no per-frame API, snaps near 180. |
| Origami simulator as the step engine | **No** | No collisions, flat rest state, no seed API, profiles are CPU-only. |
| Edit's folded-figure object (`foldRoute`, solution cycling, staleness) | **No** | A sequence state is determined by its path; cycling enumerated orders contradicts that. |
| Diagram layer spreads | **Maybe**, for flat-state views | Picture-only; on the frozen PR. |

## Open questions / risks

1. **Where the pose model is synthesised.** Option one is in Rust, from the kernel's own cells: no second implementation of clipping, but a new entry point is needed. Option two is in TypeScript, from the render model: faster to iterate on, but needs a robust clip of non-convex polygons against a half-plane. Plane `up` must stay consistent across the moving plane. `planes.rs` is "the single place a stack's up is chosen", and a stack read with the wrong `up` silently reverses the order.
2. **Interop with the Diagram.** Its capture re-folds CPs through the kernel. A Fold-workspace step must instead hand over its own render model, which `DiagramPose3dView` already accepts, or its path-determined order can be replaced by an enumerated one.
3. **Simulator package parity.** A posed variant of `FoldedMeshSource` must leave the simulator's golden and parity benches untouched (the pull plan's discipline).
4. **WebGL2 in a worker on WKWebView/WebKitGTK** is still flagged as needing measurement (`research/2026-07-26-inline-simulation-feasibility.md:110-121`). There is a 4-context-per-worker cap (`:67`). Thumbnails of many steps should use mesh tokens, not contexts.
5. **Reverse folds, sinks, squashes.** Rigidly correct paths go through the unfolded vertex state (derived above). Product needs to choose between "visually plausible, exact endpoints" and "rigid with an unfold leg"; I recommend the former as the default.
6. **Perspective near edge-on** for groups made of more than one plane, beyond V0's two-group order. A general N-group motion needs either a BSP per frame (cost) or the depth buffer, with its precision wedge near `t∈{0,1}`.
7. **Prior art** is mostly older than physics simulators. Sequence-based folding with an animation reconstructed from the steps appears in Miyazaki et al. 1996 ([J. Vis. Comput. Animation 7(1):25–42](https://ftp.math.utah.edu/pub/tex/bib/idx/jviscompanimation/7/1/25-42.html)). The Eos computational origami system implements Huzita's axioms over superposed faces ([Ida et al.](https://www.logic.univie.ac.at/2010/Talk_03-18_a.html)). I did not read either paper beyond index and summary pages (INFERRED), so neither has been checked as an oracle.
