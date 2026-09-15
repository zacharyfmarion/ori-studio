/**
 * The sentence for one step of a ReferenceFinder construction, from the
 * extractor's labelled inputs.
 *
 * The core serialises each step's inputs as `p0`/`p1`/`l0`/`l1` and the
 * extractor flattens them, points first (`ExtractedStep.inputs`). Which slot
 * means what is fixed per axiom by the core's `Serialize` methods
 * (`third_party/reference-finder/src/core/class/refLine/*.cpp`), and the
 * wording below follows each class's own "how to" comment:
 *
 * - O1 `C2PC2P`: a crease through p0 and p1.
 * - O2 `P2P`: bring p0 to p1.
 * - O3 `L2L`: bring l0 to l1.
 * - O4 `L2LC2P`: bring l0 to itself so the crease goes through p0.
 * - O5 `P2LC2P`: bring p0 to l0 so the crease passes through p1.
 * - O6 `P2LP2L`: bring p0 to l0 and p1 to l1.
 * - O7 `L2LP2L`: bring **l1** onto itself so that p0 falls on **l0** (note: O7
 *   is the one axiom whose serialised slots run the other way — `Serialize`
 *   emits `rl2` as `l1` and `rl1` as `l0`, see
 *   `third_party/reference-finder/src/core/class/refLine/refLineL2LP2L.cpp:146-148`.
 *   The class comment above that constructor names its arguments `l1`/`l2` in
 *   the abstract, which is *not* the slot order on the wire).
 *
 * React-free; literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';
import type { ExtractedStep } from './referenceFinder/extractor';
import { directionOfGroup, type ReferencesDirection } from './referencesBreakdown';
import { unitFrame } from './diagram/diagramFrames';
import { alsoLetters, inputLetters, type InputLetters } from './diagram/inputLetters';
import { perpendicularMotion } from './diagram/plannerDiagram';
import {
  SHORT_ALIGNMENT,
  chosenWitness,
  type PrecreaseGridBound,
  type PrecreaseGridStep,
  type PrecreaseSequence,
  type PrecreaseStep,
  type PrecreaseWitness,
} from './precreaseSequence';

/** How many point and line inputs each axiom serialises, in that order. */
export const STEP_INPUT_ARITY: Readonly<Record<number, { points: number; lines: number }>> = {
  0: { points: 0, lines: 2 },
  1: { points: 2, lines: 0 },
  2: { points: 2, lines: 0 },
  3: { points: 0, lines: 2 },
  4: { points: 1, lines: 1 },
  5: { points: 2, lines: 1 },
  6: { points: 2, lines: 2 },
  7: { points: 1, lines: 2 },
};

/** Split a step's flattened inputs back into its point and line slots. */
export function splitStepInputs(step: Pick<ExtractedStep, 'axiom' | 'inputs'>): {
  points: string[];
  lines: string[];
} {
  const arity = STEP_INPUT_ARITY[step.axiom] ?? { points: 0, lines: 0 };
  return {
    points: step.inputs.slice(0, arity.points),
    lines: step.inputs.slice(arity.points, arity.points + arity.lines),
  };
}

/**
 * Whether a label names a line. The core assigns `A`–`J` to lines and `P`–`Z`
 * to marks (`solution.ts`); the sheet's own lines and corners have names.
 */
export function isLineLabel(label: string): boolean {
  if (['s', 'n', 'w', 'e', 'sw_ne', 'nw_se'].includes(label)) return true;
  if (['sw', 'se', 'nw', 'ne'].includes(label)) return false;
  return /^[A-O]$/.test(label);
}

