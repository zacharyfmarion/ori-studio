/**
 * The words a Fold step is shown with outside its sentence: what the
 * operation is called, how its line was found, and what it did to the crease
 * pattern ("Adds 4 creases (2 M, 2 V)"). The Step pane reads them, and so will
 * the strip's badges and the tool window, so each says a step the same way.
 *
 * The counts are the engine's per-step summary (plan D14), front-relative as
 * the crease pattern stores them (D2): a crease is a valley iff the front-up
 * face lies below it, whichever side the sequence started up.
 *
 * Pure: no DOM, no store. Literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';
import { axiomPhrase } from '../lib/foldSentences';
import { turnCardWords, turnName } from '../lib/steps/turnWords';
import type { FoldSentenceLine, FoldSentenceStep, FoldSinkSentenceKind } from './stepSentence';
import { vertexBadge, vertexLabel } from './stepSentenceVertex';

/** Creases by letter, front-relative: folded mountain, folded valley, and flat (folded once, now unfolded). */
export interface FoldCreaseCounts {
  mountain: number;
  valley: number;
  flat: number;
}

/**
 * What one step did to the crease pattern (plan D14's diff). The four counts
 * are disjoint: a new crease is `added` under its letter (a precrease's flat,
 * remembering its letter), and an existing one that changed is refolded,
 * reversed or unfolded.
 */
export interface FoldCreaseDiff {
  added: FoldCreaseCounts;
  /** Flat creases folded again with the letter they remembered. */
  refolded: number;
  /** Flat creases folded again the other way. */
  reversed: number;
  /** Folded creases laid flat. */
  unfolded: number;
  /** Crease marks a partial precrease made — a pinch's or a segment's, one per layer it went through; absent for none. */
  marks?: number;
}

/** How much of its line a precrease creases: the whole line, a segment, a pinch. */
export type FoldExtentName = 'whole' | 'segment' | 'pinch';

/** The extent's name: the Step pane's Extent row, and the tool window's extent control. */
export function extentName(t: TFunction, extent: FoldExtentName): string {
  switch (extent) {
    case 'whole':
      return t('panels:fold.words.extentWhole', 'Whole line');
    case 'segment':
      return t('panels:fold.words.extentSegment', 'Segment');
    case 'pinch':
      return t('panels:fold.words.extentPinch', 'Pinch');
  }
}

/** How much of its line a precrease creased, as the Step pane's Extent row says it; null for any other step. */
export function extentLabel(t: TFunction, step: FoldSentenceStep): string | null {
  return step.op === 'precrease' ? extentName(t, step.extent?.kind ?? 'whole') : null;
}

/** Where an imported crease pattern came from (plan D16's closed enum), never a file name. */
import type { FoldCpOrigin } from './document/foldSequenceDocument';
export type { FoldCpOrigin } from './document/foldSequenceDocument';

/** What the operation is called: "Valley fold", "Turn over, side to side". */
export function operationLabel(t: TFunction, step: FoldSentenceStep): string {
  switch (step.op) {
    case 'fold':
      return step.direction === 'valley'
        ? t('panels:fold.words.valleyFold', 'Valley fold')
        : t('panels:fold.words.mountainFold', 'Mountain fold');
    case 'precrease':
      return step.direction === 'valley'
        ? t('panels:fold.words.valleyPrecrease', 'Valley fold and unfold')
        : t('panels:fold.words.mountainPrecrease', 'Mountain fold and unfold');
    case 'unfold':
      return t('panels:fold.words.unfold', 'Unfold');
    case 'turn':
      return turnName(step.turn, t);
    case 'pleat': return t('tools:fold.op.pleat', 'Pleat');
    case 'repeat': return t('panels:fold.repeat.label', 'Repeat');
    case 'unfold-to':
      return t('panels:fold.return.label', 'Unfold to step');
    case 'cp-jump':
      return step.collapse ? t('panels:fold.words.collapse', 'Collapse') : t('panels:fold.words.cpJump', 'Import crease pattern');
    case 'reverse':
      return step.kind === 'inside'
        ? t('panels:fold.words.insideReverse', 'Inside reverse fold')
        : t('panels:fold.words.outsideReverse', 'Outside reverse fold');
    case 'crimp':
      return step.crimp === 'inside'
        ? t('panels:fold.words.crimpInside', 'Inside crimp')
        : t('panels:fold.words.crimpOutside', 'Outside crimp');
    case 'tuck':
      return step.direction === 'valley'
        ? t('panels:fold.words.tuckValley', 'Valley fold and tuck')
        : t('panels:fold.words.tuckMountain', 'Mountain fold and tuck');
    case 'vertex':
      return vertexLabel(t, step.fold, step.direction, step.form);
    case 'sink':
      return sinkLabel(t, step.kind);
    case 'unknown':
      return t('panels:fold.words.unknown', 'From a newer Ori Studio');
  }
}

