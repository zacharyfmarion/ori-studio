# 3D fold-angle fixtures

Crease patterns whose creases carry **non-180° fold angles**, for the computed
3D folded state (`implementation-plans/3d-folded-state.md`, Phase 2).

Nothing downstream of Phase 2 is checkable without these. The kernel work has no
oracle — Oriedita's creases are always ±180, so there is no upstream
implementation to diff against — which means every load-bearing claim about
placement, admission, plane clustering and the coplanar-overlap census has to be
an assertion against a file whose answer is known and recorded. That is what
these are.

They are verified by `crates/oristudio-cp/tests/verify_fold_fixtures.rs`, which
pins every number in the table below. `crates/oristudio-cp/tests/non_flat_corpus.rs`
additionally re-derives each one from its source and asserts byte equality, when
the external corpus is available.

## What may be committed here

A file goes in this directory **iff all four hold**:

1. **The repository owner authored it in Ori Studio**, so it is his to license
   under the repository's terms. Third-party material stays out, however
   convenient — AGENTS.md's "real-world user corpus files are not committed"
   governs it, and licence terms govern it twice. The precedent for the owner's
   own test designs is `tests/fixtures/simulation/iguana_24.osf` (3.53 MB,
   committed; `apps/web/src/lib/simulationCorpus.test.ts:14-17`).
2. **It carries at least one non-classic fold angle**, or it is the matched
   all-classic control for one that does (`box_90_unangled`).
3. **It carries `faces_vertices`.** Note the kernel does *not* read them —
   `import_fold_document` builds from `edges_vertices` alone and the arrangement
   comes from `FoldGraph` — but a fixture whose face set cannot be read without
   running the kernel cannot be checked by hand.
4. **Its verdict is recorded below**, and a test asserts it.

Rule 1 is now **enforced rather than asserted**. An earlier version of this file
claimed all nine files here were owner-authored; three of them were not, and the
claim sat here for months because a sentence in a README cannot fail. The names
live in `crates/oristudio-cp/tests/common/mod.rs::EXTERNAL_FIXTURES`, and
`verify_fold_fixtures.rs::the_3d_fixture_corpus_is_not_empty_and_covers_more_than_ninety_degrees`
fails if one of them reappears on disk. A prose rule with no test is how this
happened; do not add another.

## What went external, and what that cost

Three fixtures were removed from this directory as third-party designs:

| fixture | source | role it was the only fixture for |
| --- | --- | --- |
| `penguin_freeform` | `plant/penguin_other_angles.osf`, component 0 | the only genuinely free-form-angle clean positive; the only multi-solution figure (8 orders) |
| `penguin_disconnected` | `plant/penguin_other_angles.osf` | the only naturally-authored clean-yet-unplaceable model (`Disconnected`) |
| `rabbit_unclosed` | `plant/rabbit.osf` | the only closure refusal, and the 70.53° two-directions cross-check |

Their rows stay in the tables below, because the recorded verdicts are still what
the tests assert — they are simply read from
`$ORISTUDIO_NON_FLAT_CORPUS_DIR/fold-angle-3d/` instead of from git. Derive them
once with the commands in `crates/oristudio-cp/tests/common/mod.rs` and every
assertion that named them runs again, unchanged; the derived files are
byte-identical to what was tracked here.

**CI does not set that variable, so CI no longer checks any of the three roles
above.** That is a licensing decision overriding a testing one, which is the
right order, but it is a real loss and it is recorded here rather than absorbed
silently. Authoring owner-made replacements — a free-form-angle positive, a
disconnected negative, a near-miss closure failure — is the way to get the
coverage back, and is tracked separately from the removal.

One assertion was not gated but narrowed:
`folding3d/placement.rs::a_placement_that_succeeds_has_a_crease_on_every_dual_adjacency`
is a unit test inside the crate, where the integration tests' skip machinery is
not reachable, so it simply dropped `penguin_freeform` from its list of three.
`spikes_small` and `box_90` both carry non-tree dual graphs, so it still asserts
something.

## How these files were produced

Every `.fold` here is a **derived artefact**: the FOLD document out of an `.osf`
project (`workspace.documents[0].creasePattern.foldProjection`), minified.
`scripts/osf-fold-projection.mjs` does the extraction and the exact command is in
the table. `box_90.osf` is the one exception — a byte-for-byte copy of its
source, because Phase 8 needs a real project file to migrate.