/** A reference's name in a sentence: the sheet's own by description, a step's by letter. */
export function referenceName(t: TFunction, label: string): string {
  switch (label) {
    case 's':
      return t('panels:references.ref.bottomEdge', 'the bottom edge');
    case 'n':
      return t('panels:references.ref.topEdge', 'the top edge');
    case 'w':
      return t('panels:references.ref.leftEdge', 'the left edge');
    case 'e':
      return t('panels:references.ref.rightEdge', 'the right edge');
    case 'sw_ne':
      return t('panels:references.ref.diagonalSwNe', 'the bottom-left to top-right diagonal');
    case 'nw_se':
      return t('panels:references.ref.diagonalNwSe', 'the top-left to bottom-right diagonal');
    case 'sw':
      return t('panels:references.ref.cornerSw', 'the bottom-left corner');
    case 'se':
      return t('panels:references.ref.cornerSe', 'the bottom-right corner');
    case 'nw':
      return t('panels:references.ref.cornerNw', 'the top-left corner');
    case 'ne':
      return t('panels:references.ref.cornerNe', 'the top-right corner');
    default:
      return isLineLabel(label)
        ? t('panels:references.ref.line', 'line {{name}}', { name: label })
        : t('panels:references.ref.point', 'point {{name}}', { name: label });
  }
}

/**
 * The instruction for one step. Unknown axioms (the core's enum is closed, so
 * this is a wire-shape change) fall back to naming the fold and its inputs
 * rather than inventing a Huzita–Justin reading.
 */
export function describeStep(t: TFunction, step: ExtractedStep): string {
  const { points, lines } = splitStepInputs(step);
  const name = (label: string | undefined) => (label ? referenceName(t, label) : '?');
  const x = step.label || '?';
  const p0 = name(points[0]);
  const p1 = name(points[1]);
  const l0 = name(lines[0]);
  const l1 = name(lines[1]);
  let sentence: string;
  switch (step.axiom) {
    case 0:
      sentence = t('panels:references.step.mark', 'Mark {{x}} where {{l0}} meets {{l1}}.', {
        x,
        l0,
        l1,
      });
      break;
    case 1:
      sentence = t('panels:references.step.axiom1', 'Fold {{x}} through {{p0}} and {{p1}}.', {
        x,
        p0,
        p1,
      });
      break;
    case 2:
      sentence = t('panels:references.step.axiom2', 'Fold {{x}}, bringing {{p0}} onto {{p1}}.', {
        x,
        p0,
        p1,
      });
      break;
    case 3:
      sentence = t('panels:references.step.axiom3', 'Fold {{x}}, bringing {{l0}} onto {{l1}}.', {
        x,
        l0,
        l1,
      });
      break;
    case 4:
      sentence = t(
        'panels:references.step.axiom4',
        'Fold {{x}} through {{p0}}, folding {{l0}} onto itself.',
        { x, p0, l0 }
      );
      break;
    case 5:
      sentence = t(
        'panels:references.step.axiom5',
        'Fold {{x}} through {{p1}}, bringing {{p0}} onto {{l0}}.',
        { x, p0, p1, l0 }
      );
      break;
    case 6:
      sentence = t(
        'panels:references.step.axiom6',
        'Fold {{x}}, bringing {{p0}} onto {{l0}} and {{p1}} onto {{l1}}.',
        { x, p0, p1, l0, l1 }
      );
      break;
    case 7:
      // O7 alone serialises its lines the other way round: the self-folded
      // line arrives in `l1` and the landing line in `l0`. The placeholders are
      // named by role so a translator cannot re-plant the swap.
      sentence = t(
        'panels:references.step.axiom7',
        'Fold {{x}}, folding {{lSelf}} onto itself so that {{p0}} lands on {{lLand}}.',
        { x, p0, lSelf: l1, lLand: l0 }
      );
      break;
    default:
      sentence = t('panels:references.step.unknown', 'Fold {{x}} using {{inputs}}.', {
        x,
        inputs: step.inputs.map((label) => referenceName(t, label)).join(', '),
      });
  }
  if (step.pinch) {
    return `${sentence} ${t('panels:references.step.pinch', 'Pinch only — just the mark is needed.')}`;
  }
  return sentence;
}

// ---------------------------------------------------------------------------
// Planner steps
// ---------------------------------------------------------------------------
//
// The planner does not label its references the way ReferenceFinder does; it
// ships **typed refs** (`crates/oristudio-precrease/src/predicates.rs`), which
// is what lets a sentence say "the crease from step 12" and "where step 3
// meets step 12" instead of "line C" and "point P". Resolving one needs the
// whole sequence — a state line id becomes a step id through `sequence.lines`,
// and an edge's side and a corner's name are carried only on the refs
// themselves — so the lookups are built once per sequence.

