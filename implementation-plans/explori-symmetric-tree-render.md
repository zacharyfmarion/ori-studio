# ExplOri results: draw a symmetric tree symmetrically

## Goal

A result card shows the tiling's tree beside its crease pattern so the match can
be judged against the tree you drew. Today that tree is laid out radially from
its most-connected node, which ignores the one thing most results have: a
mirror. Every tiling from a `book` or `diag` database is symmetric, so its tree
carries a length-preserving involution — and the radial layout scatters the two
halves of each pair to unrelated angles, so a symmetric result reads as an
arbitrary bush. Someone who drew a mirrored tree and searched only the symmetric
archives gets back seven drawings none of which look like the thing they asked
for.

After this plan:

- A result tree whose lengths admit a mirror is drawn **about a vertical axis**,
  the same axis the tree editor mirrors across: paired subtrees are exact
  reflections of each other, self-mirrored nodes sit on the line, and the line
  is drawn.
- A tree whose mirror has *too many* self-mirrored branches to fit on one line —
  which is most of the largest database, see below — is drawn as close to that
  as a plane allows, and the compromise is a rule rather than an accident.
- Results are oriented consistently with each other and, when the drawn tree is
  itself symmetric, with it.
- None of the testing touches `225.designorigami.net`. The local tiling
  databases on this machine supply every fixture, the dev server can answer
  searches from them, and the layout is checked against all 6,451 local trees.

Out of scope, deliberately: changing the crease-pattern thumbnail, node-level
hover linking between the drawn tree and a result, and any change to what is
saved.

## Context

### What a result tree is

Upstream builds it in `Fold225.get_tree_and_packing` (`src/engine/fold225.py`
in the `theplantpsychologist/SEARCH-22.5` checkout at
`~/Documents/code/explori-latest`): it sweeps the *folded form* along the base's
axis, and every cluster of hinge creases at one axial position becomes a node,
every strip between two hinge positions becomes an edge whose `length` is the
axial span. So it is a uniaxial-base tree — the same object a TreeMaker tree is —
and each node has a natural 1-D coordinate, `h_val`, which the serializer
(`interface/serialization.py`, `serialize_graph`) **drops**: the API sends bare
`{id}` nodes and `{u, v, length, weight, comp_id?}` edges, with no positions.
Degree-2 nodes are merged away (`merge_edges`), and merged edges lose their
`comp_id`. Nothing in the payload relates a tree node to the crease pattern or to
the query; `heat` is a spectral CDF of the whole tree, and `comp_map` (single-
tiling endpoint only) maps strips to crease-pattern faces, not to anything of
ours.

Our parser (`explori/exploriService.ts`, `parseGraph`) keeps ids, edges and
lengths. That is all the layout gets, and it is enough: the lengths are exact
ℚ(√2) values converted once, so mirror-image strips have **bit-identical**
lengths.

### The local tilings, and what they say

Zach has the archive's own SQLite files for six of the thirteen databases:

| file | where | tilings |
| --- | --- | --- |
| `tilings_2_book.db`, `tilings_2_diag.db`, `tilings_2_none.db`, `tilings_3_book.db`, `tilings_6_book.db` | `~/Documents/open source/origami-designer/explori_db/` | 18, 27, 81, 147, 4765 |
| `tilings_3_diag.db` | `~/Downloads/` | 1417 |

