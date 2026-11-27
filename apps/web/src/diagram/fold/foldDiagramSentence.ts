/**
 * A Fold step's instruction as a Diagram step says it. Most steps name the
 * fold alone. Axiom 6 also names the points and lines its two arrows connect.
 *
 * Fold's own strip names what a step brings together by the letters Fold's
 * canvas draws on its references (`fold/stepSentence`). A Diagram step's
 * picture has no letters: its marks say where — the fold's line in its pen,
 * the circles at a crease's ends and at the points a fold brings together,
 * and the arrow between them — so the words say only what to do. Both read
 * the same `FoldSentenceStep`; this is the Diagram's variant of it.
 *
 * Every sentence is a whole sentence of its own key, "behind" and "on both
 * sides" included, so each language words each its own way.
 *
 * Pure and React-free.
 */
import type { TFunction } from 'i18next';
import type { FoldStateFrame } from '../../fold/sequence/foldStateFrame';
import { foldStepSentence, type FoldSentenceLine, type FoldSentenceStep } from '../../fold/stepSentence';
import { entirelyPrecreased } from './foldCreaseCoverage';

/** An Axiom 6 step entirely on existing creases takes the ordinary fold instruction. */
export function diagramCreaseWords(step: FoldSentenceStep, before: FoldStateFrame | null, after: FoldStateFrame | null): FoldSentenceStep {
  if ((step.op === 'fold' || step.op === 'precrease') && pointsOntoLines(step.line) && before && after && entirelyPrecreased(before, after)) {
    return { ...step, line: { via: 'crease' } };
  }
  return step;
}

function pointsOntoLines(line: FoldSentenceLine): boolean {
  return line.via === 'axiom' && line.axiom === 6 &&
    (!line.moving || (line.moving.includes(0) && line.moving.includes(2)));
}

function alignmentSentence(t: TFunction, direction: 'valley' | 'mountain'): string {
  return direction === 'valley'
    ? t('panels:diagram.fold.instruction.valleyPointsOntoLines', 'Valley fold the points onto the two indicated lines.')
    : t('panels:diagram.fold.instruction.mountainPointsOntoLines', 'Mountain fold the points onto the two indicated lines.');
}

function then(t: TFunction, first: string, next: string): string {
  return t('panels:diagram.fold.instruction.then', '{{first}} {{next}}', { first, next });
}

/** A precrease as an instruction says it: the whole line or a segment folded and unfolded, or a pinch. */
type PrecreaseWords = 'valley' | 'mountain' | 'pinch';

function precreaseWords(step: Extract<FoldSentenceStep, { op: 'precrease' }>): PrecreaseWords {
  return step.extent?.kind === 'pinch' ? 'pinch' : step.direction;
}

/** A precrease whose words name the points it brings onto lines (Axiom 6), not just the fold. */
function namesAlignment(step: Extract<FoldSentenceStep, { op: 'precrease' }>): boolean {
  return precreaseWords(step) !== 'pinch' && pointsOntoLines(step.line);
}

function precreaseSentence(t: TFunction, words: PrecreaseWords): string {
  switch (words) {
    case 'valley':
      return t('panels:diagram.fold.instruction.precrease', 'Fold and unfold.');
    case 'mountain':
      return t('panels:diagram.fold.instruction.mountainPrecrease', 'Mountain fold and unfold.');
    case 'pinch':
      return t('panels:diagram.fold.instruction.pinch', 'Make a pinch.');
  }
}

/** The same precrease made on both sides, said once: a merged step's words. */
function bothSidesSentence(t: TFunction, step: Extract<FoldSentenceStep, { op: 'precrease' }>): string {
  if (namesAlignment(step)) {
    return then(t, foldDiagramSentence(t, step), t('panels:diagram.fold.instruction.repeatEarlier', 'Repeat on the other side.'));
  }
  switch (precreaseWords(step)) {
    case 'valley':
      return t('panels:diagram.fold.instruction.precreaseBothSides', 'Fold and unfold on both sides.');
    case 'mountain':
      return t('panels:diagram.fold.instruction.mountainPrecreaseBothSides', 'Mountain fold and unfold on both sides.');
    case 'pinch':
      return t('panels:diagram.fold.instruction.pinchBothSides', 'Make a pinch on both sides.');
  }
}

