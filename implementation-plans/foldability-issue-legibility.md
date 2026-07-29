# Making foldability issues readable

## Goal

Three changes that all serve one thing — a foldability issue should be readable
without knowing Oriedita's internals:

1. **Signed fold-angle badges** (`-90°`, not `90°`), so the number teaches the
   colour rather than repeating what the colour already said.
2. **The marker glyph in the issue list**, left of each row, so the list and the
   canvas are visibly the same object.
3. **Oriedita's own error vocabulary** — "Not enough mountain folds", not
   "Flat-foldability violation: Maekawa".

They are one change, not three, because 2 and 3 depend on each other. See below.

## Part 1 — Signed angles

`CpFoldAngleLayer` reads `creaseFoldMagnitudeDegrees` (always `|ρ|`) and prints
it. The sign is already known — it lives in the colour, and
`creaseFoldAngle` already returns it — so this is a one-call swap.

Worth doing because it makes the badge and the colour **redundant channels for
the same fact**, which is what lets someone learn the colour. A red crease
reading `-90°` teaches "red is negative" for free; `90°` on both a red and a blue
crease teaches nothing and quietly implies they are the same fold.

`planFoldAngleBadges` only ever uses `degrees` as a payload — every threshold in
it is screen length — so a negative value cannot disturb layout or the dot/number
decision. Confirmed by reading, and pinned by a test rather than left to trust.

## Part 2 and 3 — The issue list

### Why these are one change

Oriedita's error vocabulary is **shape + colour**, and the phrase is only the
colour half:

> **Triangles**: incorrect (odd) number of folds
> 🔺 Not enough mountain folds  🔺 Not enough valley folds  🔺 Too many or not enough edge lines
>
> **Squares**: incorrect fold types
> 🟥 Not enough mountain folds  🟦 Not enough valley folds  ⬜ Equal amount of mountain and valley folds  🟪 Invalid configuration of edge lines
>
> **Circles**: incorrect angles (Kawasaki's theorem)
> Solid: like squares, but with incorrect angles …  Empty: only incorrect angles

"Not enough mountain folds" appears under three different shapes meaning three
different things. Adopting the phrases *without* the glyph would replace one
ambiguity with another — so the glyph is not decoration here, it is the half of
the sentence the text does not carry.

### The join already exists

`cpDiagnosticMarkerStyle` in `cp-workspace/diagnostics/geometry.ts` already maps
`(rule, violation_color) → (shape, tone)` for the canvas markers. The message
table is the *same join* with a different codomain, so it belongs beside it and
must read from the same entry fields. The list glyph then renders from
`cpDiagnosticMarkerStyle` directly — the canvas and the list cannot disagree,
because there is one function.

### Reachability, checked against the kernel

The table has to cover what `find_flat_foldability_violation` actually emits, not
what the legend implies. Reading `checks.rs`, Oriedita's legend turns out to be
exactly the reachable set:

| rule | reachable colours | why |
| --- | --- | --- |
| `NumberOfFolds` | `Unknown` | `black != 0 && black != 2` — the edge-line case |
| `NumberOfFolds` | `NotEnoughMountain` / `NotEnoughValley` | odd crease count; parity forces `\|red-blue\|` odd, so never `Equal` |
| `Maekawa` | `NotEnoughMountain` / `NotEnoughValley` / `Equal` | `maekawa_color(red, blue)` |
| `Maekawa` | `Unknown` | degree-2 collinear M-against-V, and every border-side failure |
| `Angles` | `…Mountain` / `…Valley` / `Equal` | `\|red-blue\| != 2` path recolours |
| `Angles` | `Correct` | `\|red-blue\| == 2`, angles alone are wrong — the hollow ring |
| `LittleBigLittle` | `Correct` (constructor pins it) | only survives when `\|red-blue\| == 2` |

`Angles + Unknown` is unreachable — the caller always recomputes the colour — but
the table still answers it, because an unreachable-today branch is a silent
`undefined` tomorrow.

### The phrasing rule

> **`[what the shape says —] what the colour says`**, in Oriedita's words,
> including the shape's half only when it is an independent fact.

- Triangle → `Odd number of folds — not enough mountain folds`
- Square → `Not enough mountain folds` (the shape's "incorrect fold types" *is*
  the colour's fact; repeating it would be noise)
- Solid circle → `Incorrect angles — not enough mountain folds`, which is the
  legend's own composition: "like squares, but with incorrect angles"
- Hollow circle → `Incorrect angles`

A row has to stand alone in a list with no legend visible, which is why the
triangle's "odd number of folds" moves into the text; on the canvas the legend
carries it. The glyph keeps a `title` naming its shape group, so the legend is
still reachable by hover.

`LittleBigLittle` has no legend entry, because Oriedita draws it as angular
sectors rather than a marker. It needs a phrase of our own.

### Where the text lives: frontend, not kernel

The message is built in Rust today (`lib.rs:2704`). Moving the *presentation* to
the frontend, and leaving the kernel's `message` untouched:

- The kernel emits raw English that never passes through i18n. Eight locales are
  gated in CI; a Rust string cannot satisfy that gate.
- The kernel already ships `rule` and `violation_color` structurally, which is
  the honest interface — it says what it found and lets the UI say it in the
  user's language.
- Tests, the CLI, and the oracle read `message`. Not touching it keeps this
  change entirely additive.

Entries with no table hit (`SpatialClosure`, `Check1`, `Check2`) keep the kernel
message, which is already prose.

### The kind column goes

The row currently reads `Maekawa/LBL   Flat-foldability violation: Maekawa` —
the same word twice, and both esoteric. With the glyph carrying the rule and the
HUD header already naming the check ("1 Foldability Error"), the kind chip is
pure redundancy. Row becomes `[glyph] [message]`.

## Affected Areas

- `apps/web/src/lib/foldAngle.ts` — signed formatting
- `apps/web/src/cp-workspace/foldAngle/{CpFoldAngleLayer.tsx,foldAngleBadges.ts}`
- `apps/web/src/cp-workspace/diagnostics/foldabilityMessages.ts` — new, the table
- `apps/web/src/cp-workspace/diagnostics/CpDiagnosticGlyph.tsx` — new, the glyph
- `apps/web/src/lib/oristudioCpDiagnostics.ts` — `cpDiagnosticEntryMessage`
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — row layout
- `apps/web/src/styles/theme.css` — glyph column, tone colours
- `apps/web/public/locales/*/panels.json` — 8 locales

## Checklist

- [x] Badges show the signed angle
- [x] Test that badge planning is unaffected by sign
- [x] An unfolded mountain formats as `0°`, not `-0°`
- [x] `foldabilityMessages.ts` covering every reachable `(rule, colour)` pair
- [x] Exhaustiveness test driven off the kernel's own enums
- [x] Unmatched entries fall through to the kernel message
- [x] `CpDiagnosticGlyph` rendering from `cpDiagnosticMarkerStyle`
- [x] Glyph tone reads the same CSS tokens as the canvas markers — the magenta
      "unknown" tone was hardcoded in the marker builder and is now the shared
      `--diagnostic-unknown`
- [x] Glyph `title` names the shape group
- [x] Row is `[glyph] [message]`; kind chip removed
- [x] i18n across 8 locales, `i18n:check` green

### Found while verifying

The collapsed HUD subtitle was still rendering the kernel's summary string,
which read **"Check CAMV found 2 issue(s)"** — a survivor of the CAMV rename, and
raw English that never passed through i18n. It also only ever restated the count
already in the label above it. It now shows the first issue by name, which is
localised and worth reading.

`apps/web/src/lib/oristudioCpDiagnostics.ts` is deleted: `cpDiagnosticEntryMessage`
moved next to the table, `semanticCpDiagnosticKind` went with the kind chip, and
`semanticCpDiagnosticSummary` had no callers before this change.

### Verified in the browser

Driving a degree-4 all-mountain hub through `CheckCamv` produced two entries with
different `(rule, colour)` pairs, and the HUD rendered:

- magenta ▲ — "Too many or not enough edge lines"
- blue ● — "Incorrect angles — not enough valley folds"

The **signed badge could not be confirmed there**: the automated browser pane
suspends rAF, so the canvas stays 1×1, no camera publishes, and the overlay layer
never mounts. The kernel side was confirmed instead (`CreaseSetFoldAngle` writing
`900000000` units), and the rendered text is covered by component tests that stub
the camera.

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | The table drifts from the kernel's enums as rules are added | Test enumerates every `(rule, colour)` pair and asserts a phrase exists; a new kernel rule fails it |
| R2 | Glyph and canvas marker diverge | Both call `cpDiagnosticMarkerStyle`; the glyph has no shape logic of its own |
| R3 | Two rows read identically (triangle-red vs square-red both "not enough mountain folds") | Deliberate — it is Oriedita's own vocabulary, and the glyph is the disambiguator, which is why parts 2 and 3 ship together |
| R4 | Signed angles break badge layout | Every `planFoldAngleBadges` threshold is screen length; pinned by test |
| R5 | Reading the legend from a screenshot rather than source | The vendored Oriedita predates the tooltip (`cAMVAction=` is empty), so the phrases are transcribed from the running app. The one truncated line (`Empty: only incorrect angles, everything else is …`) is not transcribed — the hollow-ring phrase is shortened to "Incorrect angles", which the code independently confirms (`Correct` means M/V counts are fine) |

## Out of scope

- `SpatialClosure` and `Rigid` entries keep the generic glyph. They are this
  branch's own check, not Oriedita's, and giving them a distinct shape is a
  separate decision about extending the marker vocabulary.
- `Check3`'s "Invalid vertex flat-foldability marker" is a different command and
  is left alone.