```sh
CORPUS=/path/to/non-flat            # $ORISTUDIO_NON_FLAT_CORPUS_DIR
OUT=tests/fixtures/fold-angle-3d
node scripts/osf-fold-projection.mjs "$CORPUS/test_export.fold"                             > $OUT/hinge_90.fold
node scripts/osf-fold-projection.mjs "$CORPUS/tooling/base_fixed.osf"                       > $OUT/box_90.fold
node scripts/osf-fold-projection.mjs "$CORPUS/tooling/base.osf"                             > $OUT/box_90_unangled.fold
node scripts/osf-fold-projection.mjs "$CORPUS/non-flat-test.osf"                            > $OUT/spikes_small.fold
node scripts/osf-fold-projection.mjs "$CORPUS/spikes_better.fold"                           > $OUT/spikes_large.fold
# The three plant/ designs are NOT committed; they derive into the corpus itself.
# See crates/oristudio-cp/tests/common/mod.rs.
cp "$CORPUS/tooling/base_fixed.osf" $OUT/box_90.osf
# hole_vertex_90 is not derived from the corpus — see its entry below.
```

**No coordinate rounding**, and that is a decision rather than an oversight. The
plan proposed 6 decimal places, which on a 400-unit sheet is 2.5e-9 relative and
looks obviously safe. Measured, it is not: at 6 dp `penguin_freeform` goes from
**0 flat-foldability violations to 12** and `rabbit_unclosed` from 0 to 5. The
verdict survives from 8 dp up — but even 8 dp moves one of
`penguin_disconnected`'s parallel-plane separations from 7.86 units down into the
1e-12..1e-9 band that the 3D admission gate's spectrum test reads, which would
make a fixture's most interesting property an artefact of how it was written out.
So: emit what the author saved. Minifying the JSON already recovers most of the
size (`spikes_large` 58.7 KB → 18.2 KB), and rounding on top of that buys under
7 KB across the whole set.

Total: **23.1 KB** of `.fold` across the five committed fixtures (against 144.8 KB of `.fold` already tracked elsewhere) plus one 30.5 KB `.osf`. The three external files are a further 45.6 KB that used to be here and is not.

## Licence and provenance

The **seven** files now in this directory — `hinge_90`, `hole_vertex_90`,
`box_90`, `box_90_unangled`, `spikes_small`, `spikes_large` and `box_90.osf` —
were authored by the repository owner in Ori Studio (`hole_vertex_90` with its
fold angles solved rather than saved; see its entry) and are contributed for this purpose under the repository's
licence. `box_90.osf` carries `images: []`, `textAnnotations: []` and
`inlineSimulations: []`, so unlike `iguana_24.osf` nothing had to be stripped
from it.

The `plant/` designs — `penguin_other_angles.osf` and `rabbit.osf` — are **not**
the owner's, and neither their `.osf` nor any projection of them belongs in this
repository. See *What went external* above. An earlier version of this section
said all nine files here were owner-authored; that was wrong, and it is the
reason rule 1 now has a test behind it.

## The fixtures

Measured by one command, which is the same command the plan quotes:

```sh
cargo run -p oristudio-cp --release --example fold3d_census -- \
    tests/fixtures/fold-angle-3d
```

`loop-gap` is the worst placement disagreement over the `ntree` non-tree dual
adjacencies (paper units; `--` means the dual graph is a tree, so there is no
self-check at all). `dihedral` is the worst declared-vs-measured fold angle over
placed face pairs, in degrees — the only check here that exercises a
general-angle rotation rather than a half-turn. `census` is the coplanar-overlap
pair count. Paper span is 400 for every fixture.

`min-sep` is the smallest strictly-positive gap between two **consecutive
per-face offsets inside one normal class** (`--` means no class held two distinct
offsets, which certifies nothing). It is **not plane separation** and must not be
quoted as the side condition's upper bound: on a plane holding many faces it
reports that plane's own numerical jitter, so on `penguin_disconnected` it reads
4.048e-9 where the nearest genuinely distinct plane is 1.96e-2 of span away. The
kernel field behind it was renamed `Fold3dDiagnostics::min_face_offset_gap` for
that reason; the real quantity is
`PlaneIndex::min_inter_separation_relative`, which is computed over the plane
partition and is reported by `corpus_census_reports_every_model`.

**These are the harness's numbers, and three columns differ from the shipped
kernel's on purpose.** `crates/oristudio-cp/tests/folding3d.rs` pins the kernel's
own `LoopGap` and `crates/oristudio-cp/tests/folding3d_census.rs` pins its own
plane count and census; each is the second implementation of the same quantity
and the reason having both is worth it.

