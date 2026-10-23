/**
 * The words the sequence chrome says a path with, beyond each step's own
 * (`fold/stepWords`, `fold/stepSentence`): the sheet's sentence, the strip's
 * badges for a step's standing, its branches, and the moves between steps.
 * One place, so the strip, the keys and the menus name each
 * the same way.
 *
 * Whole sentences per case where word order differs (the sheet's shape and
 * side), as the step sentences are (plan D14). Literal `t()` keys so the
 * extractor sees them. Pure.
 */
import type { TFunction } from 'i18next';
import type { FoldPaper, FoldPaperShape, SheetPoint } from '../document/foldSequenceDocument';
import type { FoldEntryStatus } from './foldSequencePath';

/**
 * Whether a polygon sheet is a regular one: every side the same length and
 * every corner the same distance from its middle, within a millionth of the
 * sheet. The Paper tab made only regular ones; an imported outline may be any.
 */
export function isRegularSheet(points: readonly SheetPoint[]): boolean {
  const n = points.length;
  if (n < 3) return false;
  const cx = points.reduce((sum, [x]) => sum + x, 0) / n;
  const cy = points.reduce((sum, [, y]) => sum + y, 0) / n;
  const sides = points.map(([x, y], i) => {
    const [nx, ny] = points[(i + 1) % n]!;
    return Math.hypot(nx - x, ny - y);
  });
  const radii = points.map(([x, y]) => Math.hypot(x - cx, y - cy));
  const near = (values: number[]) => Math.max(...values) - Math.min(...values) <= 1e-6;
  return near(sides) && near(radii);
}

/** The sheet's shape in a few words, as the Paper tab shows it: "Square", "Rectangle, 1 : 1.414", "Hexagon"… */
export function sheetShapeName(t: TFunction, shape: FoldPaperShape): string {
  switch (shape.kind) {
    case 'square':
      return t('panels:fold.paper.sheetSquare', 'Square');
    case 'rectangle': {
      const [width, height] = shape.aspect;
      const ratio = Math.round((Math.max(width, height) / Math.min(width, height)) * 1000) / 1000;
      return t('panels:fold.paper.sheetRectangle', 'Rectangle, 1 : {{ratio}}', { ratio });
    }
    case 'polygon': {
      const count = shape.points.length;
      return isRegularSheet(shape.points)
        ? t('panels:fold.paper.sheetRegular', {
            count,
            defaultValue_one: 'Regular polygon, {{count}} side',
            defaultValue_other: 'Regular polygon, {{count}} sides',
          })
        : t('panels:fold.paper.sheetPolygon', {
            count,
            defaultValue_one: 'Polygon, {{count}} side',
            defaultValue_other: 'Polygon, {{count}} sides',
          });
    }
  }
}

/** "Start with a square, front side up." */
export function sheetSentence(t: TFunction, paper: FoldPaper): string {
  const back = paper.startSide === 'back';
  switch (paper.shape.kind) {
    case 'square':
      return back
        ? t('panels:fold.sequence.sheetSquareBack', 'Start with a square, back side up.')
        : t('panels:fold.sequence.sheetSquareFront', 'Start with a square, front side up.');
    case 'rectangle':
      return back
        ? t('panels:fold.sequence.sheetRectangleBack', 'Start with a rectangle, back side up.')
        : t('panels:fold.sequence.sheetRectangleFront', 'Start with a rectangle, front side up.');
    case 'polygon': {
      const count = paper.shape.points.length;
      // An imported outline need not be regular: said as the polygon it is.
      if (!isRegularSheet(paper.shape.points)) {
        return back
          ? t('panels:fold.sequence.sheetIrregularBack', {
              count,
              defaultValue_one: 'Start with a polygon of {{count}} side, back side up.',
              defaultValue_other: 'Start with a polygon of {{count}} sides, back side up.',
            })
          : t('panels:fold.sequence.sheetIrregularFront', {
              count,
              defaultValue_one: 'Start with a polygon of {{count}} side, front side up.',
              defaultValue_other: 'Start with a polygon of {{count}} sides, front side up.',
            });
      }
      return back
        ? t('panels:fold.sequence.sheetPolygonBack', {
            count,
            defaultValue_one: 'Start with a regular polygon of {{count}} side, back side up.',
            defaultValue_other: 'Start with a regular polygon of {{count}} sides, back side up.',
          })
        : t('panels:fold.sequence.sheetPolygonFront', {
            count,
            defaultValue_one: 'Start with a regular polygon of {{count}} side, front side up.',
            defaultValue_other: 'Start with a regular polygon of {{count}} sides, front side up.',
          });
    }
  }
}

