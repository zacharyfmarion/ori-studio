# Simulator Options Panel

## Goal

Give the Simulate workspace a right-side options pane, matching the Edit
workspace's **View** pane, and use it to expose the simulator controls that
exist in the engine but have no UI — material stiffness, damping, solver
stability, speed — alongside the render toggles currently crammed into the panel
header.

Then close the ranked functional gaps this audit surfaced, highest value first:
strain visualization (currently a stub on the GPU), exporting the folded form,
and anchors/gravity.

Phase 1 is UI-only. Phases 2+ each need engine work and are separable; the plan
records them so the panel is designed with room for them rather than retrofitted.

## Approach

### Phase 1 — The pane and the options the engine already supports

**Wiring** mirrors `cp-view-controls` exactly:

- `layoutStore.ts` / `applySimulateLayout`: add a panel beside the simulator,
  `position: { referencePanel: 'simulator', direction: 'right' }`,
  `initialWidth: 260`, title `View` — the same call shape `applyEditLayout` uses.
- `PanelComponents.tsx`: register `'simulator-view-controls'`.
- `workspaces.ts`: map `'simulator-view-controls' → 'simulate'`.
- `editingContext.ts`: add the case so context-masked menus/toolbars behave.

**State ownership.** `SimulatorPanel`'s `viewSettings` is local `useState`
today; a sibling panel cannot reach it. Move the shared settings into a
workspace-store slice, following `oristudioCpViewport` /
`setOristudioCpViewportOption` (same shape, same naming). Transport state
(`foldPercent`, `playing`) stays in `SimulatorPanel` — it is not shared.

Persist the settings through `lib/storage.ts` (the centralized module, with a
key in its registry), so material and render preferences survive a reload.

**Sections** (using the existing `panel-shell` / `panel-body` markup and the
`ToggleRow` / `NumberRow` / `Select` / `Toggle` primitives):

1. **Render** — move the header toggles here: Paper/X-ray, faces, crease lines,
   hidden lines, lighting. Add **colour mode** (`paper` | `strain`), disabled
   with an explanatory tooltip until Phase 2 lands.
2. **Material** — the real creative knobs. All already accepted by
   `SimulatorOptions` and applied live: both backends' `setMaterial` recompute
   the timestep (GPU re-uploads material and recomputes `dt`; CPU invalidates its
   cached `timeStep`), so no engine change is needed.
   | Option | Default | Suggested range |
   | --- | --- | --- |
   | Axial stiffness | 20 | 1–100 |
   | Crease stiffness | 0.7 | 0–5 |
   | Facet (panel) stiffness | 0.7 | 0–5 |
   | Face stiffness | 0.2 | 0–5 |
   | Damping | 0.45 | 0–1 |
   With a **Reset to defaults** action (`RotateCcw`, as the CP pane does).
3. **Solver** — **Stability** (`timeStepScale`, 0.05–1, default 0.35) and
   **Speed** (fold play %/s, and/or steps per tick). Stability is worth
   surfacing precisely because real patterns diverge at 1.0/0.5 and hold at 0.35
   (see `bench:gpu-stability`); when a fold misbehaves this is the honest fix.
4. **Info** — vertices/triangles, step, max strain, backend (GPU/CPU). Mirrors
   the existing status bar; decide whether to keep both or move it here.

**Deliberately excluded:** the Euler/Verlet integrator toggle. `SimulatorOptions`
accepts it, but the GPU path does not implement Verlet, so selecting it silently
falls back to the slow CPU renderer. Ship it with Phase 4, not before.

### Phase 2 — Strain visualization (the top functional gap)

`WebglSolver.readColors` is a stub (`into.fill(0.75)`), so strain colouring only
works on the CPU path — i.e. effectively never, since GPU is the default. This
is the simulator's most valuable analytical output: it shows where the paper is
being stretched, which is where the crease pattern is physically infeasible.
Upstream ships it with a `strainClip` control.

