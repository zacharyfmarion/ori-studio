/**
 * The sentence for one Fold step: "Valley fold in half, bringing the top-right
 * corner onto the bottom-left corner, through all layers."
 *
 * A sentence is the verb, how the line was found and which layers the fold
 * takes, and each of the three changes word order somewhere: a verb goes last
 * in ja and ko, and "only the top two layers" is the object in de and zh but a
 * trailing clause in en. So every combination is a whole sentence of its own
 * (`stepSentenceCatalog`), never clauses joined here (plan D14). What is
 * interpolated is only what a sentence *names*, in `lib/foldSentences`'
 * shared vocabulary: the sheet's own edges, corners and diagonals by
 * description, anything else by its letter.
 *
 * A precrease of part of its line is its precrease's sentence followed by a
 * second whole sentence saying how much of it is creased ("Crease only a
 * short pinch at point R."): one key that takes the first sentence whole, so
 * each language joins the two its own way, and no extent multiplies the
 * precrease's sentences by its own.
 *
 * Inputs are the step's anchors as the axiom reads them, in the crate's axiom
 * order (`oristudio-geometry`'s `Construction`, plan D6): O1 `[p, q]`, O2
 * `[p, q]`, O3 `[m1, m2]`, O4 `[p, m]`, O5 `[pivot, p, m1]`, O6
 * `[p1, m1, p2, m2]`, O7 `[p, m1, m2]`. A pair one fold brings together is
 * named mover first, the one the arrow and the animation move
 * (`moverFirst`).
 *
 * Pure and React-free, so a Diagram link can store the sentence a step had
 * (plan D17).
 */
import type { TFunction } from 'i18next';
import {
  cornerName,
  diagonalName,
  edgeName,
  letterInputs,
  letteredName,
  moverFirst,
  type FoldAxiom,
  type InputLetters,
  type ReferenceKind,
  type SheetCorner,
  type SheetDiagonal,
  type SheetSide,
} from '../lib/foldSentences';
import type { TurnKind } from '../lib/steps/turn';
import { turnName } from '../lib/steps/turnWords';
import type { FoldVertexOpKind } from './document/foldSequenceDocument';
import { vertexSentence } from './stepSentenceVertex';
import {
  crimpSentence,
  plainFoldSentence,
  reverseFoldSentence,
  unfoldSentence,
  type CrimpSecondLine,
  type PlainFoldSentenceOp,
  type SentenceClause,
  type SentenceLine,
} from './stepSentenceCatalog';

/** A plain fold's direction as the viewer sees it (the engine's `Direction`). */
export type FoldDirection = 'valley' | 'mountain';

/**
 * A reference an axiom reads, as a sentence names it. The sheet's own are
 * named by description, so the caller decides one is that only where a
 * reader would agree — on the flat sheet, or the silhouette's own corner —
 * in the frame the step's picture is drawn in. Anything else is a point (a
 * mark, a vertex, a crossing) or a line (a crease), named by its letter.
 */
export type FoldSentenceReference =
  | { kind: 'corner'; corner: SheetCorner }
  | { kind: 'edge'; side: SheetSide }
  | { kind: 'diagonal'; diagonal: SheetDiagonal }
  | { kind: 'point' }
  | { kind: 'line' };

/** How a step's line was found: plan D18's `via`. */
export type FoldSentenceLine =
  /** Two points the user placed. */
  | { via: 'free' }
  /** An existing crease or bend, snapped to. */
  | { via: 'crease' }
  | {
      via: 'axiom';
      axiom: FoldAxiom;
      /** In the crate's axiom order. */
      inputs: readonly FoldSentenceReference[];
      /** The indices of the inputs on the moving side; none keeps the axiom's order. */
      moving?: readonly number[];
      /**
       * The fold lays one half of the layers it moves exactly onto the other:
       * "in half". Said only where a folder brings one thing onto another
       * (O2, O3), which is how a half fold is made.
       */
      inHalf?: boolean;
    };

/** Which layers a fold takes: plan D6's seed, D18's `layer_scope`. */
export type FoldLayerScope =
  | { kind: 'all' }
  /** The top `layers` (the bottom ones for a mountain fold), at a point. */
  | { kind: 'depth'; layers: number }
  /** Picked flaps. */
  | { kind: 'flaps'; flaps: number };

/** Which way a point sinks, or the unsink back. */
export type FoldSinkSentenceKind = 'open' | 'closed' | 'unsink';

/**
 * How a vertex fold named what it takes: a petal fold's hinge — a crease
 * already there, or two points the fold creases — and a swivel's form: by
 * its rays, by its valley and mountain, or by its edge, with the line it
 * lands on (a crease or edge, or the line through two points) and the ridge
 * it rose along (square to the edge, or toward its end).
 */