Schema: `tilings(id, topology_id, hashed_tiling, tiling_blob, embedding)`. The
`embedding` column is **the pickled networkx tree itself** (verified equal to
what `get_tree_and_packing` returns for `3_book` #1), so a tree corpus needs only
`pickle` and `networkx`; the full crease pattern, packing and fold need the
SEARCH-22.5 venv at `~/Documents/code/SEARCH-22.5/.venv` (compiled
`math225_core`, `py_straight_skeleton`), about one second per tiling. Four rows
are empty tilings; 6,451 trees remain.

A probe over all of them (`mirror_probe.py` / `excess_probe.py`, kept in the
session scratchpad, to be re-homed as the corpus script below) finds the metric
involution by maximal pairing of isomorphic sibling subtrees at the tree's
centre, then asks whether the *fixed* part of that involution is a path — the
condition for a strict mirror drawing where every self-mirrored node is on the
line:

| database | trees | strict, axis is a path | strict, two isomorphic halves (edge across the axis) | mirror exists but fixed part branches | no mirror at all |
| --- | --- | --- | --- | --- | --- |
| 2 book | 17 | 14 | 0 | 3 | 0 |
| 2 diag | 26 | 22 | 0 | 3 | 1 |
| 3 book | 146 | 127 | 16 | 3 | 0 |
| 3 diag | 1417 | 741 | 0 | 676 | 0 |
| 6 book | 4765 | 1074 | 30 | 3650 | 11 |
| 2 none | 80 | 33 | 0 | 39 | 8 |

Two things fall out of this that shape the design:

1. **Symmetric databases really do give symmetric trees.** 99.8% of `6 book`
   and 100% of `3 diag` trees carry a nontrivial length-preserving involution.
   The one `2 diag` exception is a three-leaf star with three different lengths.
2. **The fixed part usually branches.** In `6 book`, 3650 of 4765 trees have a
   node with more self-mirrored children than a line through it can hold — the
   body node of a base with a head, a neck flap and a tail all on the paper's
   symmetry line, say. The excess is mostly single flaps: 8154 leaves against
   3549 larger subtrees, and 1021 trees have exactly one, 968 two, 718 three.
   Any design that only handles the path case draws 77% of the biggest database
   asymmetrically. This is the central edge case, not a corner.

Two more findings, recorded so nobody re-derives them:

- The crease pattern's own mirror is **not** a usable reference for the tree.
  For `book` tilings it is the horizontal midline for some and the vertical for
  others; and once hinge creases are added, an exact reflection test on the
  vertex set fails for about half the `book` patterns sampled (17 of 30 in
  `3 book`, 10 of 12 in `6 book`). Detecting it tolerantly is its own project.
- Upstream's client has since grown a radial layout of its own
  (`interface/static/js/renderers.js`, `computeRadialTreeLayout`): root at the
  max-degree node, wedges by leaf count, non-root spread capped at 180°. Our
  `renderers.tsx` header still says upstream stacks every node on the origin;
  that comment predates this and needs correcting either way.

## Approach

### D1 — One layout, not a symmetric layout plus a fallback

The involution is found by **maximal pairing**: root the tree at its centre
(one or two vertices, by leaf stripping), compute a metric canonical form for
every rooted subtree (AHU-style, lengths quantized to a relative 1e-6 of the
longest edge), and at each node group the children by `(length, canonical form)`.
A class of size *k* yields ⌊k/2⌋ **pairs** and, when *k* is odd, one **fixed**
child, whose subtree is then treated the same way. This is the unique involution
that moves the most nodes, and pairing more never costs anything: the fixed
children are exactly the ones nobody could pair.

Because every tree has this decomposition — an asymmetric tree simply has no
pairs and every child fixed — a single placement rule serves symmetric, partly
symmetric and rigid trees alike, and the rigid case degrades to a deterministic
fan that looks like today's radial drawing. There is no second code path to
keep in step.

Placement is a **mirror fan**. Every node has an outgoing direction: the root's
axis runs up and down, and any other node points away from its parent. Around
that direction its children fan out in wedges proportional to their leaf counts
(the rule the current layout and upstream's both use), capped at 180° for a
non-root node so branches grow outward, and each child is placed at exactly its
edge's length along the centre of its wedge — lengths are the meaning of the
tree and are never rescaled. The fan is arranged so that:

- **pairs take mirrored wedges** on either side of the axis, and the right-hand
  member is the *reflection of the left-hand member's finished layout* under the
  node correspondence the canonical form gives — never an independent layout,
  so the two are exact reflections by construction;
- **fixed children take the wedges nearest the axis**, sorted by fixed-chain
  depth, then subtree size, then canonical key. The first continues the axis
  exactly (the root offers two such slots, up and down). Its wedge straddles the
  line, so its own fan is symmetric about the same line and the recursion keeps
  the whole drawing symmetric.

### D2 — Excess self-mirrored branches tilt; they never overlap and never break a pair

A second, third or fourth fixed child at the same node has nowhere on the line
to go: two strips of different length drawn along the same ray would put one
leaf's dot in the middle of the other's edge, which a reader takes for a node.
So it is drawn **tilted**: in the fan it books mirrored room on *both* sides of
the axis — as if it were a pair — occupies the wedge on one side (alternating,
first right), leaves the other empty, and lays out its subtree symmetric about
its own tilted direction. Pairs stay exact reflections because their wedges are
unaffected; the only asymmetry in the drawing is the tilted branch itself, which
the corpus says is a single flap eight times in ten.

This matches what designers do by hand: TreeMaker trees routinely draw a
self-mirrored flap off the line because the drawing is a schematic and the
symmetry lives in the packing. The alternatives were measured and rejected:
overlapping strips (unreadable, see above), falling back to the radial layout
for these trees (throws away the symmetry of 77% of `6 book`), and drawing the
extra flap on both sides (invents a flap).

### D3 — Two isomorphic halves are drawn across the axis

When the tree has two centres and the half hanging off each is the mirror image
of the other, the central edge is drawn horizontally *through* the axis, with
each half on its own side — the picture of a base whose spine crosses the paper's
mirror rather than lying along it (`3 book` has 16, `6 book` 30). Otherwise both
centres lie on the axis with a virtual root at the edge's midpoint, one fanning
up and one down. When both drawings are possible, take the one with fewer tilted
branches, tie to the crossing edge, which has none by construction.

### D4 — The axis is vertical, and it is the editor's

The tree editor's mirror is the y-axis (`EXPLORI_SYMMETRY_AXIS`), so every result
is drawn with a vertical mirror at the centre of its figure, and the figure's
bounds are made symmetric about that line so the axes of a whole grid of cards
line up. The crease-pattern thumbnail is left exactly as upstream draws it: its
axis varies per tiling and cannot be found reliably from the vertex set (see
Context), and the thumbnail is the pattern Send to Edit will produce.

A dashed mirror line is drawn on the tree figure when the result comes from a
`book` or `diag` database **and** the layout found at least one pair. The
database is the source of truth for "this tiling is symmetric"; the layout of a
`none` result that happens to have a mirrored pair is still symmetric, but
nothing claims it. The one rigid `diag` tree gets no line.

### D5 — Orientation, and the only two things the drawn tree decides

A mirror drawing is free to flip top for bottom. Default: **heavier side down** —
flip so the leaf centroid is not above the root. When the drawn tree is itself
symmetric about the editor's axis (`exploriTreeIsSymmetric`), match it instead:
put the result's leaves on the side of its root that the query's leaves are on
its own root. Left/right is meaningless for pairs; a tilted branch goes right
first.

That, plus the D3 tie-break, is everything the query contributes. The query's
explicit `symmetry.pairs` cannot be mapped onto a result: the API carries no
node correspondence, and the result's pairs come from its own lengths. This is
worth saying plainly in the code, because "pair handling" is where a reader will
look for the query.

### D6 — Pose reuse: built, then removed

A result with exactly the drawn tree's shape was for a while drawn in the
drawn tree's own pose at its own lengths. Removed on 2026-09-24 at Zach's
request: a result rarely has the query's exact shape, and the paper-driven
orientation (D9) makes the drawing legible without it.

### D7 — Nothing here talks to upstream

- **Fixtures come from the local databases through upstream's own code, and
  stay local.** The tiling data came from the archive's author for local use
  and is private: nothing derived from it is committed. `scripts/explori/
  build-fixtures.py` runs inside the SEARCH-22.5 venv, rebuilds chosen tilings
  with `load_frozen_blob → build_crease_pattern → add_hinges → cp_to_fold →
  get_tree_and_packing → fold_to_cp`, and serializes with
  `interface/serialization.py`'s `serialize_cp` / `serialize_fold` /
  `serialize_graph` — the same functions the server calls, so the shape is the
  API's, not a hand-written imitation. Output: one API-shaped bundle per
  database under the ignored `artifacts/explori/local-tilings/`, three to five
  tilings each, chosen to cover every row of the table above (strict, tilted ×1,
  tilted ×many, crossing edge, rigid, symmetric-by-chance `none`), smallest
  trees first. `scripts/explori/export-local-trees.py` unpickles every
  `embedding` into `artifacts/explori/local-trees.json` for the corpus test and
  writes a ~50-tree sample to `artifacts/explori/local-trees-sample.json` for
  the unit tests. Every test over this data skips where it is absent, so CI
  runs the hand-built cases and the one public recorded response only. Both
  scripts take database paths as arguments, default to the paths above, and
  open nothing but files.
- **The dev server answers from fixtures on request.** A Vite plugin
  (`apply: 'serve'`, modelled on `simPerfLogSink`) is enabled by
  `EXPLORI_MOCK=1` and serves `/api/explori/query` and `/api/explori/tiling`
  itself: filter the fixture pool by the requested `db_configs`, rank by a
  size-similarity proxy (leaf and node count distance to the query), return
  the top `n` under a fresh `query_id`, after a short artificial delay so the
  searching state is visible. It is not a search engine and says so in its
  startup line. When nothing matches the requested databases it falls back to
  the whole pool and logs that. Independently, `EXPLORI_DEV_ORIGIN` overrides
  the proxy target so a local upstream can be used.
- **The real search can run locally too** (stretch): install `faiss-cpu` into
  the SEARCH-22.5 venv (it is in `requirements.txt`, not installed — ask
  first), link the six `.db` files into `database/tilings/storage/`, build the
  FAISS caches for those six with `build_wks_index_for_db`, and start
  `python -m interface.server` with a `PYTHONPATH` shim supplying `gspread`,
  `oauth2client.service_account` and a `credentials.json`, because the server
  authenticates to Google Sheets at import time. No upstream file is edited.
  `/api/fetch_tiling` additionally needs the refs databases, which are not
  present, so only `/api/query` would work — which is all the dev loop needs.
  Documented as a recipe in `scripts/explori/README.md`; not a deliverable.

The default dev proxy keeps pointing at production, so nothing changes for
anyone who does not set the variable; the point is that this work, and future
work on this surface, has a one-flag way not to.

### D9 — The paper decides which way the drawing faces

Two follow-ups from use. First, the crease pattern's mirror is left-right for
some tilings and top-bottom for others, while the tree was always drawn about a
vertical line. Second, even with the axis right, the tree could be upside down
against the pattern. Both come from the same missing fact — where each tree
node sits on the paper — and the query response already holds enough to
recover it: the packing figure is the sliced folded form unfolded, so every
hinge crease of the base is on it, and hinges are the tree.

`paperTree.ts` refolds the packing by reflecting each facet across its creases
(a packing hinge that coincides with no hinge crease of the plain pattern is a
flat slice and does not fold), reads every vertex's axial coordinate off the
folded form, takes facets joined across mountain and valley creases as one
strip, its extreme coordinates as its two ends and their difference as its
length, and hinges at one coordinate joined through strips as one node. That is
upstream's `get_tree_and_packing` in floating point. The recovered tree is
matched to the served one (`matchExploriTrees`) and used only when it is the
same metric tree, so a misread packing falls back to the plain drawing rather
than to a wrong mapping. On the local archive it agrees with the served tree
on 511 of 519 sampled tilings; the misses are four-node stars with no single
axis and a few dense patterns.

The positions are not drawn. A middle flap's tip can be the same point of the
paper as its hub — 2b.7's short flap ends at the centre, on top of its hub —
and roughly one result in six has two nodes within 2% of the paper of each
other, so a tree drawn at its paper positions loses flaps. They steer the
drawing instead, in two ways:

- **The line is the pattern's.** Whether a mirror line is drawn, and along
  which direction, is read off the crease pattern itself
  (`exploriPatternMirror`): mountain, valley and border creases sampled and
  reflected across each of the four candidate lines, hinge creases left out
  because the archive adds them asymmetrically. The database a tiling came
  from is only a preference between several mirrors, because it is not a
  guarantee — `6 book` #1673 mirrors across nothing, and an axis drawn on it
  was the first thing reported.
- **The paper decides who keeps the line.** With the positions' coordinates
  along that mirror, the fan is built so that up is along the mirror and, at a
  node with several self-mirrored branches, the one whose fixed subtree
  reaches farthest along the mirror keeps the line while the rest tilt — the
  long flap on the symmetry line stays on it and the shorter things are the
  ones perturbed, which was the second report. A branch that points back
  toward its parent on the paper tilts too. Without the paper, the deepest
  chain keeps the line as before.

When the pattern has no mirror but the positions are known, the fan is turned
to face the way the tree lies on the paper (`orientExploriTree`) and no line is
drawn.

### Parity note

The crease-pattern, packing and folded-form figures stay a port of upstream's
renderers, as their header says. The tree figure stops being one: upstream lays
its tree out radially from the max-degree node and ignores symmetry, and the
whole point here is to do better. The header comment on `renderers.tsx` is
rewritten to scope the parity claim to the three figures it still holds for.

## Edge cases

Each of these has a test, and the corpus run reports its frequency:

- **Empty or single-node tree** (four empty tilings exist): nothing drawn, as
  now.
- **Edges naming absent nodes, duplicates, self-loops**: the parser already
  drops the first; the layout ignores the others and lays out the component
  containing the centre of the largest component, so a malformed payload never
  throws.
- **Non-positive or missing lengths**: 1, as now.
- **Length quantization**: relative 1e-6. Mirror strips are bit-identical, so
  this only has to survive merged sums; the corpus test asserts the bucketing
  never merges two lengths that differ by more than 1e-4 of the longest.
- **No pairs anywhere** (rigid, or a bare path): a fan with every child fixed —
  a deterministic radial drawing, vertical for a path. No axis line.
- **Symmetric by chance in a `none` result**: drawn symmetric, no axis line (D4).
- **Root with three or more fixed children**: the first two take up and down,
  the rest tilt (D2).
- **Two centres, both drawings possible**: fewer tilted branches wins, tie to
  the crossing edge (D3).
- **Classes of four or more identical subtrees**: several pairings exist and
  all draw the same picture; members are paired in id order for determinism.
- **Ties choosing which fixed child continues the axis**: depth, then size,
  then canonical key. Never id, so a relabelled tree draws the same.
- **Overlap**: wedge inheritance keeps siblings apart; long edges can still
  cross, exactly as today and as upstream. The corpus run counts coincident
  nodes (within 1e-3 of the drawing's extent) and edge crossings, and the plan
  records the numbers rather than promising zero.
- **Determinism and sharing**: the layout is a pure function of the graph, the
  database symmetry and the query's orientation flag, memoized; the card and the
  detail view therefore show the same drawing.
- **Size**: 73 nodes at most in the archive; canonical forms are O(n log n).

## Affected Areas

- `apps/web/src/explori/treeLayout.ts` — new: canonical forms, centre, maximal
  pairing, mirror fan, crossing-edge case, orientation; returns positions plus
  `{ pairs, fixed, tilted }` and a `strict` flag. React-free.
- `apps/web/src/explori/treeLayout.test.ts` — hand-built trees for every edge
  case above, the recorded `4b.61865` fixture (a strict tree: hub with two
  equal leaves, one leaf branch and one branch carrying two equal leaves), and
  the local tree sample where it exists; property checks: every edge drawn at its
  length, `pos(σ v) = reflect(pos v)` for every pair, fixed nodes at `x = 0`,
  tilted count matches the probe's classification, no two nodes coincide,
  identical output on a relabelled input.
- `apps/web/src/explori/treeLayout.corpus.test.ts` — gated on
  `artifacts/explori/local-trees.json` existing (the `precreasePlan.wasm.test`
  pattern); runs all 6,451 trees, asserts no throw and finite output, and
  prints the strict / tilted / rigid counts per database against the table
  above, plus coincidence and crossing counts and total runtime.
- `apps/web/src/explori/renderers.tsx` — `ExploriGraphFigure` takes the
  result's symmetry and the query's orientation, draws the axis line, draws
  leaf and branch dots distinctly (reusing the editor's tokens), projects with
  bounds symmetric about the axis; header comment rescoped.
- `apps/web/src/components/panels/ExploriResultsPanel.tsx` — passes the two new
  props from the design it already selects. A few lines; the panel is at 421 of
  its 800.
- `apps/web/src/styles/theme.css` — `.explori-graph-axis`, leaf/branch node
  classes.
- `apps/web/vite.config.ts` — `EXPLORI_MOCK` plugin, `EXPLORI_DEV_ORIGIN`.
- `scripts/explori/export-local-trees.py`, `scripts/explori/build-fixtures.py`,
  `scripts/explori/README.md` — the offline data path and the local-server
  recipe; a line in `scripts/README.md`.
- `artifacts/explori/` — every fixture, sample and corpus built from the
  private tiling data; ignored, never committed.
- `apps/web/src/explori/exploriService.test.ts` — one test that every local
  bundle parses through `parseQueryResponse` unchanged, so a fixture can never
  drift from what the client accepts; skipped where the bundles are absent.

No new user-visible strings, so nothing for `i18n:extract`. No analytics: this
changes how an existing result is drawn, and `explori search` already measures
the flow. Nothing saved changes shape.

## Checklist

Phase 0 — data, with no network

- [x] `export-local-trees.py`: all six databases → `artifacts/explori/local-trees.json`
      and a ~50-tree sample beside it, each tree tagged with the probe's
      classification so tests can pick cases by name; ignored, never committed
- [x] `build-fixtures.py`: API-shaped bundles for the chosen tilings, serialized
      by upstream's own functions; under the ignored `artifacts/explori/`
- [x] Every bundle parses through `parseQueryResponse` with nothing dropped

Phase 1 — the dev loop

- [x] `EXPLORI_MOCK=1` serves searches and tiling lookups from the bundles;
      startup line names the mode; nothing in the plugin can reach upstream
- [x] `EXPLORI_DEV_ORIGIN` overrides the proxy target
- [x] `scripts/explori/README.md` with the fixture workflow and the local-server
      recipe (marked as needing a venv install Zach has not yet approved)

Phase 2 — the layout

- [x] `treeLayout.ts`: canonical forms, centre, maximal pairing, mirror fan,
      tilt rule, crossing-edge case, orientation
- [x] Unit tests for every edge case listed above
- [x] Corpus test: no throws; the TypeScript layout agrees with the Python
      classifier on all 6,451 trees (kind, pair count, tilt count); the whole
      corpus lays out in about 1.1 s; **0** trees with coincident nodes; **29**
      trees with an edge crossing, one crossing each (report:
      `artifacts/explori/tree-layout-report.txt`)
- [x] A relabelled tree lays out identically

Phase 3 — the figure

- [x] `ExploriGraphFigure` uses the layout; axis line under D4; symmetric
      bounds; leaf and branch dots
- [x] Orientation follows the drawn tree when it is symmetric, heavier-down
      otherwise
- [x] Panel passes symmetry and query; detail view and card agree
- [x] `renderers.tsx` header rescoped
- [x] Lint, typecheck, `test:web` (Node 22, from `apps/web`), `i18n:check`
- [x] Browser-verify against the mock: a mirrored quadruped query with only
      `book` and `diag` selected; grid screenshot with axes aligned; detail
      view; a `none`-only search shows no axis lines; a tilted `6 book` case
      reads as symmetric with one off-line flap

Phase 4 — pose reuse for isomorphic results (D6)

- [x] Built, verified, and then removed (D6)

Phase 5 — the paper decides which way the drawing faces (D9)

- [x] `paperTree.ts`: refold the packing, recover the tree, match it to the
      served tree, position every node; `matchExploriTrees` in `treeLayout.ts`
- [x] `exploriPatternMirror`: the mirror read off the pattern's own creases;
      no line on a pattern that has none (`6 book` #1673 in the corpus test)
- [x] The `paper` option of the layout: up along the mirror, the line to the
      branch reaching farthest along it, the rest tilted
- [x] `orientExploriTree` for a pattern with no mirror: the best of the
      eighth-turns onto the recovered positions, no line
- [x] Tests on every local fixture: a position for every node except the
      degenerate stars, 2b.7's flaps at the corners and its short one on the
      centre, the chosen mirror a true mirror of the pattern, the tree facing
      the pattern's way, a known turn recovered exactly
- [x] Corpus test over `artifacts/explori/local-packings.json` from
      `export-local-packings.py`
- [x] The figure turns by the recovered positions; the panel passes the
      pattern and packing

Stretch — the real search, locally

- [ ] With approval: `faiss-cpu` into the SEARCH-22.5 venv, storage links,
      FAISS caches for the six local databases, import shim, `python -m
      interface.server`, `EXPLORI_DEV_ORIGIN=http://127.0.0.1:8000`