/**
 * The instruction for one planner step, from its chosen witness.
 *
 * Every reference is named by the **letter the card gives it** — lines and
 * edges `A B C…`, marks and corners `P Q R…`, in the axiom's own input order —
 * from the same function the card uses (`diagram/inputLetters`), so a letter
 * here is the letter on the picture by construction. It used to say things
 * like "where the crease from step 3 meets the crease from step 10", which
 * asks the reader to remember two earlier steps; a letter asks them to look.
 *
 * The witness's `inputs` are in the axiom's own order (`predicates.rs`), which
 * is not ReferenceFinder's, so this is a separate reading rather than a reuse
 * of {@link describeStep}: O5 is `[pivot, p, m]` here and `[p, pivot, m]` there.
 */
export function describePlannerStep(
  t: TFunction,
  sequence: PrecreaseSequence,
  stepIndex: number,
  twin?: number
): string {
  const step = sequence.steps[stepIndex];
  if (!step) return '';
  // A grid step is a pleat, not a sighted fold: it has no witness, and every
  // line of the family is in it.
  if (step.kind === 'grid' && step.grid) return describeGridStep(t, step.grid);
  // A press reads as the fold that made its line — it carries that fold's
  // witness — and says how much of it to press, below, like any pinch.
  const witness = chosenWitness(step);
  if (!witness) {
    return t('panels:references.planStep.free', 'This line is already on the sheet.');
  }
  let sentence = witnessClause(t, sequence, step, witness, inputLetters(witness.inputs));
  // The mirror image of the same alignment, when the paper offers one: a
  // second pair for the same fold, so both ends of a long fold are lined up
  // at once. Its letters carry on from the first's, as they do on the card.
  if (step.also) {
    const corner =
      witness.axiom === 4 ? perpendicularMotion(sequence, unitFrame(sequence), step, witness) : null;
    const clause = witnessClause(
      t,
      sequence,
      step,
      step.also,
      alsoLetters(witness.inputs, !!corner && !corner.ontoItself, step.also.inputs)
    );
    sentence = `${sentence} ${clause} ${t('panels:references.planStep.alsoNote', 'Line up both at once, so the fold stays straight.')}`;
  }
  // The twin: the fold made at once with this one, its mirror image. Named
  // with the next letters, as the card letters it — in one sentence where
  // the pair has one ("Fold P onto Q and R onto S."), else in two.
  const twinStep = twin === undefined ? undefined : sequence.steps[twin];
  const twinWitness = twinStep ? chosenWitness(twinStep) : null;
  if (twinStep && twinWitness) {
    const corner =
      witness.axiom === 4 ? perpendicularMotion(sequence, unitFrame(sequence), step, witness) : null;
    const letters = alsoLetters(witness.inputs, !!corner && !corner.ontoItself, twinWitness.inputs);
    const first = inputLetters(witness.inputs);
    const paired = twinSentence(t, witness, first, twinWitness, letters);
    sentence =
      paired ?? `${sentence} ${witnessClause(t, sequence, twinStep, twinWitness, letters)}`;
  }
  // The fold is an interior point lined up on another — one a folder makes
  // by sighting through the paper — and nothing else was on the paper to
  // make it from. Say so, rather than present it as a fold like any other.
  if (step.impractical) {
    sentence = `${sentence} ${t('panels:references.planStep.impractical', 'Neither point is on an edge, so this one is lined up through the paper — nothing on the sheet makes it a cleaner fold yet.')}`;
  }
  // A reference the paper does not carry yet. The planner prefers a witness it
  // can sight, so this is the residue where none of the recorded ones works —
  // and saying nothing would be telling the folder to bring a corner to a point
  // that is not there.
  if (!step.marks_exist) {
    sentence =
      step.missing_marks.length > 0
        ? `${sentence} ${t('panels:references.planStep.markFirst', 'One of these marks is where two creases would cross if they ran further — pinch it in first.')}`
        : // The marks are there; what is missing is crease to line up
          // against — a line folded onto itself that ends at the fold, say.
          `${sentence} ${t('panels:references.planStep.noAlignment', 'Nothing on the paper lines up with this fold yet — crease it as drawn.')}`;
  }
  // The creases line up, but over less than a pinch: the planner found no
  // witness it could press into a longer one, so the fold is made from what
  // there is. Say so rather than let the card imply a clean alignment.
  if (step.alignment !== undefined && step.alignment < SHORT_ALIGNMENT - 1e-9) {
    sentence = `${sentence} ${t('panels:references.planStep.shortAlignment', 'The creases line up only briefly here — align with care.')}`;
  }
  // A fold with no exact construction is made by the closest one there was,
  // and the error is said in the sheet's own terms. One sighted from such a
  // crease inherits it, and says that instead — the error does not go away
  // by being inherited.
  if (step.approximation !== undefined) {
    sentence = `${sentence} ${t('panels:references.planStep.approximate', 'Approximate — this construction is off by {{pct}}% of the sheet.', {
      pct: percentOfSheet(step.approximation),
    })}`;
  } else if (!step.exact) {
    sentence = `${sentence} ${t('panels:references.planStep.inherited', 'Sighted from an approximate crease, so only as exact as that is.')}`;
  }
  // Crease made past the pattern's own line — a stretch, or a pinch at a
  // crossing — because a later step uses the line there: said, so the folder
  // does not stop at the pattern.
  if (step.pressed_on.length > 0) {
    sentence = `${sentence} ${t('panels:references.planStep.pressedOn', 'Also crease where shown past the pattern’s line — a later step uses it there.')}`;
  }
  // A press that runs out to a findable end is more than a pinch: that stretch
  // of crease is needed, and the card draws exactly it.
  if (step.kind === 'press' && step.press?.sighted_from === null) {
    return `${sentence} ${t('panels:references.planStep.pressOut', 'Crease only the part shown.')}`;
  }
  if (step.extent.kind === 'pinches') {
    return `${sentence} ${t('panels:references.planStep.pinch', 'Pinch only — just the mark is needed.')}`;
  }
  if (step.kind === 'aux' && step.visible) {
    return `${sentence} ${t('panels:references.planStep.visibleAux', 'This crease will show in the finished model.')}`;
  }
  // A line whose creases are not all one way is creased whichever way most of
  // its length wants (plan D21). Say so whenever that is true — not only when
  // it is close — rather than let the card imply the finished assignment falls
  // out of the precrease. An 84%-mountain line is dishonest in the same way a
  // 55% one is, just less often.
  // Only a pattern line has a share; an auxiliary fold's is exactly 0.
  if (step.kind === 'cp' && step.direction_share > 0 && step.direction_share < 1) {
    return `${sentence} ${t('panels:references.planStep.partlyReversed', 'This line is creased both ways in the pattern — the rest reverses as the model collapses.')}`;
  }
  return sentence;
}