export type FoldVertexSentenceForm =
  | { hinge: 'crease' | 'points' }
  /** A squash about a drawn hinge: only the flap's end beyond it squashes. */
  | { squashHinge: 'line' }
  | { swivel: 'rays' }
  /**
   * A swivel by its valley and mountain on the layer that faces the viewer:
   * its letters are the viewer's, so it never folds behind. `inside` for the
   * inside swivel, its strip tucked under.
   */
  | { swivel: 'valley-mountain'; inside?: true }
  | { swivel: 'edge'; target: 'crease' | 'free'; ridge: 'foot' | 'end' }
  /**
   * A swivel by its edge whose creases meet on a folded edge: no ridge to
   * choose. `inside` for the inside swivel, its strip tucked between the two
   * layers; absent for the open one.
   */
  | { swivel: 'fold'; target: 'crease' | 'free'; inside?: true };

/**
 * How much of its line a precrease creased, when it was not all of it: a
 * pinch at a point of the line, or the stretch between two. Its points are
 * named as an axiom's inputs are, lettered after the line's own.
 */
export type FoldSentenceExtent =
  | { kind: 'pinch'; at: FoldSentenceReference }
  | { kind: 'segment'; from: FoldSentenceReference; to: FoldSentenceReference };

/** A step as its sentence reads it. */
export type FoldSentenceStep =
  /** `behind`: its mirror reversed the layers, so the range was folded on the back. */
  | { op: 'repeat'; count: number; behind?: true }
  | { op: 'unfold-to'; sheet: boolean; number?: number }
  | { op: 'fold'; direction: FoldDirection; line: FoldSentenceLine; scope: FoldLayerScope; inserted?: boolean }
  /**
   * Fold and unfold: the creases stay, flat, remembering their letters — or,
   * with an extent, only part of the line is creased.
   */
  | { op: 'precrease'; direction: FoldDirection; line: FoldSentenceLine; scope: FoldLayerScope; extent?: FoldSentenceExtent }
  /**
   * A fold along a bend that lays its layers flat again (plan D3): always
   * along an existing crease, so it has no line to describe.
   */
  | { op: 'unfold'; direction: FoldDirection; scope: FoldLayerScope }
  | { op: 'turn'; turn: TurnKind }
  /** Import CP: the state jumps to an imported crease pattern's (plan D16). */
  | { op: 'cp-jump'; collapse?: boolean }
  /** A reverse fold along a line (plan Phase 9), its layers the tip's anchor, counted from the top. */
  | { op: 'reverse'; kind: 'inside' | 'outside'; line: FoldSentenceLine; scope: FoldLayerScope }
  /**
   * Two reverse folds of one kind as one step (plan Phase 11): its first line
   * as a reverse fold's is found, and its second, drawn or an existing crease;
   * its layers the tip's anchor, as a reverse fold's are.
   */
  | { op: 'pleat'; line: FoldSentenceLine; second: FoldSentenceLine; scope: FoldLayerScope }
  | { op: 'crimp'; crimp: 'inside' | 'outside'; line: FoldSentenceLine; second: CrimpSecondLine; scope: FoldLayerScope }
  /**
   * A fold slid under the chosen layer (a valley) or over it (a mountain), as
   * the viewer sees it, along its line (which its Step pane row names).
   */
  | { op: 'tuck'; direction: FoldDirection; line: FoldSentenceLine }
  /**
   * A vertex fold (plan Phase 11): its creases are its own, so it names no
   * line (`stepSentenceVertex`) — but a petal fold says how its hinge was
   * named, and a swivel its form (`form`).
   */
  | { op: 'vertex'; fold: FoldVertexOpKind; direction: FoldDirection; form?: FoldVertexSentenceForm }
  /** A sink of the point a seed names, or the unsink of a sunk one (plan Phase 11). */
  | { op: 'sink'; kind: FoldSinkSentenceKind; line: FoldSentenceLine }
  /** An operation a newer build wrote: locked, never described (plan D6). */
  | { op: 'unknown' };

/** What each reference is lettered as: the sheet's corners are points, its edges and diagonals lines. */
function referenceKind(reference: FoldSentenceReference): ReferenceKind {
  return reference.kind === 'corner' || reference.kind === 'point' ? 'point' : 'line';
}

/**
 * The letters a step's inputs go by, by position and kind alone (the
 * `lib/foldSentences` scheme): what the step's picture letters its references
 * with, so a letter in the sentence is the letter on the picture by
 * construction. Every input takes one, the sheet's own too, though the
 * sentence names those by description.
 */