/** The same precrease made in `count` places, three or more, said once. */
function allPlacesSentence(t: TFunction, words: PrecreaseWords, count: number): string {
  switch (words) {
    case 'valley':
      return t('panels:diagram.fold.instruction.precreaseAllPlaces', {
        count,
        defaultValue_one: 'Fold and unfold in {{count}} place.',
        defaultValue_other: 'Fold and unfold in all {{count}} places.',
      });
    case 'mountain':
      return t('panels:diagram.fold.instruction.mountainPrecreaseAllPlaces', {
        count,
        defaultValue_one: 'Mountain fold and unfold in {{count}} place.',
        defaultValue_other: 'Mountain fold and unfold in all {{count}} places.',
      });
    case 'pinch':
      return t('panels:diagram.fold.instruction.pinchAllPlaces', {
        count,
        defaultValue_one: 'Make a pinch in {{count}} place.',
        defaultValue_other: 'Make a pinch in all {{count}} places.',
      });
  }
}

/** A vertex fold's name, "behind" for one made on the paper at the back (a mountain one). */
function vertexSentence(t: TFunction, step: Extract<FoldSentenceStep, { op: 'vertex' }>): string {
  const behind = step.direction === 'mountain';
  switch (step.fold) {
    case 'squash':
      // About a drawn hinge: only the end squashes.
      if (step.form !== undefined && 'squashHinge' in step.form) {
        return behind
          ? t('panels:diagram.fold.instruction.squashEndBehind', 'Squash fold the end behind.')
          : t('panels:diagram.fold.instruction.squashEnd', 'Squash fold the end.');
      }
      return behind
        ? t('panels:diagram.fold.instruction.squashBehind', 'Squash fold behind.')
        : t('panels:diagram.fold.instruction.squash', 'Squash fold.');
    case 'petal':
      return behind
        ? t('panels:diagram.fold.instruction.petalBehind', 'Petal fold behind.')
        : t('panels:diagram.fold.instruction.petal', 'Petal fold.');
    case 'rabbit-ear':
      return behind
        ? t('panels:diagram.fold.instruction.rabbitEarBehind', 'Rabbit-ear fold behind.')
        : t('panels:diagram.fold.instruction.rabbitEar', 'Rabbit-ear fold.');
    case 'swivel': {
      const inside = step.form !== undefined && 'swivel' in step.form && 'inside' in step.form && step.form.inside === true;
      if (inside) {
        return behind
          ? t('panels:diagram.fold.instruction.insideSwivelBehind', 'Inside swivel fold behind.')
          : t('panels:diagram.fold.instruction.insideSwivel', 'Inside swivel fold.');
      }
      return behind
        ? t('panels:diagram.fold.instruction.swivelBehind', 'Swivel fold behind.')
        : t('panels:diagram.fold.instruction.swivel', 'Swivel fold.');
    }
  }
}

/** One Fold step's instruction in the Diagram, in the reader's language. */
export function foldDiagramSentence(t: TFunction, step: FoldSentenceStep): string {
  switch (step.op) {
    case 'fold':
      if (step.inserted) return foldDiagramSentence(t, { op: 'tuck', direction: step.direction, line: step.line });
      if (pointsOntoLines(step.line)) return alignmentSentence(t, step.direction);
      return step.direction === 'valley'
        ? t('panels:diagram.fold.instruction.valley', 'Valley fold.')
        : t('panels:diagram.fold.instruction.mountain', 'Mountain fold.');
    case 'precrease':
      if (namesAlignment(step)) {
        return then(t, alignmentSentence(t, step.direction), t('panels:diagram.fold.instruction.unfold', 'Unfold.'));
      }
      return precreaseSentence(t, precreaseWords(step));
    case 'unfold':
      return t('panels:diagram.fold.instruction.unfold', 'Unfold.');
    case 'repeat':
      // A range that ends before the step it is added after is no "last" steps of the Diagram's, whose
      // numbers are its own: the diagrammer's words without a count.
      if (step.earlier)
        return step.behind
          ? t('panels:diagram.fold.instruction.repeatEarlierBehind', 'Repeat behind.')
          : t('panels:diagram.fold.instruction.repeatEarlier', 'Repeat on the other side.');
      // The diagrammer's standard words for the steps folded again on the back.
      if (step.behind)
        return t('panels:diagram.fold.instruction.repeatBehind', {
          count: step.count,
          defaultValue_one: 'Repeat behind.',
          defaultValue_other: 'Repeat the last {{count}} steps behind.',
        });
      return t('panels:diagram.fold.instruction.repeat', {
        count: step.count,
        defaultValue_one: 'Repeat on the other side.',
        defaultValue_other: 'Repeat the last {{count}} steps on the other side.',
      });
    case 'unfold-to':
      return step.sheet
        ? t('panels:diagram.fold.instruction.unfoldAll', 'Unfold completely.')
        : step.number !== undefined
          ? t('panels:diagram.fold.instruction.unfoldToStep', 'Unfold to step {{number}}.', { number: step.number })
          : t('panels:diagram.fold.instruction.unfold', 'Unfold.');
    case 'cp-jump':
    case 'collapse':
      return t('panels:diagram.fold.instruction.collapse', 'Collapse.');
    // Only the layer order changes: no crease, so no arrow, and the diagrammer's words for it.
    case 'adjust-order':
      return t('panels:diagram.fold.instruction.adjustOrder', 'Rearrange the layers.');
    case 'reverse':
      return step.kind === 'inside'
        ? t('panels:diagram.fold.instruction.insideReverse', 'Inside reverse fold.')
        : t('panels:diagram.fold.instruction.outsideReverse', 'Outside reverse fold.');
    case 'pleat':
      return t('panels:diagram.fold.instruction.pleat', 'Pleat.');
    case 'crimp':
      return step.crimp === 'inside'
        ? t('panels:diagram.fold.instruction.insideCrimp', 'Inside crimp.')
        : t('panels:diagram.fold.instruction.outsideCrimp', 'Outside crimp.');
    case 'tuck':
      return step.direction === 'valley'
        ? t('panels:diagram.fold.instruction.tuck', 'Valley fold and tuck in.')
        : t('panels:diagram.fold.instruction.tuckBehind', 'Mountain fold and tuck in.');
    case 'vertex':
      return vertexSentence(t, step);
    case 'sink':
      return step.kind === 'open'
        ? t('panels:diagram.fold.instruction.openSink', 'Open sink.')
        : step.kind === 'closed'
          ? t('panels:diagram.fold.instruction.closedSink', 'Closed sink.')
          : t('panels:diagram.fold.instruction.unsink', 'Unsink.');
    // A turn is a turn between steps in the Diagram, and a newer build's step is never described: Fold's own words.
    case 'turn':
    case 'unknown':
      return foldStepSentence(t, step);
  }
}