/**
 * One sentence for a twin pair of the common kinds — two points onto two
 * points, two lines onto two lines, two creases through two pairs of marks
 * — or null when the pair reads better as two sentences.
 */
function twinSentence(
  t: TFunction,
  witness: PrecreaseWitness,
  first: InputLetters,
  twin: PrecreaseWitness,
  second: InputLetters
): string | null {
  if (witness.axiom !== twin.axiom) return null;
  const a = (which: number) => first.byInput[which] ?? '?';
  const c = (which: number) => second.byInput[which] ?? '?';
  // The same references on both sides — each half of the top edge onto the
  // centre line — is one instruction with "both sides" in it, not "A onto
  // B and A onto B".
  const same =
    first.byInput.length === second.byInput.length &&
    first.byInput.every((letter, i) => letter === second.byInput[i]);
  if (same && (witness.axiom === 2 || witness.axiom === 3)) {
    return t('panels:references.planStep.twinBothSides', 'Fold {{a}} onto {{b}} on both sides.', {
      a: a(0),
      b: a(1),
    });
  }
  switch (witness.axiom) {
    case 1:
      return t(
        'panels:references.planStep.twinAxiom1',
        'Fold through {{a}} and {{b}}, and through {{c}} and {{d}}.',
        { a: a(0), b: a(1), c: c(0), d: c(1) }
      );
    case 2:
    case 3:
      return t(
        'panels:references.planStep.twinAxiom2',
        'Fold {{a}} onto {{b}} and {{c}} onto {{d}}.',
        { a: a(0), b: a(1), c: c(0), d: c(1) }
      );
    default:
      return null;
  }
}

