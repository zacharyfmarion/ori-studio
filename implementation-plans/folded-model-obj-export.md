# Folded model OBJ export

## Goal

Offer **OBJ** next to SVG and PNG in a folded model's export dialog — the one
the floating toolbar's Export opens on a selected figure in Edit. The file is
the folded paper in 3D, so a model whose layers are lifted apart imports into
Blender (or any 3D tool) apart too. For a flat figure the dialog sets the
spread itself, with a 3D preview: in Zach's words, "basically the 3d
perspective spread option ... but we are exporting to obj". The simulator's
OBJ (`implementation-plans/simulator-obj-uv-export.md`) is the pattern: one
`.obj` with vertices, unfolded-sheet UVs and triangles, written by the same
serializer (`lib/foldedExport.ts::foldedObj`).

Fold's step export was given OBJ for a while and had it taken out again
(Zach: "remove it from fold"); only folded figures offer it.

## Approach

### What the mesh is, per picture kind

| Picture | OBJ |
| --- | --- |
| `live-3d` | The render model's material source (`model.material`): welded sheet vertices, their folded positions, the faces. With a spatial spread (`spatialAmount(figure) > 0`), every vertex is moved by the solve's displacement at the figure's amount — the field the window draws. No spread control in the dialog yet. |
| `flat`, `spread` | The kernel's paper scene, flat, or lifted by the Default spread the dialog sets (below). |
| `fixed`, flat figure | The same, from the paper scene its opener finds (`foldedFigureObjScene.ts`): a live fold's own, the scene a spread figure's file carried, or — for a figure reopened from its file, the user's case — the figure folded again on a throwaway handle, checked against the picture it shows, read and let go. The SVG and PNG stay the saved picture. |
| `stored-3d` | No OBJ: no fold to read a mesh from. |

### The spread, in the dialog

- **Rows.** With OBJ chosen, the options show Spread layers and, while on,
  Default's Amount (`LayerSpreadRows` with `kindVisible={false}` and no
  reveal pad): Default is the one spread with a 3D form, and the preview turns
  the paper instead of shearing it. They open on the figure's own Default
  spread, else off at Default's starting amount; an Affine or Depth figure no
  longer blocks OBJ. Like every option of the dialog it is a draft: the
  figure's own spread is never written.
- **Preview.** The page image gives way to the paper in 3D: the Diagram's
  Perspective 3D drawing (`useSpreadRenderer` with a `perspective`
  presentation) in the simulator's viewport, turned by dragging, with a view
  cube. The fold is prepared the first time OBJ is chosen — read, folded
  again, solved — and says so while it is, and why when it cannot be.
- **The file is what the preview draws.** Perspective 3D lifts a Default
  spread at twice its stored amount, with no reveal (`perspectiveSpread`,
  now shared by `foldedFlatScene.ts` and the OBJ), so the same Amount lifts
  the file as far as the preview shows.
- **Reasons.** A reopened figure that cannot be folded again as drawn — its
  creases moved, its order set by hand, another solution — says
  `needs-refold`; a spread the solver cannot make says what every spread
  surface says, and the file can still be written flat.

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
  softly and reports what it could not (`max_crossing`); the canvas and the 3D
  preview draw through that by layer rank, the file carries the geometry. On
  the kabuto, the two layers of a horn cross by 0.0002 of the sheet (0.2% at
  64% Amount), so a 3D tool shows the lower one through the upper one there.
- **Size and place.** The unfolded sheet's longer side is 1, and the mesh is
  centred on its bounding box.
- **UVs** come from the unfolded sheet through `sheetUvs`, the simulator's
  convention, one per vertex.
- Creases, aux lines and colours are not written, as the simulator's OBJ does
  not write them.

### Where it lives

- `cp-workspace/folded/foldedFigureObj.ts`: the pure mesh builders and the
  `PaperObjExport` captures; a flat figure's carries a spread source
  (`PaperObjExport.spread`: its starting spread, the scene, the solve).
- `cp-workspace/folded/foldedFigureObjScene.ts`: a fixed picture's paper scene,
  folding a reopened figure again.
- `folded3dMaterial.ts` / `folded3dSpread.ts`: the spread posing and the solve
  lease, shared with the window instead of copied.
- `foldedFigureExportTarget.ts` / `openFoldedFigureExport.ts`: attach `obj` per
  picture kind.
- `paperExport/usePaperObjSpread.ts`, `objSpreadRows.ts`: the dialog's spread
  draft, its preparation and its rows; `components/paperExport/ObjSpreadPreview`:
  the 3D preview.
- `layer-spread/presentation.ts`: `perspectiveSpread`.
- `lib/paperExportSettings.ts`: a folded figure remembers OBJ as its format.
- `saveObjExport.ts` + catalogs: the reasons, the preview's caption.

Analytics: `paper exported` carries `format: obj` and the folded surfaces, and
`obj_spread` (`spread` / `flat`) for a figure whose spread the dialog set.

## Affected Areas

- `apps/web/src/cp-workspace/folded/` (OBJ builders and captures, the fixed
  picture's scene, export target, spatial material and spread modules, tests)
- `apps/web/src/paperExport/` (target contract, the spread draft and rows, save)
- `apps/web/src/components/paperExport/` (3D preview, options, modal)
- `apps/web/src/components/paper/LayerSpreadRows.tsx` (`kindVisible`)
- `apps/web/src/layer-spread/presentation.ts`, `cp-workspace/folded/foldedFlatScene.ts`
- `apps/web/src/lib/foldedExport.ts`, `apps/web/src/lib/paperExportSettings.ts`
- `apps/web/src/analytics/trackPaperExport.ts`
- `apps/web/public/locales/*/dialogs.json`
- `docs/analytics.md`

## Checklist

- [x] Share the spatial posing and solve lease between the window and the export
- [x] Pure OBJ mesh builders for 3D and flat figures, with tests
- [x] OBJ captures on the folded export target per picture kind, with tests
- [x] Folded figures remember OBJ as their format
- [x] Analytics doc
- [x] Lint, typecheck, relevant tests, i18n check
- [x] Browser check: export a spread 3D figure and a Default-spread flat figure
- [x] Blender check: the files import, and are not mirrored against the app
- [x] Draft PR
- [x] OBJ taken out of Fold's step export again
- [x] The dialog's spread for a flat figure: rows, draft, 3D preview, file lifted as previewed
- [x] OBJ for a fixed picture: a reopened figure folded again as drawn, or a reason
- [x] Browser check from the floating toolbar: live and reopened kabuto, byte-identical files
- [ ] A spread control for 3D figures (spatial spread), if wanted
