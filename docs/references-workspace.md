# Finding references

The **References** workspace answers two questions about the crease pattern you
have open, without changing it:

- **How do I fold this whole pattern?** An ordered sequence of folds that creases
  every line of the design.
- **How do I locate this one reference?** Click a vertex or a crease and get
  ranked folding sequences for it, with a diagram per step. Only exact
  constructions are listed unless you turn on **Include approximate
  solutions** under the settings button; when nothing exact exists within the
  search, the closest constructions are listed instead, marked with how far
  off they land.

Open it from the rail, from **View → References**, or — when the whole crease
pattern is selected in Edit — from the selection toolbar. It never edits the
document; nothing you do here is saved.

## The model: one flat sheet, one fold at a time

Everything in this workspace assumes the origami equivalent of a blank page:

- The paper is **flat, open and rectangular**. Every fold is made on the
  unfolded sheet.
- Each step is **one crease**, made by one of the seven Huzita–Justin folds —
  bring a point to a point, an edge to an edge, fold through two points, and so
  on.
- The paper is never folded **through layers**. Mountain and valley, the order
  the model collapses in, and the shape it takes on the way are all outside what
  this workspace models.

That last point is the one worth knowing before you trust a count. Folding
through layers can beat the sequence shown here: creasing quarters at ¼, ½ and ¾
is three steps on a flat sheet and two by hand, because folding the sheet in half
first creases two of them at once. The sequence is a guide for *locating* the
lines, not a claim that no faster route exists.

## Reading the breakdown

Press **Work out the folds** and the sidebar fills with rounds. Every fold in a
round can be made before the round starts, so you can work across a round in any
order you like.

Within a round, folds that run the same way and are made the same way are
collapsed into one row with a count — "fold vertically: 3" — which you can open
to see each crease on its own. Selecting a row or a step frames it on the pattern
and picks out the references it is made against.

The strip at the top of the panel reads, for example:

> 91 folds = 89 creases + 2 auxiliary (0 visible) · lower bound 89

- **creases** are lines of your design.
- **auxiliary** folds are extra creases the sequence needed to locate the rest.
  They are not part of the design, so the fewer the better.
- **visible** counts the auxiliary folds that stay as full creases and will
  therefore show in the finished model. The rest are pinches.
- **lower bound** is the number of distinct lines your design has, off the paper
  edge. No sequence in this model can be shorter than that.

**"91 folds" is the best sequence this search found, not a proven minimum.** The
search is bounded — it looks a fixed distance ahead and stops — so a shorter
sequence may exist. The lower bound beside it is what a shorter one would have
to beat.

## Pinches

An auxiliary fold is often needed only for the point where it crosses something
else. When that is all a later step uses it for, the sequence tells you to
**pinch** it: crease a short mark at that point instead of the whole line. The
mark is enough to fold from, and the finished model keeps a much smaller scar.
Pinched folds show as short segments on the pattern and carry a *Pinch* label in
the sidebar; you can turn the short segments off under the settings button.

**Landmarks first** moves every auxiliary fold it safely can to the front, so you
make all your reference marks in one pass before starting on the design itself.
Folds that depend on a crease of the design stay where they are.

## When a line cannot be folded exactly

Some designs cannot be constructed exactly by any finite sequence of folds. If
your pattern's vertices sit slightly off a regular lattice — a scan, a
hand-placed point, a freeform design — some of its lines have no exact fold at
all.

Those lines are listed under **Lines with no exact fold**, with the closest
construction and how far off it lands. They are reported and never folded into
the sequence: an approximation used as a reference would carry its error into
every step built on it, so the sequence covers what it can construct exactly and
tells you about the rest.

If the pattern is only *slightly* off, the sequence is planned on a corrected
copy instead, and the strip says **Snapped** with the largest distance any line
moved. Your document is not changed either way.

## Analyzing references

**Crease Pattern → Diagnostics → Analyze References** goes through the pattern
line by line and reports which are easy to find and which are not:

- folds from the sheet itself — no search needed,
- exact at rank *r* — a construction exists, longer for higher *r*,
- approximate, off by ε,
- no construction found.

Most lines of a typical design fall in the first group, so the analysis is
usually quick; a design with many awkward lines takes longer, and **Stop** keeps
whatever has been found so far.

## Limits in this version

- **Rectangular sheets only**, in any orientation. A hexagonal or otherwise
  non-rectangular outline is listed as left out rather than planned.
- A canvas holding **several separate patterns** plans each sheet in turn.
- Nothing is written to the document — no guide lines, no snapped coordinates.
- Results are **not** kept when the pattern changes. The panel says "Out of
  date" and waits for you to press Recompute, because a run takes seconds and
  redoing it on every edit would be worse than asking.

## Credits

The per-reference search is Robert J. Lang's **ReferenceFinder**, as compiled to
WebAssembly by Mu-Tsun Tsai and Omri Shavit. The whole-pattern sequence is Ori
Studio's own planner.