/**
 * The instruction one witness gives, with the letters the card gave its
 * references — {@link describePlannerStep} for the chosen witness and again
 * for its mirror image.
 */
function witnessClause(
  t: TFunction,
  sequence: PrecreaseSequence,
  step: PrecreaseStep,
  witness: PrecreaseWitness,
  letters: InputLetters
): string {
  const name = (which: number) => letters.byInput[which] ?? '?';
  let sentence: string;
  switch (witness.axiom) {
    case 1:
      sentence = t('panels:references.planStep.axiom1', 'Fold through {{a}} and {{b}}.', {
        a: name(0),
        b: name(1),
      });
      break;
    case 2:
      sentence = t('panels:references.planStep.axiom2', 'Fold {{a}} onto {{b}}.', {
        a: name(0),
        b: name(1),
      });
      break;
    case 3:
      sentence = t('panels:references.planStep.axiom3', 'Fold {{a}} onto {{b}}.', {
        a: name(0),
        b: name(1),
      });
      break;
    case 4: {
      // The card draws a perpendicular as a folder makes one — hold the mark,
      // swing a corner onto the line's other arm — when it can find that
      // corner, and letters it. Say the same thing it shows. A perpendicular
      // to the sheet's edge is the edge folded onto itself through the mark,
      // which is how a diagram says it, and the card shows the whole edge.
      const corner = perpendicularMotion(sequence, unitFrame(sequence), step, witness);
      sentence = corner && !corner.ontoItself
        ? t(
            'panels:references.planStep.axiom4Corner',
            'Fold through {{p}}, bringing {{q}} onto {{a}}.',
            { p: name(0), q: letters.nextPoint, a: name(corner.lineAt) }
          )
        : t('panels:references.planStep.axiom4', 'Fold through {{a}}, folding {{b}} onto itself.', {
            a: name(0),
            b: name(1),
          });
      break;
    }
    case 5:
      // `[pivot, p, m1]`. Which of the mark and the line swings over is the
      // crate's call (`who_moves`): a mark on the edge is brought onto the
      // line; a line on the edge is brought onto the mark — and the card's
      // arrow goes the same way, so the caption has to.
      sentence = witness.who_moves.includes(2)
        ? t(
            'panels:references.planStep.axiom5LineMoves',
            'Fold through {{a}}, bringing {{c}} onto {{b}}.',
            { a: name(0), b: name(1), c: name(2) }
          )
        : t(
            'panels:references.planStep.axiom5',
            'Fold through {{a}}, bringing {{b}} onto {{c}}.',
            { a: name(0), b: name(1), c: name(2) }
          );
      break;
    case 6:
      sentence = t(
        'panels:references.planStep.axiom6',
        'Fold {{a}} onto {{b}} and {{c}} onto {{d}}.',
        { a: name(0), b: name(1), c: name(2), d: name(3) }
      );
      break;
    case 7:
      // The crate's O7 is `[p, m1, m2]`: `p` lands on `m1`, and the crease is
      // perpendicular to `m2` — so `m2` is the line folded onto itself. The
      // placeholders are named by role, as the ReferenceFinder sentence's are,
      // because this once had the two lines the other way round and the card's
      // arrow disagreed with its caption.
      sentence = witness.who_moves.includes(1)
        ? t(
            'panels:references.planStep.axiom7LineMoves',
            'Fold {{lSelf}} onto itself so that {{lLand}} lands on {{p}}.',
            { p: name(0), lLand: name(1), lSelf: name(2) }
          )
        : t(
            'panels:references.planStep.axiom7',
            'Fold {{lSelf}} onto itself so that {{p}} lands on {{lLand}}.',
            { p: name(0), lLand: name(1), lSelf: name(2) }
          );
      break;
    default:
      sentence = t('panels:references.planStep.unknown', 'Fold using {{inputs}}.', {
        inputs: letters.byInput.join(', '),
      });
  }
  return sentence;
}

