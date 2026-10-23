/**
 * How much of its line a precrease creases (the owner's partial-precrease
 * decision): the whole line, as a precrease always has; a segment between two
 * points clicked along the located line; or a pinch, a short mark of the
 * engine's default length centred on one point clicked along it. The tool
 * window's extent control chooses, and the choice stays from one precrease to
 * the next, as the line mode does.
 *
 * The points are clicked once the line is located, along it
 * (`canvas/foldAlongLine`), each a point pick a step stores as a point input
 * (`FoldPointRef`): what the engine projects onto the line it locates.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import { pickRef, type FoldPointPick } from '../../canvas/foldPicking';
import type { FoldPointRef, FoldPrecreaseExtent, FoldPrecreaseExtentKind } from '../../document/foldSequenceDocument';
import { extentName } from '../../stepWords';

/** The extent control's values: the whole line, or one of a partial precrease's extents. */
export type FoldExtentMode = 'whole' | FoldPrecreaseExtentKind;

/** In the order the control lists them, and the key cycles through them. */
export const FOLD_EXTENT_MODES: readonly FoldExtentMode[] = ['whole', 'segment', 'pinch'];

export function isFoldExtentMode(value: string): value is FoldExtentMode {
  return (FOLD_EXTENT_MODES as readonly string[]).includes(value);
}

/** How many points along the line an extent takes: none for the whole line, a segment's two ends, a pinch's centre. */
export function extentClicks(mode: FoldExtentMode): number {
  switch (mode) {
    case 'whole':
      return 0;
    case 'segment':
      return 2;
    case 'pinch':
      return 1;
  }
}

/** The extent after `mode`, round again after the last: what the extent key steps to. */
export function nextExtentMode(mode: FoldExtentMode): FoldExtentMode {
  const at = FOLD_EXTENT_MODES.indexOf(mode);
  return FOLD_EXTENT_MODES[(at + 1) % FOLD_EXTENT_MODES.length]!;
}

/**
 * What a precrease's extent is so far: the whole line; the points still to
 * click along it (`incomplete`); a pinch whose length the engine has not
 * named yet (`length`); or the extent a step stores, its points the picks'
 * point inputs and a pinch's length the engine's default.
 */
export type FoldExtentState =
  | { status: 'whole' }
  | { status: 'incomplete'; mode: FoldPrecreaseExtentKind; picked: number; needed: number }
  | { status: 'length' }
  | { status: 'ready'; extent: FoldPrecreaseExtent };

/** A point pick as the extent stores it: a sheet point, or a Divide-line mark's with its id. */
function pointRef(pick: FoldPointPick): FoldPointRef {
  const ref = pickRef(pick);
  // A point pick is never an edge: pickRef names an edge only for a segment pick.
  return ref.kind === 'edge' ? { kind: 'point', at: pick.sheet } : ref;
}

export function foldExtentState(
  mode: FoldExtentMode,
  picks: readonly FoldPointPick[],
  pinchLength: number | null
): FoldExtentState {
  if (mode === 'whole') return { status: 'whole' };
  const needed = extentClicks(mode);
  if (picks.length < needed) return { status: 'incomplete', mode, picked: picks.length, needed };
  if (mode === 'segment') {
    const [from, to] = picks as [FoldPointPick, FoldPointPick];
    return { status: 'ready', extent: { kind: 'segment', from: pointRef(from), to: pointRef(to) } };
  }
  if (pinchLength === null || !(pinchLength > 0)) return { status: 'length' };
  return { status: 'ready', extent: { kind: 'pinch', at: pointRef(picks[0]!), length: pinchLength } };
}

/** The extent's name in the control: the Step pane's, "Whole line", "Segment", "Pinch". */
export function foldExtentLabel(t: TFunction, mode: FoldExtentMode): string {
  return extentName(t, mode);
}

/** What each extent creases, in a line: the control's tooltip, after its name; taps on a finger (`coarse`). */
export function foldExtentDescription(t: TFunction, mode: FoldExtentMode, coarse = false): string {
  switch (mode) {
    case 'whole':
      return t('tools:fold.extent.wholeHelp', 'Crease the line from edge to edge.');
    case 'segment':
      return coarse
        ? t('tools:fold.extent.segmentHelpTouch', 'Crease the line only between two points you tap along it.')
        : t('tools:fold.extent.segmentHelp', 'Crease the line only between two points you click along it.');
    case 'pinch':
      return coarse
        ? t('tools:fold.extent.pinchHelpTouch', 'Crease only a short mark, centred on a point you tap along the line.')
        : t('tools:fold.extent.pinchHelp', 'Crease only a short mark, centred on a point you click along the line.');
  }
}

/** The clicks along the located line an extent takes, one step each: none for the whole line. */
export function foldExtentSteps(t: TFunction, mode: FoldExtentMode, coarse = false): string[] {
  switch (mode) {
    case 'whole':
      return [];
    case 'segment':
      return coarse
        ? [
            t('tools:fold.steps.segmentFromTouch', 'Tap where the crease starts along the line.'),
            t('tools:fold.steps.segmentToTouch', 'Tap where it ends.'),
          ]
        : [
            t('tools:fold.steps.segmentFrom', 'Click where the crease starts along the line.'),
            t('tools:fold.steps.segmentTo', 'Click where it ends.'),
          ];
    case 'pinch':
      return [
        coarse
          ? t('tools:fold.steps.pinchAtTouch', 'Tap where to pinch along the line.')
          : t('tools:fold.steps.pinchAt', 'Click where to pinch along the line.'),
      ];
  }
}
