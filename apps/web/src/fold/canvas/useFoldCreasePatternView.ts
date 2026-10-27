import { useCallback, useMemo, useState } from 'react';
import { trackFoldCpSideChanged } from '../../analytics/trackFold';
import type { PaperSide } from '../../lib/paper/paperScene';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { foldCpModelToUser, foldCpSheetFill } from './foldCreasePatternView';

const EMPTY_SHEET: readonly (readonly [number, number])[] = [];

/** CP-only view state: turning it adds no step and never changes the stored assignments. */
export function useFoldCreasePatternView(
  sheet: readonly (readonly [number, number])[] | undefined,
  style: PaperStyle
) {
  const [side, setSide] = useState<PaperSide>('front');
  const turnOver = useCallback(() => {
    const next = side === 'front' ? 'back' : 'front';
    setSide(next);
    trackFoldCpSideChanged(next);
  }, [side]);
  const sheetFill = useMemo(() => foldCpSheetFill(sheet ?? EMPTY_SHEET, style, side), [sheet, style, side]);
  const modelToUser = useMemo(() => foldCpModelToUser(sheet ?? EMPTY_SHEET, side), [sheet, side]);
  return { side, turnOver, sheetFill, modelToUser };
}