- `ntree` — the kernel reports the dual graph's **first Betti number**,
  `|E_dual| − F + 1`, which is larger wherever two faces meet across two separate
  segments: **155 vs 137** on `spikes_large`, **46 vs 44** on `rabbit_unclosed`,
  identical everywhere else. The harness keys tree membership on the *face pair*
  and so drops the second meeting; the kernel keys on the edge. A crease drawn as
  two collinear pieces is exactly how that arises, and the consistency condition
  it carries is real (it reads zero).
- `loop-gap` — same measure, but over a different spanning tree, so it differs in
  the last digits on the models that close to machine precision (`box_90`
  1.46e-13 vs 2.31e-13) and agrees to three figures on the ones that do not
  (`penguin_freeform` 7.88e-8, `rabbit_unclosed` 4.23e1, `box_90_unangled`
  4.00e2).
- `planes` / `census` — identical on every row except **`rabbit_unclosed`**,
  where the harness reads 26 planes and 306 pairs against the kernel's 25 and
  371. That is the one fixture whose placement does not close (70.5°), so which
  faces are coplanar is genuinely a function of the tolerance, and the two use
  different ones: the harness clusters normals with a `dot > 1 − 1e-9` deficit,
  which is a *squared* quantity and so an effective 4.5e-5 rad bar — 450× looser
  than `Fold3dTolerances::angle_radians`. Neither is wrong about a model whose
  geometry does not close, which is why the gate refuses it before either is
  consulted. Do **not** "fix" one to match the other.
- `census` on **`penguin_disconnected`** is a harness-only number. The kernel
  never places that model at all (two components), so its 1001 is a per-component
  figure with no kernel counterpart and is not a target.

| fixture | V / E / F | ±180 | non-classic | flat | closure | self-int | indet | spatial | loop-gap | ntree | dihedral | min-sep | sep-bins | planes | census | 3D verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `hinge_90` | 4 / 5 / 2 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | — | 0 | 0.00e0 | — | 0/0/0/0/0 | 2 | **0** | admit |
| `hole_vertex_90` | 20 / 26 / 6 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 1.90e-7 | 1 | 2.44e-8 | — | 0/0/0/0/0 | 6 | **0** | admit |
| `box_90` | 13 / 23 / 11 | 7 | 6 | 0 | 0 | 0 | 0 | 2 | 1.46e-13 | 3 | 0.00e0 | 2.828e2 | 7/0/0/0/1 | 4 | 17 | admit |
| `box_90_unangled` | 13 / 23 / 11 | 13 | 0 | **2** | 0 | 0 | 0 | 0 | 4.00e2 | 3 | 1.80e2 | — | 10/0/0/0/0 | 1 | 27 | n/a (flat path) |
| `spikes_small` | 24 / 48 / 25 | 20 | 16 | 0 | 0 | 0 | 0 | 8 | 7.00e-14 | 12 | 2.54e-14 | — | 22/0/0/0/0 | 3 | 36 | admit |
| `spikes_large` | 207 / 420 / 214 | 224 | 144 | 0 | 0 | 0 | 0 | 114 | 3.83e-13 | 137 | 1.27e-13 | 5.000e1 | 206/0/0/0/5 | 8 | 543 | admit |
| `penguin_freeform` † | 120 / 246 / 127 | 133 | 64 | 0 | 0 | 0 | 0 | 36 | 7.88e-8 | 71 | 5.49e-8 | 6.623e-10 | 94/12/0/0/0 | 21 | 457 | admit |
| `penguin_disconnected` † | 224 / 452 / 230 | 269 | 90 | 0 | 0 | 0 | 0 | 53 | 3.50e-8 | 131 | 5.49e-8 | 4.048e-9 | 191/11/0/0/5 | 29 | 1001 | **refuse — 2 components** |
| `rabbit_unclosed` † | 78 / 164 / 87 | 70 | 62 | 0 | **1** | 0 | 0 | 32 | 4.23e1 | 44 | 7.05e1 | 8.383e-10 | 53/8/0/0/2 | 26 | 306 | **refuse — closure** |

† Held outside the repository — read from
`$ORISTUDIO_NON_FLAT_CORPUS_DIR/fold-angle-3d/`, not from git. The numbers are
unchanged; only where the file lives is. See *What went external* above.

### What each one is for

