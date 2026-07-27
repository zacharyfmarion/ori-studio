# Oriedita Line Styles

## Goal

Make Ori Studio's **Line style** view option behave like Oriedita's
`LineStyle` enum. Today the option exists end to end as *state* — the enum,
the Select in the CP view-controls panel, persistence in the project slice,
i18n labels — but nothing on the crease-pattern edit surface ever reads it, so
picking "Black one-dot" (or any style but "Color") changes nothing on screen.
The SVG/PNG export path does read it, but with invented dash patterns and an
invented black-and-white rule.

Port the real behaviour from the vendored upstream:

- `third_party/oriedita/oriedita-common/.../canvas/LineStyle.java` — the enum.
- `third_party/oriedita/oriedita-ui/.../drawing/tools/DrawingUtil.java`
  (`drawCpLine`, `setColor`) — the per-style stroke colour and dash pattern.
- `third_party/oriedita/oriedita/.../canvas/impl/CreasePattern_Worker_Impl.java`
  — the draw loop that sets the graphics colour to black before the CP pass
  (this is why the two "black" styles paint black) and that routes `CYAN_3`
  auxiliary lines to `drawAuxLine`, which the line style never touches.
- `third_party/oriedita/oriedita/.../export/SvgExporter.java` — the same rules
  restated for export, and the source of the `#A2A2A2` grey.

### The ported table

For a crease with `LineColor c` under `LineStyle s` (aux `Cyan3` creases are
drawn by `drawAuxLine` and keep their own colour, solid, under every style):

| Style | Stroke | Dash (device px) |
| --- | --- | --- |
| `color` | `c` | solid |
| `black-white` | `Black0`/`Red1` → black, `Blue2` → grey `#A2A2A2`, else `c` | solid |
| `color-and-shape` | `c` | `Red1` → `10 3 3 3`, `Blue2` → `8 8`, else solid |
| `black-one-dot` | black | `Red1` → `10 3 3 3`, `Blue2` → `8 8`, else solid |
| `black-two-dot` | black | `Red1` → `10 3 3 3 3 3`, `Blue2` → `8 8`, else solid |

## Approach

**Rules module.** A new `cp-workspace/adapters/cpLineStyle.ts` owns the table
above as pure functions (`cpLineStyleInk`, `cpLineStyleDashSlot`,
`cpLineStyleDashPatterns`) plus a thin DOM-reading resolver that turns a line
colour into `{ color, dashSlot }` for the scene builders. Dash patterns are
addressed by *slot*: slot 0 is solid, slot 1 is the mountain (chain) pattern,
slot 2 is the valley (dashed) pattern — at most two non-solid patterns are ever
live, because that is all Oriedita defines per style.

**Renderer.** The stroke program currently supports a single whole-geometry
`dashed: boolean` with hardcoded on/off constants (measure guides, operation
frame). Generalise that one mechanism instead of adding a second: `StrokeGeometry`
carries `dashPatterns` (the slot table, in CSS px) and an optional per-segment
`dashSlot` buffer; the shader resolves the slot to its runs in the vertex stage
(so the fragment stage needs no dynamic uniform-array indexing) and discards
fragments in a gap. Uniform-dash geometry keeps working by supplying a
one-entry table and no slot buffer.

**Scene builders.** `cpSnapshotToScene`, `cpGeometryStrokesToScene`, and the
transform-ghost snapshotters take an appearance resolver instead of a bare
colour resolver, and emit the per-segment slot buffer. Selected creases stay
solid: our selection recolours the crease rather than drawing Oriedita's green
underlay beneath it, so a dashed selection would read as broken geometry.

**Export.** `creaseExport.ts` replaces its invented patterns with the ported
table (its FOLD assignments map `M`→`Red1`, `V`→`Blue2`, `B`→`Black0`,
`F`→ auxiliary), sharing the dash constants with the canvas.

**Theme.** The ink reuses `--fold-border`, which themes already derive from
`text.primary`. The grey cannot be Oriedita's literal `#A2A2A2` for the same
reason: against a dark theme's near-white ink it would read as a second ink, not
a muted one. `#A2A2A2` *is* Oriedita's black washed out over white paper (black
at 36.5%), so themes derive `--fold-monochrome-valley` by mixing their own ink
toward their own canvas at that ratio — same relationship, any theme.

## Affected Areas

- `apps/web/src/cp-workspace/adapters/cpLineStyle.ts` (new)
- `apps/web/src/cp-workspace/adapters/cpSnapshotToScene.ts`
- `apps/web/src/cp-workspace/adapters/cpGeometryToScene.ts`
- `apps/web/src/cp-workspace/tools/transformGhost.ts`
- `apps/web/src/cp-workspace/renderer/types.ts`
- `apps/web/src/cp-workspace/renderer/programs/strokeProgram.ts`
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx`
- `apps/web/src/components/panels/CreasePatternPanel.tsx`
- `apps/web/src/lib/creaseExport.ts`
- `apps/web/src/lib/creasePatternViewport.ts` (drop a dead label map)
- `apps/web/src/lib/oristudioCpLineStyle.ts` (new — the ported rules)
- `apps/web/src/lib/rgbColor.ts`
- `apps/web/src/themes/applyTheme.ts`
- `apps/web/src/styles/theme.css`

## Checklist

- [x] Read the upstream `LineStyle`, `drawCpLine`, worker draw loop, and exporter
- [x] Add `cpLineStyle.ts` with the ported table + unit tests
- [x] Generalise stroke dashing to a slot table + per-segment slots
- [x] Emit slots from both scene builders and the transform ghost
- [x] Thread the active line style through the canvas from the view options
- [x] Make the export path use the same ported table
- [x] Derive the monochrome-valley grey per theme
- [x] Remove the dead `ORISTUDIO_CP_LINE_STYLE_LABELS` map
- [x] `npm run lint:web`, `typecheck`, `npm run test:web`
