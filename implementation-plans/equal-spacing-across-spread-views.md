# Equal layer spacing in 2D Diagram, Edit, and non-flat folds

## Goal

Make the same Amount setting give comparable separation on simple and deeply layered models. Cover Default spread in a 2D Diagram step, a folded figure on the Edit canvas, and spatial spread on a model folded with partial creases. A figure and a Diagram picture drawn from the same fold, settings, and view should agree. Existing projects should open, refresh, export, and save with the spread the author chose. Adopting the new scale on an existing picture is an explicit, undoable edit.

PR #616 introduced a per-model gain for a flat fold shown in Perspective 3D. Its connected spread versions 1 and 2 are both compatibility targets for this follow-up. [PR #616](https://github.com/zacharyfmarion/ori-studio/pull/616) · [Design at the reviewed revision](https://github.com/zacharyfmarion/ori-studio/blob/4823afc7e6cdf3fb2b9cb04356e7bff691644847/implementation-plans/spread-equal-opening.md)

## Approach

### 1. Pin the file behavior first

Version the display rule on each spread recipe. Edit already saves this version per folded figure in `oristudio.foldedFigureSpreads`. Its reader preserves an unknown recipe and its saved entry for a newer build. #616 offers its Update button in Diagram Pose. This follow-up adds the same explicit choice to Edit Properties for each eligible flat or spatial figure.

The table shows how far the renderer multiplies the unit solution **at 100% on the slider**. At 50%, halve each entry. Flat recipes store 100% as Amount 2, and spatial recipes store it as Amount 4. `g` is the gain measured by #616 for that flat fold. `s` is the independent spatial gain to calibrate in step 3.

| Saved recipe | 2D Diagram and head-on Edit | Diagram Perspective 3D | Model with non-flat creases |
| --- | --- | --- | --- |
| Connected v1 | 2× | 4× | — |
| Connected v2 from #616 | 2× | 4×g | — |
| **New connected v3** | **2×g** | **2×g** | — |
| Spatial v1 | — | — | 4× |
| **New spatial v2** | — | — | **4×s** |

- Write the new version when a user creates a fresh spread on the requested surfaces, including a new Diagram step that starts spread, turning Spread Layers on, or choosing Default again after another kind. Keep the current choice of initial Amount, reveal, and off/on state. Inheritance that displays an existing recipe, duplication, and copying a posed picture carry its version. When an earlier picture merely supplies starting controls for a genuinely new spread, borrow its values and set the new recipe's version at creation.
- Read and write an existing recipe at its own version. Opening Pose or Properties, scrubbing Amount, changing reveal, orbiting, refreshing, refolding, and exporting should never promote it to the new scale. Preserve #616's legacy first-entry/return behavior for Perspective. A v2 step saved back in 2D still uses the original 2× maximum. Audit #616's `spreadOutOfPerspective`, `spreadInPerspective`, Reset, and failed-capture paths so they cannot silently turn v3 into v1 or v2. A pose reset or retry retains the active scale policy.
- Retain the historical meanings of a missing spread, an explicit off, and an old untagged Depth spread. Keep Affine and Depth on their own drawing paths. Scope new defaults to the requested creation sites. A standalone Fold sequence, a source Fold step linked into Diagram, and the independent Export/Share dialog preferences each retain ownership of their settings.
- Use the existing unknown-version behavior. In a pre-feature reader, a Diagram step can show its stored picture and lock editing. Edit carries the complete unknown figure entry in the project's extensions bag. Fold carries an unknown step or document default and uses its existing display fallback. Verify a new → old → new save cycle with actual older reader code, including the #616 reader. The spread fields, stored pictures, and unknown payloads must survive.

### 2. Give 2D Diagram, Edit, and Perspective the same Amount

For v3, draw `2 × (slider percent / 100) × g` times the unit heights in all three views. Keep #616's gain calibration fixed for this version. Switching presentations retains the same stored Amount, lifted heights, and in-plane correction. In 2D, Layer reveal turns height into a sideways offset. Perspective projects the lifted paper through its camera with reveal zero. Those choices still produce distinct pictures of the same opening.

At the same camera angle, v3 Perspective at 100% draws exactly what #616 v2 draws at 50%, including face positions and crease ink. For a model that reached #616's 12.4° average-opening target at full Amount, the new full-slider measure is `atan(tan(12.4°) / 2)`, about 6.27°. A model constrained by the gain limits can open less. For head-on views, also measure visible separation relative to the figure at a fixed Layer reveal.

In a renderer prototype using the saved cameras from `separation_bug_example.osf`, the two-face fold showed a thinner strip of its gold underside. Bodo kept a similar silhouette, with tighter spacing around its projecting layers. Both measured 6.27° at the shared maximum. These are measurements of neighboring layers on those two examples.

