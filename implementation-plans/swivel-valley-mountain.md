# Swivel by its valley and mountain

## Goal

Make the Swivel tool's second construction the swivel as folders diagram it.
On the layer you see, the flap is bounded by a valley and a mountain that meet
at a point on a folded edge; the crease on the layer behind follows from
squashing the flap down. The folder picks those two lines, each with the
normal line modes, and the tool computes and previews the third, dotted where
it is hidden. It replaces "Two fold lines" ("first line", "second line": one
crease per layer, the layer guessed), which solved a different swivel than
the one picked and then folded the other direction without a word.

Never fold another direction or kind than the one asked, anywhere in the
swivel: a way that does not land is refused, and the refusal offers the other
way when that one lands.

## Approach

- **Engine** (`compound::swivel_valley_mountain`): the two model lines and the
  kind, no direction. They meet at V on the folded edge the viewer sees; the
  pair is on that edge's face in front (no layer guess), the crease behind on
  the other. The kind says which named line is the front layer's hinge (open:
  the valley; inside: the mountain); the other is `c`, the half of the folded
  edge that opens is the one `c` lies nearer, and the crease behind is
  `s = b − c` (material continuity, `R_s R_h R_c = R_b`). The shared
  folded-swivel compiler scores and lands it, with its order and validity
  gates. The analysis splits the crease behind where the front layer hides it.
  Refusals: `swivel_line_meeting`, `swivel_no_flap`, the fan's, `no_order`
  (no other direction to offer).
- **Bridge**: `{ kind: 'swivel', via: 'valley-mountain', valley, mountain,
  swivel?: 'inside' }`, each line a `FoldLocatedLine`; answer kind
  `swivel-valley-mountain`; `kinds` in the valley column. The `creases` and
  `lines` forms, and `SwivelByCreases`, are removed: no saved file used them
  (the construction was never released).
- **Tool**: Construct by → Valley and mountain. "Valley line: …" then
  "Mountain line: …", each the line mode's own clicks, the select named by
  the line it locates; Enter (or Use as the valley) takes the valley; the two
  lines drawn in their pens as they are located; the preview draws the crease
  behind dotted; no direction.
- **Where the lines meet**: the valley is often constructed (an axiom), so V
  is seldom a landmark, and the engine meets the two lines only on a folded
  edge, within its tolerance. Once the valley is taken, its crossings with the
  folded edges the viewer sees are dotted on the folded pane, and a click near
  one takes that exact point for the mountain's line
  (`canvas/vertex/swivelMeeting`).
- **Kind from the first pick**: the kind is part of what the folder asks for,
  as a diagram names it ("inside swivel"), and the analysis depends on it:
  asked open, an inside pair is refused before the engine can say which kinds
  land. So Kind is offered from the first pick, kept through the valley taken,
  another line mode and Esc, and disabled only for a kind the engine has said
  does not land.
- **No silent switch**: `vertexChosenOp` folds the way and kind asked;
  `directionToFold`, `swivelWayToFold` and the reach's "the other way when the
  folder's does not land" are gone. The direction and kind controls are shown
  when the other way or kind lands, the asked one disabled when it does not.
  Repeat refuses a swivel by its valley and mountain across a turn over
  (`repeat_swivel_behind`): its pair would lie behind.

## Affected Areas

- `crates/oristudio-fold` (the construction, refusals, `SwivelCrease.hidden`)
  and `crates/oristudio-fold-wasm` (the op, the answer, the ways).
- `apps/web/src/fold`: the document op and file, tool state and window, vertex
  step, reach, canvas verbs, preview, overlays, Repeat, sentences and words;
  the Diagram's sentence; analytics (`swivel_form: valley_mountain`).
- Locales (8), `docs/analytics.md`.

## Checklist

- [x] Build the cases from the launch head: every saved swivel, its
      before-file, before and after pictures, an index; the dragon's step 34.
- [x] Engine construction, refusals and tests; the bridge op and tests;
      the old construction removed end to end.
- [x] Prove every saved swivel on a folded edge is made again by its valley
      and mountain (engine test over the classic cases, bridge test over the
      examples, harness over the owner's files: same fingerprint).
- [x] The tool: picks, previews, Kind, refusals; no direction switched or
      kind swapped for the folder, by either construction.
- [x] Words in all 8 locales; analytics enum and docs.
- [x] Where the lines meet: the valley's crossings with the folded edges
      dotted, and taken exactly for the mountain.
- [x] Kind offered from the first pick, and kept through the valley's locates.
- [x] Browser: three cases through the real tool, the dragon's step 34 and
      Repeat among them, beside their after pictures (the open and inside
      kite swivels at their saved fingerprints; the dragon's swivel and its
      Repeat).

## Validation

- `cargo test -p oristudio-fold -p oristudio-fold-wasm`, `cargo clippy -D
  warnings`, `cargo fmt --check`.
- Vitest over `src/fold`, `src/diagram/fold`, `src/analytics`,
  `src/components/fold`; `tsc --noEmit`; `npm run lint:web`; `i18n:check`.

This supersedes the two-line workflow this file held before (first line,
second line), and the three-point authoring UI in
`fold-swivel-crease-input.md`; that plan's participating-paper guard fixes
remain.
