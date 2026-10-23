/**
 * The vertex folds' words — squash, petal fold, rabbit ear, swivel (plan
 * Phase 11) — for `stepSentence` and `stepWords`: one whole sentence, one
 * operation name and one badge per fold, each a literal `t()` call so the
 * extractor sees it. A vertex fold names no line and no layer count (its
 * creases are its own, computed from the flap or the triangle), so each is
 * one sentence, not a table.
 *
 * The direction is said: a valley vertex fold folds the paper on top, toward
 * the viewer, and a mountain one the paper at the back, behind — the flap a
 * click names is the top one for a valley and the bottom one for a mountain
 * (`tools/vertex/vertexStep`). A mountain fold is said "behind", as a diagram
 * says it, in a sentence of its own. The badge is the fold's alone, as the
 * tuck's is.
 *
 * What a fold named besides is said where it changes the step: a petal fold
 * whose hinge is two points creases it as it lifts, which its sentence says;
 * a swivel by its edge lays the edge on a crease or a line, which its
 * sentence says, and the Step pane's rows say how each was named
 * ({@link vertexRows}): a petal fold's hinge, a swivel's target and ridge.
 *
 * React-free.
 */
import type { TFunction } from 'i18next';
import type { FoldDirection, FoldVertexOpKind } from './document/foldSequenceDocument';
import type { FoldVertexSentenceForm } from './stepSentence';

/** A swivel by its edge's sentence: the edge onto the crease or the line clicked, about its pivot. */
function swivelEdgeSentence(t: TFunction, direction: FoldDirection, target: 'crease' | 'free'): string {
  if (direction === 'mountain') {
    return target === 'crease'
      ? t('panels:fold.sentence.behind.swivelEdgeCrease', 'Swivel the edge behind onto the crease, pivoting at the point.')
      : t('panels:fold.sentence.behind.swivelEdgeLine', 'Swivel the edge behind onto the line, pivoting at the point.');
  }
  return target === 'crease'
    ? t('panels:fold.sentence.swivelEdgeCrease', 'Swivel the edge onto the crease, pivoting at the point.')
    : t('panels:fold.sentence.swivelEdgeLine', 'Swivel the edge onto the line, pivoting at the point.');
}

/** An inside swivel's sentence: the open one's, the verb saying the strip goes inside. */
function swivelInsideSentence(t: TFunction, direction: FoldDirection, target: 'crease' | 'free'): string {
  if (direction === 'mountain') {
    return target === 'crease'
      ? t(
          'panels:fold.sentence.behind.swivelInsideCrease',
          'Inside-swivel the edge behind onto the crease, the creases meeting on the folded edge.'
        )
      : t(
          'panels:fold.sentence.behind.swivelInsideLine',
          'Inside-swivel the edge behind onto the line, the creases meeting on the folded edge.'
        );
  }
  return target === 'crease'
    ? t('panels:fold.sentence.swivelInsideCrease', 'Inside-swivel the edge onto the crease, the creases meeting on the folded edge.')
    : t('panels:fold.sentence.swivelInsideLine', 'Inside-swivel the edge onto the line, the creases meeting on the folded edge.');
}

/** A swivel on a folded edge's sentence: the edge onto the crease or the line clicked, its creases meeting on the folded edge. */
function swivelFoldSentence(t: TFunction, direction: FoldDirection, target: 'crease' | 'free', inside: boolean): string {
  if (inside) return swivelInsideSentence(t, direction, target);
  if (direction === 'mountain') {
    return target === 'crease'
      ? t(
          'panels:fold.sentence.behind.swivelFoldCrease',
          'Swivel the edge behind onto the crease, the creases meeting on the folded edge.'
        )
      : t('panels:fold.sentence.behind.swivelFoldLine', 'Swivel the edge behind onto the line, the creases meeting on the folded edge.');
  }
  return target === 'crease'
    ? t('panels:fold.sentence.swivelFoldCrease', 'Swivel the edge onto the crease, the creases meeting on the folded edge.')
    : t('panels:fold.sentence.swivelFoldLine', 'Swivel the edge onto the line, the creases meeting on the folded edge.');
}

/**
 * The step's sentence: "Squash-fold the flap.", "Squash-fold the flap
 * behind." A petal fold by two points creases its hinge as it lifts; a
 * swivel by its edge lays the edge on its target, its creases meeting at a
 * pivot or on a folded edge.
 */