export function sentenceInputLetters(inputs: readonly FoldSentenceReference[]): InputLetters {
  return letterInputs(inputs.map(referenceKind));
}

/** A precrease extent's points, in order: a pinch's centre, a segment's two ends. */
export function extentReferences(extent: FoldSentenceExtent): FoldSentenceReference[] {
  return extent.kind === 'pinch' ? [extent.at] : [extent.from, extent.to];
}

/**
 * The letters a precrease extent's points go by: after the line's own inputs
 * (an axiom's; none for a free line or a crease), in the same scheme, so the
 * picture and the sentence letter them alike.
 */
export function sentenceExtentLetters(line: FoldSentenceLine, extent: FoldSentenceExtent): string[] {
  const inputs = line.via === 'axiom' ? line.inputs : [];
  const points = extentReferences(extent);
  return sentenceInputLetters([...inputs, ...points]).byInput.slice(inputs.length);
}

/** A precrease's sentence with what of its line it creases said after it, a whole sentence of its own. */
function extentSentence(t: TFunction, sentence: string, line: FoldSentenceLine, extent: FoldSentenceExtent): string {
  const letters = sentenceExtentLetters(line, extent);
  const name = (reference: FoldSentenceReference, k: number) => {
    const letter = letters[k];
    return letter ? referenceName(t, reference, letter) : '?';
  };
  return extent.kind === 'pinch'
    ? t('panels:fold.sentence.extent.pinch', '{{sentence}} Crease only a short pinch at {{at}}.', {
        sentence,
        at: name(extent.at, 0),
      })
    : t('panels:fold.sentence.extent.segment', '{{sentence}} Crease only the stretch from {{from}} to {{to}}.', {
        sentence,
        from: name(extent.from, 0),
        to: name(extent.to, 1),
      });
}

/** One reference's name in a sentence. */
function referenceName(t: TFunction, reference: FoldSentenceReference, letter: string): string {
  switch (reference.kind) {
    case 'corner':
      return cornerName(t, reference.corner);
    case 'edge':
      return edgeName(t, reference.side);
    case 'diagonal':
      return diagonalName(t, reference.diagonal);
    case 'point':
    case 'line':
      return letteredName(t, reference.kind, letter);
  }
}

/** A clause that names nothing: a free line, or an existing crease. */
const NO_NAMES: SentenceClause['names'] = { a: '', b: '', c: '', d: '', self: '' };

/**
 * The names an axiom's sentence interpolates, by role: `a`/`b` the first pair
 * (mover, then where it lands), `c`/`d` O6's second pair, O5's pivot as `a`,
 * and O7's line folded onto itself as `self`. A missing input reads "?", as
 * References' sentences do, rather than shifting the others along.
 */
function axiomClause(
  t: TFunction,
  axiom: FoldAxiom,
  inputs: readonly FoldSentenceReference[],
  moving: readonly number[],
  inHalf: boolean
): SentenceClause {
  const letters = sentenceInputLetters(inputs).byInput;
  const name = (index: number) => {
    const reference = inputs[index];
    const letter = letters[index];
    return reference && letter ? referenceName(t, reference, letter) : '?';
  };
  /** Two inputs one fold brings together, mover first. */
  const pair = (first: number, second: number): [string, string] => {
    const [mover, target] = moverFirst(moving, [first, second]);
    return [name(mover), name(target)];
  };
  switch (axiom) {
    case 1:
      // A line through two points moves neither.
      return { line: 'o1', names: { ...NO_NAMES, a: name(0), b: name(1) } };
    case 2:
    case 3: {
      const [a, b] = pair(0, 1);
      const line: SentenceLine =
        axiom === 2 ? (inHalf ? 'o2Half' : 'o2') : inHalf ? 'o3Half' : 'o3';
      return { line, names: { ...NO_NAMES, a, b } };
    }
    case 4:
      // `[p, m]`: the crease goes through p, and m is folded onto itself.
      return { line: 'o4', names: { ...NO_NAMES, a: name(0), b: name(1) } };
    case 5: {
      // `[pivot, p, m1]`: p onto m1 — or m1 onto p, when the line is the one
      // on the moving side.
      const [b, c] = pair(1, 2);
      return { line: 'o5', names: { ...NO_NAMES, a: name(0), b, c } };
    }
    case 6: {
      const [a, b] = pair(0, 1);
      const [c, d] = pair(2, 3);
      return { line: 'o6', names: { ...NO_NAMES, a, b, c, d } };
    }
    case 7: {
      // `[p, m1, m2]`: p lands on m1, and m2 is folded onto itself.
      const [a, b] = pair(0, 1);
      return { line: 'o7', names: { ...NO_NAMES, a, b, self: name(2) } };
    }
  }
}