/**
 * The instruction for a grid step: one family of the precrease grid, pleated
 * edge to edge.
 *
 * Said the way a folder says it — "into 16ths", which way, how many lines, and
 * the alternation with its phase (the family's first line, by index) — because
 * the card draws every line of the family and the sentence's job is the count
 * and the rhythm. When the pattern wants some of the lines the other way it
 * says how many: they are creased as the pleat makes them and reverse as the
 * model collapses, and a folder who is not told reads the finished assignment
 * off the precrease.
 */
export function describeGridStep(t: TFunction, grid: PrecreaseGridStep): string {
  // `directionOfGroup` takes the normal's angle, as the groups carry it.
  const direction = describeDirection(
    t,
    directionOfGroup(Math.atan2(grid.normal[1], grid.normal[0]))
  );
  const ordinal = (n: number) =>
    t('panels:references.planStep.gridFraction', {
      count: n,
      ordinal: true,
      defaultValue_ordinal_one: '{{count}}sts',
      defaultValue_ordinal_two: '{{count}}nds',
      defaultValue_ordinal_few: '{{count}}rds',
      defaultValue_ordinal_other: '{{count}}ths',
    });
  // An axis family runs edge to edge in whole strips — "into 16ths". An
  // oblique family of a hex grid divides nothing whole, so it is said by its
  // spacing: one cell of the grid apart.
  const pleat =
    grid.cells !== null
      ? t('panels:references.planStep.gridPleatInto', 'Pleat the sheet into {{fraction}} {{direction}}', {
          fraction: ordinal(grid.cells),
          direction,
        })
      : t(
          'panels:references.planStep.gridPleatSpaced',
          'Pleat the sheet {{direction}}, one {{cell}} of the sheet apart',
          {
            cell: t('panels:references.planStep.gridCell', {
              count: grid.n,
              ordinal: true,
              defaultValue_ordinal_one: '{{count}}st',
              defaultValue_ordinal_two: '{{count}}nd',
              defaultValue_ordinal_few: '{{count}}rd',
              defaultValue_ordinal_other: '{{count}}th',
            }),
            direction,
          }
        );
  const count = grid.lines.length;
  if (!grid.pleat) return describeGridBands(t, grid, ordinal(grid.level), direction);
  const sentence =
    grid.lines[0]?.direction === 'valley'
      ? t('panels:references.planStep.gridValleyFirst', {
          count,
          pleat,
          defaultValue_one:
            '{{pleat}}: {{count}} line, alternating valley and mountain, valley first.',
          defaultValue_other:
            '{{pleat}}: {{count}} lines, alternating valley and mountain, valley first.',
        })
      : t('panels:references.planStep.gridMountainFirst', {
          count,
          pleat,
          defaultValue_one:
            '{{pleat}}: {{count}} line, alternating mountain and valley, mountain first.',
          defaultValue_other:
            '{{pleat}}: {{count}} lines, alternating mountain and valley, mountain first.',
        });
  if (grid.reversed === 0) return sentence;
  return `${sentence} ${t('panels:references.planStep.gridReversed', {
    count: grid.reversed,
    defaultValue_one:
      'The pattern wants {{count}} of them the other way; it reverses as the model collapses.',
    defaultValue_other:
      'The pattern wants {{count}} of them the other way; they reverse as the model collapses.',
  })}`;
}

/**
 * A position across the sheet as the fraction it is, in lowest terms — "3/16"
 * — found by the smallest denominator up to a 64-grid's that names it, since
 * a bound carries its share of the side and not its family's cells.
 */
export function gridFraction(fraction: number): string {
  for (let q = 1; q <= 64; q += 1) {
    const p = Math.round(fraction * q);
    if (Math.abs(p / q - fraction) < 1e-9) return `${p}/${q}`;
  }
  return fraction.toFixed(2);
}

/**
 * A band's bound in a sentence: the line the folder can see, the sheet's
 * edge, or — for an odd base's band, which no halving made — a position
 * across the sheet.
 */
