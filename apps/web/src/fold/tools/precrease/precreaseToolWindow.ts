/**
 * The Precrease tool's own part of the plain fold window
 * (`tools/foldToolWindow`): the extent control — Whole line, Segment, Pinch —
 * and, for a segment or a pinch, the clicks along the located line its
 * instructions add and the notes on what they snap to.
 *
 * The line is located as every fold's is; the extent's points are clicked
 * along it after, and then the layers are picked and the fold committed, as
 * for the whole line. Nothing is previewed or committed until every point is
 * in: the commit says so by being disabled, the instructions by the step in
 * hand.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import type { FoldKeyLabel } from '../foldToolCatalog';
import type { FoldKindChoice } from '../reverse/reverseToolWindow';
import {
  extentClicks,
  FOLD_EXTENT_MODES,
  foldExtentDescription,
  foldExtentLabel,
  foldExtentSteps,
  type FoldExtentMode,
} from './precreaseExtent';

/** The Precrease tool's extent, as its window reads it. */
export interface FoldExtentWindowView {
  mode: FoldExtentMode;
  /** How many of its points along the line are clicked. */
  picked: number;
}

/** What the window can promise of the extent's keys on this device. */
export interface FoldExtentHost {
  /** A finger: no keys to press, so none are offered. */
  coarse: boolean;
  /** The platform's name for Alt: Option or Alt. */
  alt: string;
  /** The label of a Fold key; without it the window names none. */
  keyLabel?: FoldKeyLabel;
}

/** Every point along the line is in, or the whole line needs none. */
export function extentComplete(extent: FoldExtentWindowView): boolean {
  return extent.picked >= extentClicks(extent.mode);
}

/**
 * The extent control: the whole line, a segment, a pinch — what each creases
 * in its tooltip, and the chosen one's under it while it is part of the line.
 */
export function extentControl(
  t: TFunction,
  extent: FoldExtentWindowView,
  set: ((mode: FoldExtentMode) => void) | undefined,
  readOnly: boolean,
  coarse = false
): FoldKindChoice<FoldExtentMode> | null {
  if (!set) return null;
  return {
    label: t('tools:fold.extent.label', 'Extent'),
    value: extent.mode,
    options: FOLD_EXTENT_MODES.map((mode) => ({
      value: mode,
      short: foldExtentLabel(t, mode),
      label: foldExtentDescription(t, mode, coarse),
      disabled: false,
      reason: null,
    })),
    disabled: readOnly,
    note: extent.mode === 'whole' ? null : foldExtentDescription(t, extent.mode, coarse),
    set,
  };
}

/** The key that steps through the extents, said where there is one to press. */
export function extentKeyNote(t: TFunction, host: FoldExtentHost): string[] {
  const key = host.coarse ? undefined : host.keyLabel?.('fold.cycleExtent');
  return key ? [t('tools:fold.extent.keyNote', 'Press {{shortcut}} to step through the extents.', { shortcut: key })] : [];
}

/** The clicks along the line, after the line mode's: none for the whole line. */
export function extentLocateSteps(t: TFunction, extent: FoldExtentWindowView | undefined, coarse = false): string[] {
  return extent ? foldExtentSteps(t, extent.mode, coarse) : [];
}

/**
 * The preview's instructions for a segment or a pinch: its clicks along the
 * line, then the layers and the commit — the click in hand marked while one
 * is, the layers (optional, as for every fold) after. Null for the whole
 * line, whose instructions are every fold's.
 */
export function extentPreviewItems(
  t: TFunction,
  extent: FoldExtentWindowView,
  coarse = false
): { along: string[]; current: number | null } | null {
  if (extent.mode === 'whole') return null;
  const along = foldExtentSteps(t, extent.mode, coarse);
  return { along, current: extentComplete(extent) ? null : Math.min(extent.picked, along.length - 1) };
}

/** What a click along the line snaps to, and the keys that change it: while its points are clicked. */
export function extentNotes(t: TFunction, extent: FoldExtentWindowView, host: FoldExtentHost): string[] {
  if (extent.mode === 'whole') return [];
  const snap = t(
    'tools:fold.note.along',
    'Points snap to where the line crosses creases, edges and marks, to points on it, and to its middle.'
  );
  if (host.coarse) return [snap];
  return [
    snap,
    t('tools:fold.note.freePoint', 'Hold {{modifier}} to put a point down anywhere, without snapping.', {
      modifier: host.alt,
    }),
    ...(extent.picked > 0 ? [t('tools:fold.note.alongBack', 'Esc takes back the last point.')] : []),
  ];
}

/** The commit's label: a pinch is made by pinching; any other precrease is a precrease. */
export function extentCommitLabel(t: TFunction, extent: FoldExtentWindowView | undefined, title: string): string {
  return extent?.mode === 'pinch' ? t('tools:fold.extent.commitPinch', 'Pinch') : title;
}