Resolve the effective Amount where the renderer has the recipe, prepared solution, and presentation. Feed it to height, reveal, the in-plane correction that preserves paper size, and crease ink together. Keep the saved Amount in slider units. Check direct callers such as the Fold pane's `foldPaneSpreadMap` fallback, which calls `connectedDrawing` for picking without going through `foldedFlatPaperScene`. Live geometry, bounds, hit tests, annotation anchors, settled pictures, and exports must use the same placed vertices. Reuse #616's per-solution cache.

Verify both CP-linked and Fold-linked Diagram steps and Edit's live and reopened figures. Compare a shallow two-face fold and a deep stack at the starting Amount, 50%, and 100%, with the same reveal. Record adjacent-layer separation as a fraction of the unspread figure size, using a fixed frame for the comparison. Review the default reveal, centred and rotated reveal, and front/back views. Preserve a centred reveal as a valid user choice. Check that the new mapping reduces the shallow/deep disparity before freezing v3.

### 3. Calibrate non-flat folds from their spatial solution

The spatial solver already returns `mean_gap`, the area-weighted difference between neighboring layers' unit displacements along each ordered cell's local normal. This measures the separation *added by spread*. It handles a pair of parallel layers translating apart and a model with stacks on several planes. The model's pre-existing fold angles and distances are part of its rest shape.

1. On solved models with ordered stacks, measure the old full-slider gap as `4 × mean_gap / L`. Use a consistent rotation- and scale-independent material reference, initially `L = sqrt(total rest triangle area)`, in the same coordinates as the displacements. Measure the corpus median and spread of values. Use the median as the candidate full-slider target, with one vote per model. Compare shallow and deep stacks and validate on held-out models before choosing constants. Spatial spacing is a relative distance. The flat calibration's 12.4° is an angular measure.
2. Start with `s = target / old full-slider gap`. Bound amplification using the largest added vertex travel relative to model size, deformation of the triangles, and measured layer-order violations at full Amount. Derive and record the limits from the corpus and visible failures, including thin strips, slivers, and close stacks on different planes. Report median, 10th and 90th percentiles before/after, and which models hit a limit. Require a narrower gap distribution, useful opening on deep stacks, and correct picking and layer order across the slider. Pin the numbers and representative examples as spatial v2 goldens.
3. A solve with no ordered stacks has zero displacement at every Amount. Make near-zero or unusable measurements take a finite neutral gain. Retain the current failure/refusal path for unresolved layer order or unavailable geometry. Route by the creases included in the fold, including a flat-only selection inside a mixed file.
4. Cache the gain with the unit solution and apply it once to the display multiplier. The GPU already draws `rest + Amount × displacement`. Feed the same effective multiplier to the live Edit and Diagram meshes, CPU capture, bounds, visibility, and picking. Check that camera motion and slider drags reuse the unit solve and mesh, and changing the underlying fold invalidates both. Prefer the existing Rust/WASM result fields. If more diagnostics are needed, preserve the v1 solver output and test the worker protocol.

### 4. Offer an update that says what it preserves

Offer **Update spacing** for an editable legacy recipe in Diagram Pose or Edit Properties once its own solve is ready. Convert the stored Amount using `old Amount × old view multiplier / new view multiplier`. Commit the version, Amount and resulting picture together as one undo entry. In a Fold-linked Diagram step, update the Diagram picture's recipe. A cancelled, failed, or superseded capture must leave the prior picture and recipe intact.

The active view is the conversion reference for a legacy spread. For example, preserving v2 Perspective at 40% requires v3 at 80%. The old 75% would require 150%, beyond the slider. Show the capped result as an explicit choice and allow the user to keep the old spacing. For a v1 or v2 head-on picture in 2D or Edit, the preserving percentage is the old percentage divided by `g`. Say which picture the conversion preserves. After a spread is v3, switching between 2D and Perspective uses the same underlying opening at the same percentage. Opening or dismissing the offer writes nothing.

Use #616's drawing comparison for Diagram marks when an update can preserve the current picture. Exercise enlarged steps and the existing bitmap/changed-picture handling. Keep read-only and newer-build data on their existing paths. Route update usage through the existing analytics layer and localized controls.

## Affected Areas

