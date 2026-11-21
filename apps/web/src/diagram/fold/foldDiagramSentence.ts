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
  const words = precreaseWords(step);
  if (words !== 'pinch' && pointsOntoLines(step.line)) {
    return then(t, foldDiagramSentence(t, step), t('panels:diagram.fold.instruction.repeatEarlier', 'Repeat on the other side.'));
  }
  switch (words) {
    case 'valley':
      return t('panels:diagram.fold.instruction.precreaseBothSides', 'Fold and unfold on both sides.');
    case 'mountain':
      return t('panels:diagram.fold.instruction.mountainPrecreaseBothSides', 'Mountain fold and unfold on both sides.');
    case 'pinch':
      return t('panels:diagram.fold.instruction.pinchBothSides', 'Make a pinch on both sides.');
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
      if (pointsOntoLines(step.line) && step.extent?.kind !== 'pinch') {
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
      return t('panels:diagram.fold.instruction.collapse', 'Collapse.');
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

/**
 * A merged step's instruction (`foldPrecreaseMerge.ts`): the steps it is
 * made from — every step of the run but its mirror, the last — said once for
 * both sides, "Fold and unfold on both sides." A run of more than one kind
 * says each kind once, in the run's order. Only precreases merge today; a
 * valley or mountain fold would say "Valley fold on both sides.", and any
 * other step its own words.
 */
export function foldDiagramMergedSentence(t: TFunction, steps: readonly FoldSentenceStep[]): string {
  const said: string[] = [];
  for (const step of steps) {
    const words =
      step.op === 'precrease'
        ? bothSidesSentence(t, step)
        : step.op === 'fold' && !step.inserted
          ? step.direction === 'valley'
            ? t('panels:diagram.fold.instruction.valleyBothSides', 'Valley fold on both sides.')
            : t('panels:diagram.fold.instruction.mountainBothSides', 'Mountain fold on both sides.')
          : foldDiagramSentence(t, step);
    if (!said.includes(words)) said.push(words);
  }
  return said.reduce(
    (all, next) => (all === '' ? next : then(t, all, next)),
    ''
  );
}
