# Derived geometry should inherit fold angle

## Goal

An operation that extends, reflects, or copies an existing crease should produce
a crease that folds the same way. Today a mirrored 90° crease comes back as a
full ±180, silently.

## The rule

> **Colour answers "which family". Magnitude belongs to the crease being
> transformed.**
>
> For any operation deriving a segment from a source segment, the fold magnitude
> is inherited from the source — unconditionally. Where the line *type* comes
> from is whatever that tool already decided: the source for "same as original"
> tools, the active line type for the rest.

This maps exactly onto the direction × magnitude split the representation is
built on, which is why it drops out cleanly rather than needing a special case
per tool. The active line type never had anything to say about *how far* a
crease folds; it only ever chose mountain or valley.

It also means the `E`-family tools do **not** diverge: extend-with-active-type
and extend-same-colour both preserve the angle, and differ only in the family,
which is exactly what their names promise.

## Root cause: one idiom

Two ways an operation produces a segment from an existing one:

| Pattern | Magnitude | Why |
| --- | --- | --- |
| `source.with_coordinates(a, b)` | **kept** | `..*self` copies every field it does not name |
| `LineSegment::new(a, b).with_line_color(...)` | **lost** | fresh segment; only the colour is ever copied back |

The second reads as "make this look like the source crease", and before fold
angles existed it did exactly that — colour *was* the crease's whole identity.
It now carries half of it.

So the fix is not four patches. It is to give the missing half a name:

```rust
/// Inherit the fold magnitude from `source`, leaving the colour alone.
///
/// Derived geometry — extend, reflect, mirror, copy — folds the way the crease
/// it came from folds. The line *type* may come from elsewhere (the active
/// type), but the angle is a property of the crease being transformed.
pub fn with_fold_magnitude_of(&self, source: &LineSegment) -> Self {
    self.with_fold_magnitude(source.fold_magnitude)
}
```

Magnitude-only rather than colour+magnitude, because the rule deliberately
decouples them. Each call site then reads as its own answer to "where does the
family come from", with the angle handled identically everywhere:

```rust
// same-as-original tools
derived.with_line_color(source.color).with_fold_magnitude_of(source)
// active-type tools
derived.with_line_color(active).with_fold_magnitude_of(source)
```

Ordering matters and is safe by construction: `with_line_color` clears the
magnitude when moving to a non-crease colour, and `with_fold_magnitude` is a
no-op on non-crease colours — so applying magnitude second can never smuggle an
angle onto a border or auxiliary line.

## Audit

### Broken — must inherit magnitude

| Operation | Key | Kernel fn | Colour comes from | Site |
| --- | --- | --- | --- | --- |
| `DrawCreaseSymmetric` (mirror selection) | — | `construction::mirror_selected_lines` | source | `construction.rs:528` |
| `DoubleSymmetricDraw` | `Ctrl+G` | `construction::double_symmetric_draw` | source | `construction.rs:887` |
| `SymmetricDraw` (mirror line) | `M` | `construction::symmetric_draw` | **active** | `construction.rs:845` |
| `LengthenCrease` / `LengthenCreaseSameColor` | `E` | `transform::lengthen_crease` | **active** / source | `transform.rs:636` |

`symmetric_draw` already takes a `source: &LineSegment` parameter — it simply
never consults it for anything but geometry, so the fix is a one-line addition
with nothing to thread through.

`lengthen_crease` serves both modes through one `add_extended_line_segment`, so
the magnitude inheritance lands once and covers both.

### Already correct — no change, but worth pinning

- `CreaseMove` / `CreaseCopy`, `CreaseMove4p` / `CreaseCopy4p` — route through
  `with_coordinates`
- Splitting at intersections — already pinned by
  `splitting_a_crease_preserves_its_fold_angle`
- Frontend clipboard copy/paste and M/V swap — both spread
- **`ContinuousSymmetricDraw` (`Ctrl+R`)** — correct *by accident*, and that is
  the interesting one. It clones real model segments
  (`output.push(hit.segment.clone())`) and then overrides only the colour;
  because `with_line_color` keeps the magnitude across a mountain/valley swap,
  the angle survives. Nothing to fix, but it deserves a test — it is one
  refactor away from silently regressing, and nothing currently says so.