/** A sink's name, label and badge alike: each is already a word or two. */
function sinkLabel(t: TFunction, kind: FoldSinkSentenceKind): string {
  switch (kind) {
    case 'open':
      return t('panels:fold.words.openSink', 'Open sink');
    case 'closed':
      return t('panels:fold.words.closedSink', 'Closed sink');
    case 'unsink':
      return t('panels:fold.words.unsink', 'Unsink');
  }
}

/** The operation in a word, for a badge beside a step's number: "Valley", "Turn over". */
export function operationBadge(t: TFunction, step: FoldSentenceStep): string {
  switch (step.op) {
    case 'fold':
      return step.direction === 'valley'
        ? t('panels:fold.words.badgeValley', 'Valley')
        : t('panels:fold.words.badgeMountain', 'Mountain');
    case 'precrease':
      return t('panels:fold.words.badgePrecrease', 'Precrease');
    case 'unfold':
      return t('panels:fold.words.unfold', 'Unfold');
    case 'turn':
      // The turn card's own title, so a turn's badge and card agree.
      return turnCardWords(step.turn, t).title;
    case 'pleat': return t('tools:fold.op.pleat', 'Pleat');
    case 'repeat': return t('panels:fold.repeat.label', 'Repeat');
    case 'unfold-to':
      return t('panels:fold.return.label', 'Unfold to step');
    case 'cp-jump':
      return step.collapse ? t('panels:fold.words.collapse', 'Collapse') : t('panels:fold.words.badgeImported', 'Imported');
    case 'reverse':
      return step.kind === 'inside'
        ? t('panels:fold.words.badgeInsideReverse', 'Inside reverse')
        : t('panels:fold.words.badgeOutsideReverse', 'Outside reverse');
    case 'crimp':
      return t('panels:fold.words.badgeCrimp', 'Crimp');
    case 'tuck':
      return t('panels:fold.words.badgeTuck', 'Tuck');
    case 'vertex':
      return vertexBadge(t, step.fold, step.form);
    case 'sink':
      return sinkLabel(t, step.kind);
    case 'unknown':
      return t('panels:fold.words.badgeNewer', 'Newer');
  }
}

/**
 * How a step's line was found: "Axiom 2 · point onto point", "Free line",
 * "Existing crease" — a crimp's first line, its second `secondLineLabel`'s.
 * Null for a step that has no line.
 */
export function lineLabel(t: TFunction, step: FoldSentenceStep): string | null {
  switch (step.op) {
    case 'fold':
    case 'precrease':
    case 'reverse':
    case 'sink':
    case 'tuck':
    case 'pleat':
    case 'crimp':
      return lineWords(t, step.line);
    case 'unfold':
      return lineWords(t, { via: 'crease' });
    default:
      return null;
  }
}

/** How a crimp or pleat found its second line, including its axiom. Null for any other step. */
export function secondLineLabel(t: TFunction, step: FoldSentenceStep): string | null {
  if (step.op === 'pleat') return lineWords(t, step.second);
  return step.op === 'crimp' ? lineWords(t, { via: step.second }) : null;
}