**`hinge_90`** — a 400×400 square cut by one diagonal at −90°: two triangles,
four boundary vertices, no interior vertex at all. The degenerate control:
`census 0`, so the whole figure renders opaque with no layer ordering, and the
only such fixture here. Also the one file where `CheckCamv` reports clean
**vacuously** — with no interior vertex, 0 spatial vertices are examined — so it
pins the difference between "checked and passed" and "never looked at". Its dual
graph is a tree, so the loop gap has nothing to be a maximum over; that has to
read as `--` and not as `0.0`. Per the plan's §1, a two-face hinge discriminates
nothing about composition order and must never be the only placement test.
Source: `test_export.fold` (sha256 `b4b85db4…`), itself an Ori Studio FOLD export.

**`hole_vertex_90`** — the first **multiply-connected** fixture here, and the
only one whose loop gap is load-bearing. A sheet with a square window, six
creases running from the window's rim out to the paper's, and **no interior
vertex at all**: every vertex touches a border, so `is_interior_vertex` declines
all of them and `dispatched_camv` examines nothing (`spatial` reads 0, and that
is the fixture's point rather than a gap in it). On every other fixture the
non-tree dual edges close cycles per-vertex closure has already forced, and the
loop-gap bar is defence in depth; here the one cycle goes around the hole,
per-vertex closure says nothing about it, and the gap is the whole check.

Multiply-connected paper is also what made the gate's blind spot reachable —
`loop_gap.offset` is sampled at the endpoints of the dropped crease, so it cannot
see a holonomy that is a rotation about that crease's own line. This fixture is
not the one that catches it (it closes, so it passes either way); the shape that
does is a *fold line the hole interrupts*, which is
`tests/fixtures/oriedita/holed_frame_collinear.ori`'s geometry with the two
halves given different angles. See
`folding3d.rs::an_interrupted_fold_line_cannot_be_folded_two_different_ways`.

This is the `annulus_90` role from *What is deliberately absent* below, filled.

It is also the **only committed fixture with more than one fold-angle
magnitude**: four valleys at 90° and two mountains at
arccos(1/3) = 70.5287793655°. Its six crease lines are concurrent at the window's
centre, so the annulus is kinematically a degree-6 vertex with the vertex punched
out, and the closing states are that vertex's — a one-parameter family under the
pattern's own two-fold symmetry, related by
`tan(mountain/2) = tan(valley/2) / √2`. That is where 70.5287793655° comes from,
and why it is not round: uniform magnitudes do **not** close, which is the bug
report this fixture came from.

Provenance differs from the rest of this directory, and is recorded rather than
glossed. The **geometry** is the repository owner's, authored in Ori Studio; the
**fold angles** are not in that file — `.ori` cannot carry them — and were solved
against the vertex closure condition. Both are contributed under the repository's
licence, so rule 1 holds; it is simply not a straight projection of a saved
project the way the others are, and so it has no row in `non_flat_corpus.rs`'s
`DERIVATIONS`. Its two all-classic siblings are the other components of the same
source file: `tests/fixtures/oriedita/holed_sheet_spiral.ori` and
`holed_frame_collinear.ori`.

**`box_90`** — 11 faces over 4 planes, 6 creases at 90°, census 17. The smallest
model here that is a real 3D fold: multiple planes, real coplanar overlap, and
only 2 spatial vertices, so a wrong answer can be worked out by hand. It is also
the fixture Phase 8 needs, because `box_90.osf` is its source project.
Source: `tooling/base_fixed.osf` (schemaVersion 5, sha256 `1f8cd9f0…`).

**`box_90_unangled`** — the matched **before** file: the same 11-face box saved
before its angles were set, so every crease is ±180 and the document is
all-classic. This is truth-table rows (a) and (b) — an all-classic selection must
keep taking the flat path byte-identically, whatever else is in the document —
and it is a matched pair rather than an unrelated flat model, so a routing
regression shows up as a difference between two files that differ *only* in their
angles. It carries 2 flat-foldability violations, which is what makes it also a
negative for the flat path.
Source: `tooling/base.osf` (schemaVersion 5, sha256 `fef4184c…`).

**`spikes_small`** — 25 faces, 16 creases at 90°, 3 planes, census 36, 8 spatial
vertices all closing. The small clean positive: big enough to have a non-trivial
dual graph (12 independent cycles) and small enough to print.
Source: `non-flat-test.osf` (schemaVersion 4, sha256 `c4d235bc…`).

**`spikes_large`** — 214 faces, 144 creases at 90°, 114 spatial vertices all
closing, census 543. The scale case: Phase 6's per-frame BSP budget and Phase 9's
solver both need a model at this size, and this is the largest clean 3D-angled
model that exists anywhere in the corpus. It has **no `.osf` sibling** — if it is
not committed it is lost.
Source: `spikes_better.fold` (sha256 `d8da51b4…`), an Ori Studio FOLD export.

**`penguin_freeform`** — 127 faces, 64 non-classic creases at **10 distinct
magnitudes** (6.186377°, 14.865803°, 33.165448°, 34.964833°, 45°, 72.47013°, 90°,
100°, 135°, 151.221544°), clean and admitted. The only clean model in existence,
committed or not, whose fold angles are genuinely free-form: every other positive
here is 90° only, and 90° is exactly the angle Spike B found degenerate — at
(90, 90) a sign fault leaves the obvious probe vertex fixed to 6.7e-16 while
moving the rest of the face by 1.414. A placement validated only on 90° fixtures
is not validated.

It carries a second, unplanned finding worth keeping in view. Its smallest
parallel-plane separation is **6.6e-10 on a 400 span — 1.7e-12 relative — with
12 further separations in the 1e-12..1e-9 band and none at all above 1e-3**,
while it is CLEAN and admitted. The plan's §2 step 6 says the separation spectrum
"only fills in on models that already fail closure"; this fixture refutes that,
and is the cheapest committed evidence that minimum plane separation cannot gate.
Source: `plant/penguin_other_angles.osf` component 0 (schemaVersion 7, sha256
`ce011066…`).

**`penguin_disconnected`** — the whole of the same project: two unrelated designs
on one canvas, vertex components [120, 104] and face components [127, 103]. The
kernel calls it **CLEAN** — 0 flat violations, 53 spatial vertices all closing to
6.6e-8° against a 1e-6° bar — and it is still unplaceable, because CAMV is
per-vertex and never asks about connectivity. That makes it the strongest
available fixture for `Placement3dError::DisconnectedFaceGraph`, and the proof
that a clean CAMV verdict is not sufficient for placement. It is naturally
authored; nobody built it to break anything.

It overlaps `penguin_freeform` by 127 faces, and that ~11 KB of duplication is
deliberate. Neither derives from the other at test time without re-implementing
component extraction inside the assertion, and each is the only fixture in its
role: one is the only clean free-form positive, the other the only naturally
authored clean-yet-unplaceable negative.
Source: `plant/penguin_other_angles.osf` (schemaVersion 7, sha256 `ce011066…`).

**`rabbit_unclosed`** — 87 faces, 62 non-classic creases at **16 distinct
magnitudes** on a 7.5° direction system, with exactly **one** closure failure out
of 32 spatial vertices. The refusal negative, and deliberately a near-miss: a
model that fails everywhere would be passed by a checker that is broken in almost
any way. Its worst vertex closure residual is 70.53°, and the placement's worst
declared-vs-measured dihedral is 70.5° — the same number reached two independent
ways, which is a free cross-check on any future placement.
Source: `plant/rabbit.osf` (schemaVersion 7, sha256 `17525f56…`).

**`box_90.osf`** — the one project file, byte-for-byte
`tooling/base_fixed.osf`: 30,465 bytes, schemaVersion 5, 23 line segments, 6 of
them carrying a `fold_magnitude` of 900000000 (90° at the 1e-7° storage
quantisation), no inline simulation, no images, no text. Phase 8 needs a real
`.osf` to prove the v5 → v8 migration keeps `fold_magnitude` intact and that a
saved 3D figure round-trips; the smallest one in the corpus is the right one to
commit.

## What is deliberately absent

- **A fixture for `Refused(VertexIndeterminate)`** (truth-table row (f)). There
  is none, and it is not an oversight: **0 of the 245 spatial vertices across
  this whole set is indeterminate**, and 0 of 481 across every candidate that was
  considered. Nobody folds an indeterminate vertex by accident. That arm needs an
  authored fixture or it ships untested — see Phase 2's authoring list.
- **Adversarial cases.** `strip_coupled` (the cross-plane coupling
  counterexample), `pinwheel_cyclic`, `prism_60`, `tube`, `nested_tongue`,
  `bridge_tuck`, and the 60°/120° three-face chains Spike B needs. `annulus_90` is
  **done** — it is `hole_vertex_90` above.
  None of them occurs in naturally authored material, all of them have to be
  built, and Phase 2's checklist owns them.
- **Anything third-party.** Including the Mooser's Train ground-truth pair, which
  is the best placement oracle available and stays external for licence reasons.
  `non_flat_corpus.rs` reaches it through `ORISTUDIO_NON_FLAT_CORPUS_DIR`.