function describeGridBound(
  t: TFunction,
  grid: PrecreaseGridStep,
  bound: PrecreaseGridBound,
  /** Across the family's own lines, or along them (the other family's). */
  across = true
): string {
  switch (bound.edge) {
    case 'left':
      return t('panels:references.ref.leftEdge', 'the left edge');
    case 'right':
      return t('panels:references.ref.rightEdge', 'the right edge');
    case 'bottom':
      return t('panels:references.ref.bottomEdge', 'the bottom edge');
    case 'top':
      return t('panels:references.ref.topEdge', 'the top edge');
    case null:
      break;
  }
  const vertical = Math.abs(grid.normal[0]) >= Math.abs(grid.normal[1]) === across;
  const fraction = grid.cells === null ? String(bound.index) : gridFraction(bound.fraction);
  if (bound.line_id !== null) {
    return t('panels:references.planStep.gridBoundLine', 'the {{fraction}} line', { fraction });
  }
  return vertical
    ? t('panels:references.planStep.gridBoundAcross', '{{fraction}} of the way across', {
        fraction,
      })
    : t('panels:references.planStep.gridBoundUp', '{{fraction}} of the way up', { fraction });
}

/**
 * A grid step that is not a pleat: one level's lines, in the bands the
 * pattern needs them in, each made the way the pattern wants it — "Add the
 * 32nds vertically between the 1/4 and 3/4 lines: 8 lines, creased as
 * shown." — and, when a band is creased only part way along its lines, how
 * far: "from the 3/8 line to the 5/8 line".
 */
function describeGridBands(
  t: TFunction,
  grid: PrecreaseGridStep,
  level: string,
  direction: string
): string {
  const bands = grid.regions.map((region) => {
    const band = t('panels:references.planStep.gridBand', 'between {{lo}} and {{hi}}', {
      lo: describeGridBound(t, grid, region.bounds[0]),
      hi: describeGridBound(t, grid, region.bounds[1]),
    });
    if (!region.along) return band;
    return t('panels:references.planStep.gridBandAlong', '{{band}}, from {{lo}} to {{hi}}', {
      band,
      lo: describeGridBound(t, grid, region.along[0], false),
      hi: describeGridBound(t, grid, region.along[1], false),
    });
  });
  const where = bands.join(t('panels:references.planStep.gridBandsAnd', ', and '));
  return t('panels:references.planStep.gridBands', {
    count: grid.lines.length,
    level,
    direction,
    where,
    defaultValue_one: 'Add the {{level}} {{direction}} {{where}}: {{count}} line, creased as shown.',
    defaultValue_other:
      'Add the {{level}} {{direction}} {{where}}: {{count}} lines, creased as shown.',
  });
}

/** How a direction reads in a row's sentence. */
export function describeDirection(t: TFunction, direction: ReferencesDirection): string {
  switch (direction.kind) {
    case 'horizontal':
      return t('panels:references.direction.horizontal', 'horizontally');
    case 'vertical':
      return t('panels:references.direction.vertical', 'vertically');
    case 'diagonal-up':
      return t('panels:references.direction.diagonalUp', 'on the rising diagonal');
    case 'diagonal-down':
      return t('panels:references.direction.diagonalDown', 'on the falling diagonal');
    case 'angle':
      return t('panels:references.direction.angle', 'at {{deg}}°', { deg: direction.degrees });
  }
}

/** The axiom a row's steps use, as a folder would name the move. */
export function describeAxiom(t: TFunction, axiom: number): string {
  switch (axiom) {
    case 1:
      return t('panels:references.axiom.o1', 'through two points');
    case 2:
      return t('panels:references.axiom.o2', 'point onto point');
    case 3:
      return t('panels:references.axiom.o3', 'edge onto edge');
    case 4:
      return t('panels:references.axiom.o4', 'perpendicular through a point');
    case 5:
      return t('panels:references.axiom.o5', 'point onto a line, through a point');
    case 6:
      return t('panels:references.axiom.o6', 'two points onto two lines');
    case 7:
      return t('panels:references.axiom.o7', 'point onto a line, perpendicular');
    default:
      return t('panels:references.axiom.free', 'already on the sheet');
  }
}

/**
 * A distance in the planner's unit frame as a percentage of the sheet, with
 * enough digits to tell 0.05 % from 0.5 %, never a wall of them.
 */
function percentOfSheet(distance: number): string {
  const pct = distance * 100;
  if (pct >= 1) return pct.toFixed(1);
  if (pct >= 0.1) return pct.toFixed(2);
  return pct.toPrecision(2);
}
