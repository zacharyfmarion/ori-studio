# Simulator view style options

## Goal

Let the user style the simulator's folded view — paper colours, crease colours,
crease weight, and how mountains and valleys are drawn — with every choice
honoured identically by all three renderers, and with the SVG/PNG export
following from that rather than being styled separately.

Two phases:

- **Phase 1 — colours and weight.** Paper front/back, mountain/valley/border,
  crease width, and a correct export page background. No shader changes. Also
  collapses the two independent palette resolutions that exist today, which is
  where a live divergence is hiding (see below).
- **Phase 2 — crease style.** A `color` / `mono` / `mono-dashed` axis, reusing
  Oriedita's dash patterns so the simulator and the CP editor dash identically.
  Hidden lines stay a separate axis on purpose.

Non-goals, and why: **lighting direction** (the `lighting` toggle already covers
the flat-vs-shaded decision that matters for diagramming, and direction is
fiddle for its own sake); **drop shadow** and **silhouette outline** (neither is
expressible in all three renderers — see the acceptance test — and the
silhouette is a union-boundary problem deserving its own plan); **per-crease
styling** (that is document state, not a view option); **hidden lines in the GPU
and SVG paths** (unchanged scope from
`implementation-plans/simulator-view-svg-export.md`).

## Approach

### The invariant every option has to preserve

There are three renderers of the folded view, and they must agree:

| renderer | when it draws | dashes |
| --- | --- | --- |
| `MeshRenderer` (GPU shaders) | what the user looks at, nearly always | needs shader work |
| `canvas2dFrame` | no WebGL2, **and every fold-profile / segment simulation** | `setLineDash`, free |
| `svgRenderer` | the export | `stroke-dasharray`, free |

The SVG export rests on one invariant — *the file is the view on screen* — and it
holds only because both sides consume the same `RenderSettings`. So the
acceptance test for any style option is: **can all three express it, from
`RenderSettings`?** An option that fails diverges silently; nothing catches it.

That test is what put shadows and silhouettes in the non-goals, and it is why
every option below lands on `RenderSettings` rather than being read
independently by each renderer.

### The divergence to fix first

There are currently **two independent palette resolutions**, and they disagree:

| | mountain | valley |
| --- | --- | --- |
| `toRenderSettings` → GPU + SVG | `#db1f24` (red) | `#1c5cd9` (blue) |
| `readSimulatorPalette` → canvas-2D | `#e06c75` (`--status-danger`) | `#5fb3a5` (`--accent-primary`, **teal**) |

So on the canvas-2D path valleys are drawn teal, not blue. That is not a
hypothetical fallback: a fold profile forces that path even on a GPU machine, so
every segment and sequence-step simulation draws its valleys the wrong colour
today.

Adding user colours on top of two resolutions would double the bug. Phase 1
collapses them into one resolver first, which is most of its value independent of
the new controls.

### Phase 1 — colours and weight

**1. Settings.** `SimulatorSettings` gains flat keys, grouped the way
`SIMULATOR_MATERIAL_KEYS` already groups material:

```ts
paperFront: string | null;      // null = follow the theme token
paperBack: string | null;
mountainColor: string | null;   // null = the origami-convention default
valleyColor: string | null;
borderColor: string | null;
creaseWidth: number;            // device px, into RenderSettings.creaseWidthPx
exportBackground: 'transparent' | 'white' | 'theme';
```

Plus `SIMULATOR_STYLE_KEYS` for a "Reset style" action mirroring
`resetSimulatorMaterial`.

`null` rather than a concrete default matters: paper is a theme token
(`--sim-paper-front`/`--sim-paper-back`), and baking a hex into the defaults
would silently freeze the paper the first time the settings are persisted, so
switching theme would stop moving it. `null` means "whatever the theme says", and
it gives "Reset to theme" a real meaning. Mountain/valley/border resolve `null`
to the fixed origami-convention constants for the reason already documented in
`toRenderSettings` — they must stay high-contrast in both themes.

`normalizeSimulatorSettings` needs extending: its loop handles numbers, two
enums, and booleans, so nullable colour strings and a new enum fall through and
are dropped today. Validate colours as `#rrggbb` and reject anything else to
`null`, since these values come back from `localStorage`.

**2. One resolver.** New `apps/web/src/simulator/simulatorPalette.ts`:

```ts
resolveRenderSettings(styles: CSSStyleDeclaration, settings, surface): RenderSettings
resolveSimulatorChrome(styles: CSSStyleDeclaration): SimulatorChrome
```

`RenderSettings` is the shared contract, so the GPU path, the SVG exporter and
`canvas2dFrame` all take the first one. `SimulatorChrome` carries only what the
canvas-2D path draws and the others do not — sequence highlights, the
unassigned/facet ink, the surface fill — so that path stops resolving anything
colour-related itself. `toRenderSettings` becomes a thin re-export from
`canvas2dFrame` for its existing callers, or moves outright.