/** What the sentence says about the line, whichever operation it is. */
function lineClause(t: TFunction, line: FoldSentenceLine): SentenceClause {
  switch (line.via) {
    case 'free':
      return { line: 'free', names: NO_NAMES };
    case 'crease':
      return { line: 'crease', names: NO_NAMES };
    case 'axiom':
      return axiomClause(t, line.axiom, line.inputs, line.moving ?? [], line.inHalf === true);
  }
}

function plainOp(op: 'fold' | 'precrease', direction: FoldDirection): PlainFoldSentenceOp {
  if (op === 'fold') return direction;
  return direction === 'valley' ? 'valleyPrecrease' : 'mountainPrecrease';
}

/** The sentence for one step, in the reader's language. */
export function foldStepSentence(t: TFunction, step: FoldSentenceStep): string {
  switch (step.op) {
    case 'fold':
      if (step.inserted) return foldStepSentence(t, { op: 'tuck', direction: step.direction, line: step.line });
      return plainFoldSentence(t, plainOp(step.op, step.direction), lineClause(t, step.line), step.scope);
    case 'precrease': {
      const sentence = plainFoldSentence(t, plainOp(step.op, step.direction), lineClause(t, step.line), step.scope);
      // Part of the line only: the precrease as it is located, then how much of it is creased.
      return step.extent ? extentSentence(t, sentence, step.line, step.extent) : sentence;
    }
    case 'unfold':
      return unfoldSentence(t, step.direction, step.scope);
    case 'turn':
      // The turn's own words, shared with the Diagram's turn cards, made a
      // sentence by a key of its own so the full stop is the language's.
      return t('panels:fold.sentence.turn', '{{turn}}.', { turn: turnName(step.turn, t) });
    case 'repeat':
      if (step.behind)
        return t('panels:fold.repeat.sentenceBehind', {
          count: step.count,
          defaultValue_one: 'Repeat the previous operation behind.',
          defaultValue_other: 'Repeat the previous {{count}} operations behind.',
        });
      return t('panels:fold.repeat.sentence', {
        count: step.count,
        defaultValue_one: 'Repeat the previous operation on the other side.',
        defaultValue_other: 'Repeat the previous {{count}} operations on the other side.',
      });
    case 'unfold-to':
      return step.sheet ? t('panels:fold.return.sheetSentence', 'Unfold to the starting sheet, keeping all creases.')
        : step.number !== undefined ? t('panels:fold.return.numberedSentence', 'Return to step {{number}}, keeping all creases.', { number: step.number })
        : t('panels:fold.return.sentence', 'Return to the earlier folded pose, keeping all creases.');
    case 'cp-jump':
      return step.collapse ? t('panels:fold.sentence.collapse', 'Collapse along the saved crease pattern.') : t('panels:fold.sentence.cpJump', 'Collapse into the imported crease pattern.');
    case 'reverse':
      return reverseFoldSentence(t, step.kind, lineClause(t, step.line), step.scope);
    case 'pleat':
      return t('panels:fold.sentence.pleat', 'Pleat along the two lines: mountain first, then valley.');
    case 'crimp':
      return crimpSentence(t, step.crimp, lineClause(t, step.line), step.second, step.scope);
    case 'tuck':
      return step.direction === 'valley'
        ? t('panels:fold.sentence.tuckValley', 'Valley fold and tuck the flap in, under the chosen layer.')
        : t('panels:fold.sentence.tuckMountain', 'Mountain fold and tuck the flap in at the back, over the chosen layer.');
    case 'vertex':
      return vertexSentence(t, step.fold, step.direction, step.form);
    case 'sink':
      return sinkSentence(t, step.kind);
    case 'unknown':
      return t('panels:fold.sentence.unknown', 'A step made with a newer Ori Studio.');
  }
}

/** A sink's sentence: the line is the picture's, so the words name only the move. */
function sinkSentence(t: TFunction, kind: FoldSinkSentenceKind): string {
  switch (kind) {
    case 'open':
      return t('panels:fold.sentence.openSink', 'Open-sink the point: push its tip in, turning every layer inside out.');
    case 'closed':
      return t('panels:fold.sentence.closedSink', 'Closed-sink the point: push its tip in, its layers kept together.');
    case 'unsink':
      return t('panels:fold.sentence.unsink', 'Unsink the point: pull its tip back out.');
  }
}