| Area | Starting points |
| --- | --- |
| Flat geometry and projection | `packages/layer-spread`, #616's `layer-spread/equalOpening.ts`, `foldedFlatScene.ts`, `connectedScene.ts`, `foldPaneSpreadMap.ts` |
| Spatial geometry and drawing | `crates/oristudio-layer-spread/src/spatial.rs`, `spatialSpreadSettings.ts`, `folded3dSpread.ts`, `useSpatialFoldedMesh.ts`, `DiagramPose3dView.tsx`, `folded3dStoredScene.ts` |
| File compatibility and creation | `layerSpreadSettings.ts`, `foldedFigureSpreads.ts`, `foldedFigureSpreadStarts.ts`, `diagramFile.ts`, `foldSequenceFile.ts`, `linkedPose.ts`, `foldStepActions.ts` |
| Update, capture and parity | `foldedFigureSpreadFields.ts`, Diagram pose hooks, `annotationCarry.ts`, folded-figure export, layer-spread workers, `scripts/layer-spread/spatial/` |

## Calibration and compatibility results

In the original two-face and Bodo examples, the rendered v3 Perspective faces and ink exactly matched the previous v2 drawing at half the slider percentage. This held at 0%, 7%, 25%, 50%, 75%, and 100%. Both reached 6.273° at 100%. Legacy v1 and v2 rendered identically to the previous PR head at full Amount in both presentations.

For the head-on measurement, each overlap cell contributed its area times the screen distance between the same material point on neighboring layers. The table gives the weighted mean as a percentage of the unspread model diagonal, using the default reveal vector. A quarter-turn of reveal produced essentially the same distances. Centering reveal removed the sideways opening, leaving only the in-plane correction.

| Head-on model | 7% old → new | 50% old → new | 100% old → new |
| --- | --- | --- | --- |
| Two-face fold | 0.495 → 0.128 | 3.536 → 0.916 | 7.071 → 1.832 |
| Bodo | 0.0025 → 0.0271 | 0.0179 → 0.1933 | 0.0359 → 0.3867 |

The shallow-to-deep distance ratio at 100% fell from about 197 to 4.7. Equalizing opening angle still leaves different screen gaps on folds with different panel sizes.

For spatial v2, the five calibration models were Three-plane, Spikes, Cylinder, Waterbomb and Penguin. The median v1 full-slider gap was 1.638% of material length. Spatial v2 targets 1.6%, with at most 8× gain. At full Amount, amplification is limited by half a paper length of vertex travel, differential edge displacement of one edge length at the area-weighted 99th percentile, and order violation of 0.5% of a paper length. A field already at one of these limits can shrink or keep its former full-slider size. A no-stack field stays closed.

| Spatial full-slider gap as % of material length | Previous p10 / median / p90 | New p10 / median / p90 |
| --- | --- | --- |
| All 13 folds with stacks | 0.033 / 0.636 / 15.24 | 0.116 / 0.636 / 1.60 |
| Eight held-out folds with stacks | 0.025 / 0.193 / 5.25 | 0.087 / 0.305 / 1.14 |

Three-plane, Cylinder, Strip and Waterbomb reached the target. The bounds kept Spikes, Penguin, Level540, Pangolin and Plant-penguin at their previous opening. Hexhead, Scales, Stick2 and Tortoise opened farther within the bounds. Rectangles had no ordered stack.

## Checklist

- [x] Verify the two historical connected versions and shared 2× height using the real two-face and Bodo solves. Measure head-on spacing at the starting Amount, halfway and full.
- [x] Implement versioned flat drawing, hit testing, new spread creation and explicit Update for Edit, CP-linked and Fold-linked Diagram steps. Cover old Amount edits, presentation switches, reset, remembered poses, refusal and undo.
- [x] Calibrate spatial v2 on the production solver. Exercise rigid translation, scale and rotation invariance, deformation and order limits, no stacks and a capped conversion. Use the same gain for live drawing, picking, capture and export.
- [x] Exercise the production GPU and capture workers with seven spatial models, six slider positions and both camera sides. At full Amount, 11,442 interior pixels agreed with CPU material picking. Also exercise raster fallback and refusal.
- [x] Round-trip the original separation project and new flat/spatial recipes through the previous PR reader (`4823afc7e`) and a pre-feature reader (`88c40e45c`). Check stored scenes, annotations, Edit's versioned extension, and a Fold sequence's versioned default.
- [x] Open the original project in Chromium, refresh both steps, export the resulting PDF, save and reopen. Update Bodo, undo and redo, save again, and verify the other step and its marks survive byte-for-byte as the app represented them.
- [x] Run the layer-spread package and web tests, lint, typecheck, production build, prerender and localization checks. The implementation uses the existing solver and WASM wire format.
- [x] After main's folded-figure OBJ export (#637) merged in: its file and 3D preview lift by the figure's spread's version, flat (`connectedDrawAmount`) and spatial (`spatialDrawAmount`), so an OBJ opens as far as the figure does at the same Amount. A figure with no spread reads the dialog's Amount at the version Spread layers would make.