### Out of scope — no single source crease

`Inward`, `FishBoneDraw`, every generator (bases, Voronoi, polygon), and the
circle constructions build geometry from points, not from a crease.

## Affected Areas

- `crates/oristudio-cp/src/geometry/line_segment.rs` — the new method
- `crates/oristudio-cp/src/operations/construction.rs` — mirror, double-symmetric,
  symmetric draw
- `crates/oristudio-cp/src/operations/transform.rs` — `add_extended_line_segment`
- `crates/oristudio-cp/tests/` — per-operation coverage
- Oracle tests must stay green untouched: every change is a no-op when the
  source is classic, so any oracle movement means the fix leaked into flat
  behaviour

## Checklist

- [ ] `LineSegment::with_fold_magnitude_of`
- [ ] Unit test: inheriting onto a border/auxiliary colour drops the magnitude
- [ ] Unit test: order-independence — colour then magnitude is always safe
- [ ] `mirror_selected_lines` inherits magnitude
- [ ] `double_symmetric_draw` inherits magnitude
- [ ] `symmetric_draw` inherits magnitude while keeping the active colour
- [ ] `add_extended_line_segment` inherits magnitude in **both** colour modes
- [ ] Per-operation test: reflecting/extending a 90° crease yields a 90° crease
- [ ] Per-operation test: the active line type still decides M/V, and only that
- [ ] Per-operation negative test: deriving from a classic crease stays classic,
      so the change cannot invent angles
- [ ] Regression test pinning `ContinuousSymmetricDraw`, which is correct today
      only because it clones
- [ ] Doc-comment on `with_line_color` pointing at the new method
- [ ] Source-level guard against a fresh `with_line_color(<x>.color)` returning
- [ ] Oracle suite green with no fixture edits
- [ ] Rebuild the committed `.wasm`, or none of this reaches the app

## Preventing the fifth occurrence

The audit found these by grepping one idiom, and that only works while the idiom
stays greppable — the whole problem is that `with_line_color(x.color)` *looks*
correct.

- **Doc-comment on `with_line_color`** pointing at `with_fold_magnitude_of`.
  Free, and it lands where someone writing the next tool is already looking.
- **A test that greps the source** for the old idiom and fails with an
  explanation. Ugly, but it is the only mechanism that actually fires, and the
  repo has precedent for source-level gates (`i18n:check`).

Recommend both; the grep test is what makes it stick. A clippy lint would be the
principled answer and is not worth writing for four call sites.

## Risks and mitigations

| # | Risk | Mitigation |
| --- | --- | --- |
| R1 | The audit missed a site — it found these by one grep signature, and a tool inheriting some other way would not match | Negative tests catch *invented* angles but not *dropped* ones. Best available check is per-operation tests plus scrutiny of any future `LineSegment::new` in an operation that takes a source segment |
| R2 | Inheriting onto a border or auxiliary line smuggles in a magnitude the model forbids | `with_fold_magnitude` already no-ops on non-crease colours; asserted by unit test |
| R3 | Oracle drift — a change here altering flat behaviour | Every change is a no-op when the source is classic. Any oracle movement is a real regression, not a fixture update |
| R4 | `ContinuousSymmetricDraw` regresses later, since nothing currently states that its correctness depends on cloning | The pinning test above |
| R5 | Stale wasm — the kernel change silently does nothing in the app | Bit twice during the fold-angle work. Explicit checklist item |

## Open question

**`ParallelDraw` / `ParallelDrawWidth`.** These take a `parallel_segment` and
draw a new line at a target point sharing its direction. That is borrowing a
*direction*, not copying a crease — the result is a genuinely new crease that
happens to be parallel — so I have left it out. If the expectation is that
drawing parallel to a 90° crease gives another 90° crease, it moves into the
first table and the same one-line fix applies.