export function vertexSentence(
  t: TFunction,
  fold: FoldVertexOpKind,
  direction: FoldDirection,
  form?: FoldVertexSentenceForm
): string {
  // By its valley and mountain: on the layer that faces the viewer, never behind.
  if (form && 'swivel' in form && form.swivel === 'valley-mountain') {
    return form.inside
      ? t('panels:fold.sentence.swivelInsideValleyMountain', 'Inside-swivel the flap along the valley and the mountain.')
      : t('panels:fold.sentence.swivelValleyMountain', 'Swivel-fold the flap along the valley and the mountain.');
  }
  if (form && 'swivel' in form && form.swivel === 'edge') return swivelEdgeSentence(t, direction, form.target);
  if (form && 'swivel' in form && form.swivel === 'fold') {
    return swivelFoldSentence(t, direction, form.target, form.inside === true);
  }
  const scores = form !== undefined && 'hinge' in form && form.hinge === 'points';
  // About a drawn hinge, only the flap's end beyond it squashes.
  const end = form !== undefined && 'squashHinge' in form;
  if (direction === 'mountain') {
    switch (fold) {
      case 'squash':
        return end
          ? t('panels:fold.sentence.behind.squashEnd', 'Squash-fold the end of the flap behind, lifting it along the line.')
          : t('panels:fold.sentence.behind.squash', 'Squash-fold the flap behind.');
      case 'petal':
        return scores
          ? t('panels:fold.sentence.behind.petalScores', 'Petal-fold the flap behind, creasing its hinge as it lifts.')
          : t('panels:fold.sentence.behind.petal', 'Petal-fold the flap behind.');
      case 'rabbit-ear':
        return t('panels:fold.sentence.behind.rabbitEar', 'Rabbit-ear the triangle behind.');
      case 'swivel':
        return t('panels:fold.sentence.behind.swivel', 'Swivel-fold the paper behind, about the point.');
    }
  }
  switch (fold) {
    case 'squash':
      return end
        ? t('panels:fold.sentence.squashEnd', 'Squash-fold the end of the flap, lifting it along the line.')
        : t('panels:fold.sentence.squash', 'Squash-fold the flap.');
    case 'petal':
      return scores
        ? t('panels:fold.sentence.petalScores', 'Petal-fold the flap, creasing its hinge as it lifts.')
        : t('panels:fold.sentence.petal', 'Petal-fold the flap.');
    case 'rabbit-ear':
      return t('panels:fold.sentence.rabbitEar', 'Rabbit-ear the triangle.');
    case 'swivel':
      return t('panels:fold.sentence.swivel', 'Swivel-fold the paper about the point.');
  }
}

/** Whether a vertex fold's form is the inside swivel. */
function isInsideSwivel(form: FoldVertexSentenceForm | undefined): boolean {
  return form !== undefined && 'swivel' in form && (form.swivel === 'fold' || form.swivel === 'valley-mountain') && form.inside === true;
}

/** What the operation is called: "Squash fold", "Squash fold behind", "Inside swivel". */
export function vertexLabel(
  t: TFunction,
  fold: FoldVertexOpKind,
  direction: FoldDirection,
  form?: FoldVertexSentenceForm
): string {
  if (isInsideSwivel(form)) {
    return direction === 'mountain'
      ? t('panels:fold.words.behind.swivelInside', 'Inside swivel behind')
      : t('panels:fold.words.swivelInside', 'Inside swivel');
  }
  if (direction === 'mountain') {
    switch (fold) {
      case 'squash':
        return t('panels:fold.words.behind.squash', 'Squash fold behind');
      case 'petal':
        return t('panels:fold.words.behind.petal', 'Petal fold behind');
      case 'rabbit-ear':
        return t('panels:fold.words.behind.rabbitEar', 'Rabbit ear behind');
      case 'swivel':
        return t('panels:fold.words.behind.swivel', 'Swivel fold behind');
    }
  }
  switch (fold) {
    case 'squash':
      return t('panels:fold.words.squash', 'Squash fold');
    case 'petal':
      return t('panels:fold.words.petal', 'Petal fold');
    case 'rabbit-ear':
      return t('panels:fold.words.rabbitEar', 'Rabbit ear');
    case 'swivel':
      return t('panels:fold.words.swivel', 'Swivel fold');
  }
}

/** The operation in a word, for a badge beside a step's number: "Squash", "Inside swivel". */
export function vertexBadge(t: TFunction, fold: FoldVertexOpKind, form?: FoldVertexSentenceForm): string {
  if (isInsideSwivel(form)) return t('panels:fold.words.badgeSwivelInside', 'Inside swivel');
  switch (fold) {
    case 'squash':
      return t('panels:fold.words.badgeSquash', 'Squash');
    case 'petal':
      return t('panels:fold.words.badgePetal', 'Petal');
    case 'rabbit-ear':
      return t('panels:fold.words.badgeRabbitEar', 'Rabbit ear');
    case 'swivel':
      return t('panels:fold.words.badgeSwivel', 'Swivel');
  }
}