/** The flat sheet's badge, where a step has its operation's. */
export function sheetBadge(t: TFunction): string {
  return t('panels:fold.sequence.badgeSheet', 'Sheet');
}

/**
 * A step's standing in a word, in place of its operation's badge, for the
 * standings a card's frame shows: broken, changed. Null where the operation's
 * badge stands — an ok step, one still folding, one under a broken step (its
 * own inputs may be fine), and a locked one, whose operation's badge already
 * says it is a newer build's.
 */
export function statusBadge(t: TFunction, status: FoldEntryStatus): string | null {
  switch (status) {
    case 'broken':
      return t('panels:fold.sequence.badgeBroken', 'Broken');
    case 'changed':
      return t('panels:fold.sequence.badgeChanged', 'Changed');
    default:
      return null;
  }
}

/** The step a tool is folding, on its card: landed, or refused. */
export function pendingBadge(t: TFunction, refused: boolean): string {
  return refused ? t('panels:fold.sequence.badgeBlocked', 'Blocked') : t('panels:fold.sequence.badgePreview', 'Preview');
}

/** The word ahead of the pending step's sentence: what it will be once committed. */
export function pendingTag(t: TFunction, branch: boolean): string {
  return branch ? t('panels:fold.sequence.tagBranch', 'New branch') : t('panels:fold.sequence.tagNext', 'Next');
}

/** "Branch 2 of 3", or "2 / 3" where room is short. */
export function branchReadout(t: TFunction, index: number, count: number, short: boolean): string {
  return short
    ? t('panels:fold.sequence.branchShort', '{{n}} / {{total}}', { n: index + 1, total: count })
    : t('panels:fold.sequence.branch', 'Branch {{n}} of {{total}}', { n: index + 1, total: count });
}

/** What stands for a step's sentence where there is none to show. */
export function stepPlaceholder(t: TFunction): string {
  return t('panels:fold.sequence.placeholder', 'Fold the sheet to make step 1.');
}

/** The strip's accessible name. */
export function stripLabel(t: TFunction): string {
  return t('panels:fold.sequence.stripLabel', 'Steps');
}

/** The branches row's accessible name. */
export function branchesLabel(t: TFunction): string {
  return t('panels:fold.sequence.branchesLabel', 'Branches at this step');
}

/** The moves between steps, as the chevrons, the menu and the keys name them. */
export function moveLabel(t: TFunction, move: 'previous' | 'next' | 'previousBranch' | 'nextBranch'): string {
  switch (move) {
    case 'previous':
      return t('panels:fold.sequence.previousStep', 'Previous step');
    case 'next':
      return t('panels:fold.sequence.nextStep', 'Next step');
    case 'previousBranch':
      return t('panels:fold.sequence.previousBranch', 'Previous branch');
    case 'nextBranch':
      return t('panels:fold.sequence.nextBranch', 'Next branch');
  }
}

/** How many steps fold, for the header: "3 steps". */
export function stepCountLabel(t: TFunction, count: number): string {
  return t('panels:fold.sequence.stepCount', {
    count,
    defaultValue_one: '{{count}} step',
    defaultValue_other: '{{count}} steps',
  });
}

/** What the strip says under its caption while the replay is under way, or after it stopped short. */
export function replayNote(
  t: TFunction,
  progress: { replaying: boolean; activeSettled: number; activeTotal: number },
  failed: boolean
): string {
  if (failed) return t('panels:fold.sequence.replayFailed', 'The steps could not all be folded.');
  if (!progress.replaying || progress.activeSettled >= progress.activeTotal) return '';
  return t('panels:fold.sequence.replaying', 'Folding the steps… {{done}} of {{total}}', {
    done: progress.activeSettled,
    total: progress.activeTotal,
  });
}
