import { useMemo } from 'react';
import type { DiagramAsset, DiagramStep, DiagramStyle } from '../document/diagramDocument';
import type { CoveringMarks } from '../pictures/sceneUnderMarks';
import { linesUnderMarks } from './linesUnderMarks';

/**
 * {@link linesUnderMarks} of a step's marks as they are committed — a drag's
 * draft paints no picture — and the same object for as long as they leave
 * out the same lines, so a mark edit that hides nothing new repaints nothing.
 */
export function useLinesUnderMarks(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle
): CoveringMarks | null {
  const now = useMemo(() => linesUnderMarks(step, assets, style), [step, assets, style]);
  const key = now?.key ?? null;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- held by what it leaves out
  return useMemo(() => now, [key]);
}