/** One step's words, said for both sides of a merged step. */
function bothSidesWords(t: TFunction, step: FoldSentenceStep): string {
  if (step.op === 'precrease') return bothSidesSentence(t, step);
  if (step.op === 'fold' && !step.inserted) {
    return step.direction === 'valley'
      ? t('panels:diagram.fold.instruction.valleyBothSides', 'Valley fold on both sides.')
      : t('panels:diagram.fold.instruction.mountainBothSides', 'Mountain fold on both sides.');
  }
  return t('panels:diagram.fold.instruction.doBothSides', '{{sentence}} Do this on both sides.', {
    sentence: foldDiagramSentence(t, step),
  });
}

/** One step's words, said for every one of a merged step's `count` places, three or more. */
function allPlacesWords(t: TFunction, step: FoldSentenceStep, count: number): string {
  // An Axiom 6 precrease keeps its own words, said once for every place.
  if (step.op === 'precrease' && !namesAlignment(step)) return allPlacesSentence(t, precreaseWords(step), count);
  if (step.op === 'fold' && !step.inserted) {
    return step.direction === 'valley'
      ? t('panels:diagram.fold.instruction.valleyAllPlaces', {
          count,
          defaultValue_one: 'Valley fold in {{count}} place.',
          defaultValue_other: 'Valley fold in all {{count}} places.',
        })
      : t('panels:diagram.fold.instruction.mountainAllPlaces', {
          count,
          defaultValue_one: 'Mountain fold in {{count}} place.',
          defaultValue_other: 'Mountain fold in all {{count}} places.',
        });
  }
  return t('panels:diagram.fold.instruction.doAllPlaces', {
    count,
    sentence: foldDiagramSentence(t, step),
    defaultValue_one: '{{sentence}} Do this in {{count}} place.',
    defaultValue_other: '{{sentence}} Do this in all {{count}} places.',
  });
}

/**
 * A merged step's instruction: the steps it is made from, said once for the
 * places it folds — "Fold and unfold on both sides.", "Valley fold in all 4
 * places." `count` is how many places: two for a precrease and its Repeat,
 * whose words are the steps before the Repeat (`foldPrecreaseMerge.ts`); the
 * run's length for steps that mirror or turn each other, whose words are its
 * first step's (`foldStepMerge.ts`). A run of more than one kind says each
 * kind once, in the run's order.
 */
export function foldDiagramMergedSentence(t: TFunction, steps: readonly FoldSentenceStep[], count = 2): string {
  const said: string[] = [];
  for (const step of steps) {
    const words = count > 2 ? allPlacesWords(t, step, count) : bothSidesWords(t, step);
    if (!said.includes(words)) said.push(words);
  }
  return said.reduce(
    (all, next) => (all === '' ? next : then(t, all, next)),
    ''
  );
}
