# Folded model OBJ export

## Goal

Offer **OBJ** next to SVG and PNG in a folded model's export dialog. The file
is the folded paper in 3D with the figure's spread applied, so a model whose
layers the canvas shows apart imports into Blender (or any 3D tool) apart too.
The simulator's OBJ (`implementation-plans/simulator-obj-uv-export.md`) is the
pattern: one `.obj` with vertices, unfolded-sheet UVs and triangles, written by
the same serializer (`lib/foldedExport.ts::foldedObj`).

## Approach

### What the mesh is, per picture kind

The figure's export capture (`foldedFigureExportPicture`) already decides how
the figure draws. The OBJ follows that decision, so the file and the preview
agree about the spread:

| Picture | OBJ |
| --- | --- |
| `live-3d` | The render model's material source (`model.material`): welded sheet vertices, their folded positions, the faces. With a spatial spread (`spatialAmount(figure) > 0`), every vertex is moved by the solve's displacement at the figure's amount — the field the window draws, awaited as the picture awaits it. |
| `flat` | The kernel's paper scene, flat: every layer in one plane. |
| `spread`, Default (`connected`) | The paper scene lifted by the Default spread's solve: the true-size shift in plane and each vertex's height above the shown side's reference plane, times the amount. The reveal is a drawing shear, not geometry, and is left out. |
| `spread`, Affine or Depth | Unavailable, with the reason: those spreads move only the picture and have no 3D form. Never a silent unspread file. |
| `stored-3d`, `fixed` | No OBJ: no fold to read a mesh from. Their existing hints already say to fold again. |

### Geometry contract

- **Winding is the paper's front.** Every triangle's right-hand normal points
  out of the side drawn in the front colour: for 3D, a triangle is wound from
  its ring's sheet winding, and the kernel's rings are wound about
  `face_normals` (`interchange.rs::face_orders`); for flat, the winding is
  decided on the flat canonical geometry from the face's `front_up`, before
  any lift can invert a triangle's projection.
- **The paper the app draws, never its mirror.** One frame for both: x across
  the pattern, y up toward the front's viewer, z down the pattern as the editor
  shows it. The kernel reads the pattern's y-down coordinates as right-handed
  with z toward the front, so its 3D world is the mirror image of that paper —
  the window undoes it with the renderer's reflection — and a 3D figure is
  written through the same reflection (the renderer's basis with z turned
  round), its windings reversed to stay on the front. Flat figures use the
  canvas's view space (screen x, depth toward the viewer, screen y), which is
  right-handed; the rear pass is mirrored on the canvas but not in the file.
  Checked in Blender against the app's own picture with a pattern that has no
  mirror symmetry: the reflected file matches, the unreflected one is its
  mirror.
- **A Default spread's crossings stay.** The solve keeps joined paper apart
  softly and reports what it could not (`max_crossing`); the canvas draws
  through that by layer rank, the file carries the geometry. On the kabuto at
  50%, 36 of 150 stacked pairs cross by at most 0.0002 of the sheet, the same
  pairs the raw heights cross at.
- **Size and place.** The unfolded sheet's longer side is 1, and the mesh is
  centred on its bounding box.
- **UVs** come from the unfolded sheet through `sheetUvs`, the simulator's
  convention, one per vertex.
- Creases, aux lines and colours are not written, as the simulator's OBJ does
  not write them.

### Where it lives

- `cp-workspace/folded/foldedFigureObj.ts`: the pure mesh builders and the
  `PaperObjExport` captures for a 3D and a flat figure (the spread solves are
  awaited in `build()`, aborted when the dialog closes).
- `folded3dMaterial.ts` / `folded3dSpread.ts`: the spread posing and the solve
  lease, shared with the window instead of copied.
- `foldedFigureExportTarget.ts`: attaches `obj` per picture kind.
- `lib/paperExportSettings.ts`: a folded figure remembers OBJ as its format.
- `saveObjExport.ts` + catalogs: the Affine/Depth reason.

Analytics: `paper exported` already carries `format: obj` and the folded
surfaces; `docs/analytics.md` is updated to say so.

## Affected Areas

- `apps/web/src/cp-workspace/folded/` (new `foldedFigureObj.ts`, export target,
  spatial material and spread modules, tests)
- `apps/web/src/lib/foldedExport.ts`, `apps/web/src/lib/paperExportSettings.ts`
- `apps/web/src/paperExport/saveObjExport.ts`
- `apps/web/public/locales/*/dialogs.json`
- `docs/analytics.md`

## Checklist

- [x] Share the spatial posing and solve lease between the window and the export
- [x] Pure OBJ mesh builders for 3D and flat figures, with tests
- [x] OBJ captures on the folded export target per picture kind, with tests
- [x] Folded figures remember OBJ as their format
- [x] Affine/Depth unavailable reason, translated
- [x] Analytics doc
- [x] Lint, typecheck, relevant tests, i18n check
- [x] Browser check: export a spread 3D figure and a Default-spread flat figure
- [x] Blender check: the files import, and are not mirrored against the app
- [ ] Draft PR