function lineWords(t: TFunction, line: FoldSentenceLine): string {
  switch (line.via) {
    case 'free':
      return t('panels:fold.words.freeLine', 'Free line');
    case 'crease':
      return t('panels:fold.words.existingCrease', 'Existing crease');
    case 'axiom':
      return t('panels:fold.words.axiomLine', 'Axiom {{axiom}} · {{phrase}}', {
        axiom: line.axiom,
        phrase: axiomPhrase(t, line.axiom),
      });
  }
}

/**
 * What a step does to the crease pattern, a line per kind of change, in this
 * order: new folded creases with their letters, new precreases, new crease
 * marks — a pinch's by that name (`step`, the step as its sentence reads it,
 * says which) — refolds, reversals, unfolds. A step that changes nothing — a
 * turn — says so.
 */
export function creaseDiffLines(t: TFunction, diff: FoldCreaseDiff, step?: FoldSentenceStep): string[] {
  const lines: string[] = [];
  const folded = diff.added.mountain + diff.added.valley;
  if (folded > 0) {
    lines.push(
      t('panels:fold.words.adds', {
        count: folded,
        mountain: diff.added.mountain,
        valley: diff.added.valley,
        defaultValue_one: 'Adds {{count}} crease ({{mountain}} M, {{valley}} V)',
        defaultValue_other: 'Adds {{count}} creases ({{mountain}} M, {{valley}} V)',
      })
    );
  }
  if (diff.added.flat > 0) {
    lines.push(
      t('panels:fold.words.addsPrecreases', {
        count: diff.added.flat,
        defaultValue_one: 'Adds {{count}} precrease',
        defaultValue_other: 'Adds {{count}} precreases',
      })
    );
  }
  const marks = diff.marks ?? 0;
  if (marks > 0) {
    const pinch = step?.op === 'precrease' && step.extent?.kind === 'pinch';
    lines.push(
      pinch
        ? t('panels:fold.words.addsPinchMarks', {
            count: marks,
            defaultValue_one: 'Adds {{count}} pinch mark',
            defaultValue_other: 'Adds {{count}} pinch marks',
          })
        : t('panels:fold.words.addsCreaseMarks', {
            count: marks,
            defaultValue_one: 'Adds {{count}} crease mark',
            defaultValue_other: 'Adds {{count}} crease marks',
          })
    );
  }
  if (diff.refolded > 0) {
    lines.push(
      t('panels:fold.words.refolds', {
        count: diff.refolded,
        defaultValue_one: 'Refolds {{count}} precrease',
        defaultValue_other: 'Refolds {{count}} precreases',
      })
    );
  }
  if (diff.reversed > 0) {
    lines.push(
      t('panels:fold.words.reverses', {
        count: diff.reversed,
        defaultValue_one: 'Refolds {{count}} precrease the other way',
        defaultValue_other: 'Refolds {{count}} precreases the other way',
      })
    );
  }
  if (diff.unfolded > 0) {
    lines.push(
      t('panels:fold.words.unfolds', {
        count: diff.unfolded,
        defaultValue_one: 'Unfolds {{count}} crease',
        defaultValue_other: 'Unfolds {{count}} creases',
      })
    );
  }
  if (lines.length === 0) lines.push(t('panels:fold.words.noChange', 'Changes no creases'));
  return lines;
}

/** Where an imported crease pattern came from, as a row's value: "CP file". */
export function cpOriginLabel(t: TFunction, origin: FoldCpOrigin): string {
  switch (origin) {
    case 'cp':
      return t('panels:fold.words.originCp', 'CP file');
    case 'fold':
      return t('panels:fold.words.originFold', 'FOLD file');
    case 'ori':
      return t('panels:fold.words.originOri', 'ORI file');
    case 'orh':
      return t('panels:fold.words.originOrh', 'ORH file');
    case 'sample':
      return t('panels:fold.words.originSample', 'Sample');
    case 'project_cp':
      return t('panels:fold.words.originProjectCp', 'Project crease pattern');
    case 'edit_folded_figure':
      return t('panels:fold.words.originEditFoldedFigure', 'Edit’s folded figure');
  }
}