/** Which of a swivel's two creases rose as its ridge, by name: square to the edge, or toward its end. */
export function swivelRidgeName(t: TFunction, ridge: 'foot' | 'end'): string {
  return ridge === 'foot'
    ? t('panels:fold.words.ridgeFoot', 'Square to the edge')
    : t('panels:fold.words.ridgeEnd', 'Toward the edge’s end');
}

/** One of a vertex fold's own rows in the Step pane: what it named, and how. */
export interface FoldVertexRow {
  label: string;
  value: string;
  help?: string;
}

/** A swivel on a folded edge's kind, open or inside, as the Step pane names it. */
function swivelKindRow(t: TFunction, inside: boolean): FoldVertexRow {
  return {
    label: t('panels:fold.step.swivelKind', 'Kind'),
    value: inside ? t('panels:fold.words.swivelKindInside', 'Inside') : t('panels:fold.words.swivelKindOpen', 'Open'),
    help: inside
      ? t(
          'panels:fold.step.swivelKindInsideHelp',
          'The other layer’s strip folds under the rest of its layer, tucked between the two layers.'
        )
      : t('panels:fold.step.swivelKindOpenHelp', 'The other layer’s strip folds up over the rest of its layer, its back on show.'),
  };
}

/**
 * A vertex fold's own rows in the Step pane: a petal fold's hinge, as it was
 * named; a swivel by its edge's target and ridge. None for the other folds,
 * and for a swivel by its rays, whose creases its sentence covers.
 */
export function vertexRows(t: TFunction, form: FoldVertexSentenceForm | undefined): FoldVertexRow[] {
  if (!form) return [];
  if ('squashHinge' in form) {
    return [
      {
        label: t('panels:fold.step.hinge', 'Hinge'),
        value: t('panels:fold.words.squashHingeLine', 'Drawn line'),
        help: t(
          'panels:fold.step.squashHingeHelp',
          'Only the flap’s end beyond the line squashes: lifted along it, opened and pressed flat, its folded edge laid on the line.'
        ),
      },
    ];
  }
  if ('hinge' in form) {
    return [
      {
        label: t('panels:fold.step.hinge', 'Hinge'),
        value:
          form.hinge === 'crease'
            ? t('panels:fold.words.hingeCrease', 'Existing crease')
            : t('panels:fold.words.hingePoints', 'Two points, creased by the fold'),
        help: t(
          'panels:fold.step.hingeHelp',
          'The line the flap lifts along: a crease already there, or the line through two points, which the fold creases through the top layer.'
        ),
      },
    ];
  }
  if (form.swivel === 'rays') return [];
  if (form.swivel === 'valley-mountain') {
    return [
      {
        label: t('panels:fold.step.construction', 'Construction'),
        value: t('panels:fold.words.valleyMountain', 'Valley and mountain'),
        help: t(
          'panels:fold.step.valleyMountainHelp',
          'On the layer you see, the valley and the mountain that bound the flap, meeting on the folded edge. The crease on the layer behind follows from them.'
        ),
      },
      swivelKindRow(t, form.inside === true),
    ];
  }
  const landsOn: FoldVertexRow = {
    label: t('panels:fold.step.landsOn', 'Lands on'),
    value:
      form.target === 'crease'
        ? t('panels:fold.words.targetCrease', 'Existing crease or edge')
        : t('panels:fold.words.targetLine', 'Line through two points'),
  };
  if (form.swivel === 'fold') {
    return [
      landsOn,
      {
        label: t('panels:fold.step.creasesMeet', 'Creases meet'),
        value: t('panels:fold.words.meetOnFold', 'On a folded edge'),
        help: t(
          'panels:fold.step.creasesMeetHelp',
          'Where the line halfway between the edge and the line it lands on crosses the folded edge. The other layer at that edge folds along a second crease too.'
        ),
      },
      swivelKindRow(t, form.inside === true),
    ];
  }
  return [
    landsOn,
    {
      label: t('panels:fold.step.ridge', 'Ridge'),
      value: swivelRidgeName(t, form.ridge),
      help: t('panels:fold.step.ridgeHelp', 'The crease the swivel rises along, folded the other way from the other three.'),
    },
  ];
}
