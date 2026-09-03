# Simulator renders every crease pattern mirrored

## Goal

An inline simulation window, and the Simulate workspace, must show the crease
pattern the way the crease-pattern canvas shows it — same orientation, not its
mirror — with the **coloured** side of the paper facing the camera in the
initial view.

Today both surfaces draw the sheet flipped: a crease running to the top-right
corner on the canvas runs to the bottom-right in the simulation. The paper is
already the coloured side, so that half is a no-op; the mirror is the bug.

## Approach

### Root cause

`MeshRenderer`'s view transform is a **reflection, not a rotation**.
`viewRotation` in `packages/origami-simulator/src/webgl/camera.ts` builds

```
r0 (screen right) = [ cy,        0,   sy      ]
r1 (screen up)    = [-cp·sy,   -sp,   cp·cy   ]
r2 (toward eye)   = [-sp·sy,    cp,   sp·cy   ]
```

whose determinant is **−1** at every yaw and pitch (at yaw 0, pitch 0 it is the
plain y/z swap `[[1,0,0],[0,0,1],[0,1,0]]`). Upstream Origami Simulator draws
through THREE.js, whose camera basis is right-handed, so this is a port
divergence rather than a design choice. Its consequence is that every picture
this renderer produces is the mirror of the true view, and `gl_FrontFacing` is
inverted relative to THREE's `FrontSide`.

Both facts are already known to the 3D folded figure, which compensates for
them — `folded3dMesh.ts` places the kernel's model with `toSimBasis`
(`(x, y, z) → (x, z, −y)`) and winds every triangle about `−paperFrontNormal`
precisely so the reflection cancels. The folded figure therefore renders
correctly today.

The simulator never compensated. It lifts a 2-component FOLD with
`normalizePoint([x, y]) = [x, 0, y]`, and **every FOLD this app produces is
y-down** — the crease-pattern canvas's own model space (`userCameraToView` maps
model +y to device +y), and TreeMaker converts on the way out
(`to_fold_document` emits `paper_height − y`, per the note in
`lib/creaseExport.ts`). Lifted that way and viewed through a reflecting camera,
the sheet's y runs *up* the screen: the mirror the user sees.

Measured, at the default view with a square whose canvas corners are known:

| canvas corner | screen position today | after the fix |
| --- | --- | --- |
| top-left | left of the diamond | top |
| top-right | bottom | right |
| bottom-right | right | bottom |
| bottom-left | top | left |

Clockwise, today's order is `TL → BL → BR → TR` — the reverse of the canvas.

### Fix

Lift a 2-component FOLD as `[x, 0, −y]`: the 2D case of the folded figure's
`toSimBasis`, so the two surfaces finally place the paper the same way.

The paper's two tones and the mountain/valley sense follow for free on the CP
path, and this is worth stating because it is not obvious.
`prepareSimulationFold` (`lib/creasePatternImport.ts`) runs
`orientFacesConsistently` **after** the lift, re-deriving every face's winding
from the lifted coordinates so all normals point one fixed way, and then scales
the fold angles by a matching constant `SIMULATION_FOLD_ANGLE_SIGN`. Both are
therefore invariant under a change of lift sign: verified in the browser with
the back colour forced to magenta — the sheet stays `--sim-paper-front` before
and after.

### The one thing that does not follow

`simulation_model.fold` now carries `z = −y`, and four places read that plane
back into crease-pattern space through `flatPlaneAxes` plus open-coded index
arithmetic (`coord[axes[0]]`, `coord[axes[1]]`), which silently assumes
`z === y`:

- `simulationFacesForSegment` — matches mesh faces against segment bounds that
  were measured in the **base** fold's space, so a sign error stops every
  segment-scoped simulation (the inline simulation window) from finding its
  faces.
- `foldProjector` and `creaseExportGridSvg` in `lib/creaseExport.ts` — the
  crease-pattern image export, which is handed the simulation fold.
- `cpModelToFoldTransform` in `lib/creaseExportFold.ts` — aligns fold bounds to
  document bounds by span and centre, so a mirrored input yields a mirrored
  transform.

That assumption written four times is what broke. Replace it with one reader
that maps a fold coordinate into model space and owns the sign.

## Affected Areas

- `packages/origami-simulator/src/geometry.ts` — the 2D lift.
- `packages/origami-simulator/src/webgl/camera.ts` — document the determinant,
  beside the matrix, since it is the reason the lift looks upside down.
- `apps/web/src/lib/creasePatternSegmentation.ts` — one plane reader, replacing
  `flatPlaneAxes` + index arithmetic at its call sites.
- `apps/web/src/lib/creaseExport.ts`, `apps/web/src/lib/creaseExportFold.ts` —
  use that reader.
- Tests in both packages that pin the old lift.

## Checklist

- [x] Reproduce and measure the mirror (browser + a projection probe).
- [x] Root-cause it to the determinant −1 view against y-down FOLD input.
- [x] Confirm the paper tone and fold direction are pinned downstream of the
      lift on the CP path.
- [x] Flip the 2D lift.
- [x] Give the `(x, z) → (x, y)` read-back one home and the correct sign.
- [x] Update the call sites in `creaseExport.ts` / `creaseExportFold.ts`.
- [x] Tests: lift orientation, plane read-back round trip.
- [x] Run web lint, typecheck and unit tests, and the simulator package tests.
- [x] Verify in the browser: orientation matches the canvas, coloured side
      faces the camera, folds still run the same way, inline simulation still
      finds its region, the folded figure is unchanged, CP export is not
      mirrored.