The data is already on the GPU: `velocityCalc` writes per-node strain into the
velocity texture's alpha, which `maxVelocity()` already reads back. So this is a
colour-ramp branch in the mesh renderer's fragment shader (sample that alpha,
map through a clipped ramp) plus a `strainClip` uniform — not new physics and no
extra pass.

Also fix the metric inconsistency found while debugging: the GPU reports
per-node **mean axial** strain while the CPU reports max **edge** strain, so the
"Strain" readout means different things per backend and reads systematically low
on GPU. Make the reported number mean one thing, and note which in the UI.

### Phase 3 — Export the folded form

The simulator cannot hand its result anywhere. Upstream exports OBJ, STL, and
folded FOLD. Add export of the settled geometry (folded `vertices_coords` written
back into a FOLD frame, plus OBJ/STL), routed through the existing file-service
and command patterns rather than a panel-local download.

### Phase 4 — Anchors, gravity, and Verlet

`packing.ts` hardcodes `mass[i * 4 + 1] = 0; // nothing fixed` and zero external
forces. Pinning vertices and adding gravity is both a product feature (models
that hang naturally) and a stability tool — anchoring removes the rigid-body
drift that feeds divergence. Porting Verlet to the GPU belongs here too: it is
the more stable integrator, which would let harder patterns fold cleanly, and it
unblocks the integrator toggle held back in Phase 1.

### i18n

Every new label goes through `t('panels:simulatorViewControls.…', 'English')`,
then `npm run i18n:extract`, translations for the 8 locales, `npm run i18n:stamp`,
and `npm run i18n:check` must pass.

## Affected Areas

- `apps/web/src/components/panels/SimulatorViewControlsPanel.tsx` (new)
- `apps/web/src/components/panels/PanelComponents.tsx` — register the component
- `apps/web/src/store/layoutStore.ts` — `applySimulateLayout`
- `apps/web/src/workspaces/workspaces.ts`, `editingContext.ts` — panel→workspace
- `apps/web/src/store/workspaceStore/` — settings slice + actions
- `apps/web/src/components/panels/SimulatorPanel.tsx` — read settings from the
  store, drop the moved header toggles, call `runtime.setMaterial`
- `apps/web/src/lib/storage.ts` — persisted key
- `apps/web/public/locales/*/panels.json` — new labels
- Phase 2+: `packages/origami-simulator/src/webgl/{meshRenderer,webglSolver}.ts`,
  `packing.ts`, and the export/file-service paths

## Checklist

- [x] Phase 1: workspace-store slice for simulator settings (+ persistence)
- [x] Phase 1: `SimulatorViewControlsPanel` with Render / Material / Solver / Info
- [x] Phase 1: layout, registry, workspace and editing-context wiring
- [x] Phase 1: move header toggles out of `SimulatorPanel`, keep transport there
- [x] Phase 1: material + stability changes apply live via `runtime.setMaterial`
- [x] Phase 1: i18n extract / translate / stamp / check
- [x] Phase 1: unit tests (panel renders, a slider dispatches setMaterial, reset
      restores defaults) and `tsc` / `eslint` / `test:web` -- 800/800 pass. The
      `colorMode` select shipped with Phase 2 rather than disabled in Phase 1, so
      it never appeared as a dead control.
- [x] Phase 2: GPU strain colour ramp + `strainClip`; unify the strain metric
- [x] Phase 2: the parity bench's render check now gates that strain mode changes
      the image (compared with creases hidden, since 3px ribbons cover the faces
      on a dense model at 128px), and both backends report identical strain in
      `bench:gpu-stability`
- [ ] Phase 3: export folded FOLD / OBJ / STL
- [ ] Phase 4: anchors + gravity; port Verlet to the GPU, then expose the toggle
- [ ] Browser check (user): pane looks native beside the Edit view's, sliders
      change the fold visibly, nothing regresses in the transport
