/**
 * A partial precrease's refusals in a folder's words (`FOLD_PARTIAL_PRECREASE_REFUSAL_CODES`):
 * an extent that does not resolve — a point off the paper, a stretch too
 * short to crease, over no paper or none of the layers the precrease goes
 * through — and the marks the state's gate turns away. Each says what to do,
 * and the buttons the Precrease tool can offer where the engine offers none:
 * crease the whole line, pinch where a too-short segment starts, crease
 * through every layer.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import type { NoticeAction } from '../../../components/ui/Notice';
import { FOLD_PARTIAL_PRECREASE_REFUSAL_CODES, type FoldRefusalCode } from '../../engine/foldEngineWire';
import type { FoldExtentMode } from './precreaseExtent';

export type FoldPartialPrecreaseRefusalCode = (typeof FOLD_PARTIAL_PRECREASE_REFUSAL_CODES)[number];

export function isPartialPrecreaseRefusalCode(code: FoldRefusalCode): code is FoldPartialPrecreaseRefusalCode {
  return (FOLD_PARTIAL_PRECREASE_REFUSAL_CODES as readonly string[]).includes(code);
}

/** What a partial precrease's refusal is read against: how much of its line it creases, and whether it goes through every layer. */
export interface FoldExtentRefusalContext {
  mode: FoldExtentMode;
  allLayers: boolean;
}

/** The calls a partial precrease's buttons make; the store binds them. */
export interface FoldExtentFixVerbs {
  /** Crease the whole line instead. */
  useWholeLine?: () => void;
  /** A segment too short to crease, as a pinch at its first point. */
  pinchInstead?: () => void;
  /** Crease through every layer at the line. */
  throughAllLayers?: () => void;
}

/** A partial precrease's refusal, by its code, in a folder's words: what went wrong and what to do. */
export function extentRefusalWords(
  t: TFunction,
  code: FoldPartialPrecreaseRefusalCode,
  mode: FoldExtentMode | null
): { title: string; text: string } {
  switch (code) {
    case 'extent_off_paper':
      return {
        title: t('tools:fold.refusal.extentOffPaper.title', 'A point is off the paper'),
        text: t(
          'tools:fold.refusal.extentOffPaper.text',
          'A point the crease is measured from does not lie on the paper as it is folded now. Click its points along the line where the line crosses the paper.'
        ),
      };
    case 'extent_too_short':
      return {
        title: t('tools:fold.refusal.extentTooShort.title', 'Too short to crease'),
        text:
          mode === 'segment'
            ? t(
                'tools:fold.refusal.extentTooShort.segment',
                'The two points are too close together along the line to crease between them. Click two points farther apart, or pinch there instead.'
              )
            : t(
                'tools:fold.refusal.extentTooShort.pinch',
                'This pinch is too short for the paper to take a crease. Crease more of the line.'
              ),
      };
    case 'extent_misses_paper':
      return {
        title: t('tools:fold.refusal.extentMissesPaper.title', 'No paper there'),
        text: t(
          'tools:fold.refusal.extentMissesPaper.text',
          'That stretch of the line runs over no paper, so there is nothing to crease. Click points where the line crosses the paper.'
        ),
      };
    case 'extent_misses_layers':
      return {
        title: t('tools:fold.refusal.extentMissesLayers.title', 'No layer to crease there'),
        text: t(
          'tools:fold.refusal.extentMissesLayers.text',
          'None of the layers this precrease goes through lies along that stretch of the line, or the line is creased there already. Click points elsewhere along the line, or crease through all layers.'
        ),
      };
    case 'mark_off_sheet':
      return {
        title: t('tools:fold.refusal.markOffSheet.title', 'The mark would leave the paper'),
        text: t(
          'tools:fold.refusal.markOffSheet.text',
          'Part of the mark would lie off the sheet. Click its points along the line inside the paper.'
        ),
      };
    case 'mark_too_short':
      return {
        title: t('tools:fold.refusal.markTooShort.title', 'Too short to crease'),
        text: t(
          'tools:fold.refusal.markTooShort.text',
          'On one of its layers the mark would be too short for the paper to take a crease. Crease more of the line.'
        ),
      };
    case 'mark_on_crease':
      return {
        title: t('tools:fold.refusal.markOnCrease.title', 'Already creased there'),
        text: t(
          'tools:fold.refusal.markOnCrease.text',
          'The mark would lie along a crease that is already there. Mark another stretch of the line, or fold along the crease itself.'
        ),
      };
    case 'marks_overlap':
      return {
        title: t('tools:fold.refusal.marksOverlap.title', 'The marks would overlap'),
        text: t(
          'tools:fold.refusal.marksOverlap.text',
          'The mark would lie over part of a mark made before, in a way the paper cannot take. Mark another stretch of the line, or crease the whole line.'
        ),
      };
  }
}

/**
 * The buttons a partial precrease's refusal offers beside the engine's fixes:
 * the whole line wherever more of it would crease, a pinch where a segment
 * is too short, and every layer where the ones picked miss the stretch.
 */
export function extentExtraActions(
  t: TFunction,
  code: FoldRefusalCode,
  context: FoldExtentRefusalContext,
  disabled: boolean,
  verbs: FoldExtentFixVerbs
): NoticeAction[] {
  if (!isPartialPrecreaseRefusalCode(code) || context.mode === 'whole') return [];
  const action = (id: string, label: string, run: (() => void) | undefined): NoticeAction[] =>
    run ? [{ id, label, run, disabled }] : [];
  const wholeLine = action('extent-whole-line', t('tools:fold.fix.useWholeLine', 'Use the whole line'), verbs.useWholeLine);
  switch (code) {
    case 'extent_too_short':
      return [
        ...(context.mode === 'segment'
          ? action('extent-pinch', t('tools:fold.fix.pinchInstead', 'Pinch there instead'), verbs.pinchInstead)
          : []),
        ...wholeLine,
      ];
    case 'extent_misses_layers':
      return [
        ...(context.allLayers
          ? []
          : action('extent-all-layers', t('tools:fold.fix.throughAllLayers', 'Crease through all layers'), verbs.throughAllLayers)),
        ...wholeLine,
      ];
    // Along a crease already there, the whole line creases nothing new either.
    case 'mark_on_crease':
      return [];
    case 'extent_off_paper':
    case 'extent_misses_paper':
    case 'mark_off_sheet':
    case 'mark_too_short':
    case 'marks_overlap':
      return wholeLine;
  }
}