This is the `simulatorPaint.ts` extraction the SVG-export plan proposed and then
dropped. It was correctly dropped then — the worker gets colours from
`RenderSettings`, so nothing needed extracting. It comes back now for a
different reason: the *resolution* is duplicated, and user overrides are about to
make that expensive.

**3. Export page background.** `exportSvg` currently hardcodes `background:
true`, which fills the page with `settings.background` — the app's `--bg-canvas`,
which ranges from `#0c0f12` (One Dark) to `#ffffff` (GitHub Light) across
presets. **Exporting from a dark theme today produces a diagram on a near-black
rectangle.** The crease export flow already settled this question and says why:
exports default to light "whatever the app theme is", because that is what
prints and embeds.

Fix: `exportSvg({ token, background })` takes the mode, defaulting to
`transparent`. Transparent composites into anything and sidesteps the light/dark
question entirely; `backgroundAlpha: 0` already exists and is tested. This is an
export concern, not a property of the on-screen view, so it stays a parameter of
the export call rather than joining `RenderSettings` — the on-screen render keeps
painting the theme background, or the panel would look broken.

**4. UI.** `SimulatorViewControlsPanel` gains two groups under Render: **Paper**
(front, back) and **Creases** (mountain, valley, border, width), plus Reset
style. `input type="color"` inside a `<label>` is the established pattern —
`folded-figure-menu__color` in `CreasePatternPanel` and `export-modal__color` in
`CreaseExportDialog` are the same ten lines with different CSS. This would be the
third copy, so extract `components/ui/ColorField.tsx` and adopt it in all three.

Inline simulation windows need no new UI: they already share the app-wide
settings, and the `colorMode` comment on `InlineSimulationInspector` records why —
"two places to set it that disagree would be worse than one that follows you".

### Phase 2 — crease style

**1. The style enum never reaches a renderer.** `creaseStyle: 'color' | 'mono' |
'mono-dashed'` lives in `SimulatorSettings`; the resolver flattens it into
concrete per-assignment colours (already in `RenderSettings`) plus dash patterns:

```ts
// RenderSettings gains exactly this:
creaseDash: {
  mountain: readonly number[] | null;   // null = solid
  valley: readonly number[] | null;
  border: readonly number[] | null;
};
```

So `mono` is "the resolver sets all three colours to the mono ink" and
`mono-dashed` adds the dash arrays. Every renderer stays dumb — read a colour and
a dash per assignment — and all the style semantics sit in one pure function with
unit tests. That is what keeps three renderers from each interpreting an enum.

**2. Dash patterns are Oriedita's.** Reuse `ORIEDITA_DASH_ONE_DOT` (mountain
chain) and `ORIEDITA_DASH_VALLEY` from `lib/oristudioCpLineStyle.ts`, in device
pixels and *not* scaled by zoom — matching both upstream and the CP editor, so a
crease dashes the same in the simulator as in the pattern it came from.

Only three styles, not Oriedita's five: `black-one-dot` versus `black-two-dot`
earns its keep on a dense flat CP and does not here, and `color-and-shape`
collapses into `color` once the geometry is already showing you the fold
direction. Easy to add later.

Note the styles port but the *lookup* does not: `cpLineStyleInk` and
`cpLineStyleDashSlot` key on Oriedita `LineColor` names (`Red1`, `Blue2`,
`CYAN_3`) and the simulator has FOLD assignments (`B`/`M`/`V`/`F`). The resolver
maps assignment → style, so those functions are referenced for their table, not
called.

**3. Dashes in the shaders.** The only shader change in either phase, and the
only real risk. `EDGE_VERT` already computes `len = length(dirPx)`, the edge's
pixel length, so:

- vertex shader: emit a varying for distance-along-edge (0 at the A-end
  vertices, `len` at the B-end), which interpolates exactly across a straight
  two-triangle ribbon;
- fragment shader: modulo that against the pattern (a small uniform float array
  plus a run count — one-dot is four runs, valley is two) and `discard` in the
  gaps, which correctly leaves the face behind showing through and writes no
  depth.

**4. Hidden lines stay orthogonal.** On a flat CP, dash is how you tell valley
from mountain. On a render of an already-folded form the usual convention is the
other one: solid means visible, dashed means hidden behind a layer. Merging the
two axes into a single "style" enum would make a dashed line mean "valley" where
a reader expects "behind something".

So they stay separate, and when a dashed style is active, hidden lines
differentiate by **weight and opacity** rather than by dash. In practice this is
a rule about not introducing the collision rather than new code: hidden lines
exist only on the canvas-2D path, which is where the rule gets enforced.

Worth saying plainly why offering M/V dashes at all is still right, given that
argument: the simulator spends a lot of time near 0% fold, where the model is
nearly flat and the dashes *are* the CP convention the user just came from. The
usefulness decays as the fold closes; it does not vanish.

## Affected Areas

| File | Change |
| --- | --- |
| `apps/web/src/lib/simulatorSettings.ts` | style keys, `SIMULATOR_STYLE_KEYS`, nullable-colour + enum normalization |
| `apps/web/src/lib/simulatorSettings.test.ts` | normalization of untrusted persisted colours |
| `apps/web/src/simulator/simulatorPalette.ts` | **new** — the single resolver (P1) + style flattening (P2) |
| `apps/web/src/simulator/simulatorPalette.test.ts` | **new** — override-vs-theme, and the style → colours/dash table |
| `apps/web/src/simulator/canvas2dFrame.ts` | consume `RenderSettings` + `SimulatorChrome`; drop its own M/V resolution; honour dash |
| `apps/web/src/simulator/canvas2dFrame.test.ts` | extend; pin that all three paths agree on M/V |
| `packages/origami-simulator/src/webgl/meshRenderer.ts` | `creaseDash` on `RenderSettings`; edge shader dashing (P2) |
| `packages/origami-simulator/src/svgRenderer.ts` | `stroke-dasharray` from `creaseDash` |
| `packages/origami-simulator/tests/svgRenderer.test.ts` | dash emission per assignment |
| `apps/web/src/simulator/simulatorSession.ts` | `exportSvg({ background })` |
| `apps/web/src/simulator/simulatorSession.test.ts` | export background modes |
| `apps/web/src/simulator/useSimulatorRuntime.ts` | thread the background mode |
| `apps/web/src/components/ui/ColorField.tsx` | **new** — adopted by the two existing call sites too |
| `apps/web/src/components/panels/SimulatorViewControlsPanel.tsx` | Paper + Creases groups, style select, Reset style |
| `apps/web/src/components/panels/SimulatorViewControlsPanel.test.tsx` | controls drive the store |
| `apps/web/src/store/workspaceStore/slices/simulatorSlice.ts` | `resetSimulatorStyle` |
| `apps/web/src/components/panels/CreasePatternPanel.tsx`, `components/CreaseExportDialog.tsx` | adopt `ColorField` |
| `apps/web/public/locales/*` | new `panels:` keys, 8 locales |

## Checklist

### Phase 1 — colours and weight

- [ ] Style keys + `SIMULATOR_STYLE_KEYS` on `SimulatorSettings`; normalization
      rejects a non-`#rrggbb` persisted colour to `null`
- [ ] `simulatorPalette.ts`: one `resolveRenderSettings`, plus
      `SimulatorChrome` for the canvas-2D-only inks
- [ ] `canvas2dFrame` consumes it and no longer resolves colours itself; a test
      pins that the CPU path and `RenderSettings` agree on mountain and valley
      (they do not today — valleys are teal there)
- [ ] `null` follows the theme, a hex overrides it, and switching theme still
      moves an unset colour
- [ ] `creaseWidth` reaches `RenderSettings.creaseWidthPx`
- [ ] `exportSvg({ background })`, defaulting to transparent; a dark theme no
      longer exports a near-black page
- [ ] `ColorField` primitive, adopted by the folded-figure menu and the export
      dialog as well as the new pane
- [ ] Paper + Creases groups and Reset style in `SimulatorViewControlsPanel`
- [ ] i18n: extract, translate 8 locales, `npm --workspace @treemaker/web run
      i18n:stamp`, check

### Phase 2 — crease style

- [ ] `creaseStyle` in settings; resolver flattens it to colours + `creaseDash`
      so no renderer ever sees the enum, with a unit test per style
- [ ] `creaseDash` on `RenderSettings`; SVG emits `stroke-dasharray`; canvas-2D
      uses `setLineDash`
- [ ] Edge-shader dashing: distance-along-edge varying, uniform pattern array,
      `discard` in the gaps
- [ ] Dash patterns are Oriedita's own values, in device px, unscaled by zoom —
      a crease dashes identically here and in the CP editor
- [ ] Hidden lines differentiate by weight/opacity, never by dash, while a
      dashed style is active
- [ ] Style select in the pane

### Validation

- [ ] `npm run build --workspace @treemaker/origami-simulator` + package vitest
- [ ] `npx tsc --noEmit`, web vitest, `npm run lint:web`, `npm run i18n:check`
      (note: `i18n:stamp` is workspace-only — the root does not forward it)
- [ ] Browser, Phase 1: a colour override reaches the GPU view, the export, and
      a fold-profile simulation (the canvas-2D path) identically; export from a
      dark theme has a transparent page
- [ ] Browser, Phase 2: dashes match the CP editor's at the same zoom; dashed
      creases still read correctly against `showHiddenLines`; the shader
      `discard` leaves no depth artifacts on a dense model
