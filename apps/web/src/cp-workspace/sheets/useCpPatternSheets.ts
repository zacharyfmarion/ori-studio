import { useMemo } from 'react';
import { sheetRegions, type CpSheetRegion } from './cpSheetRegions';
import { linesSheetThumbnail } from './linesSheetThumbnail';
import type { SheetThumbnail } from './sheetThumbnail';
import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useCpSheetIndexState } from './useCpSheetIndexState';

/** One pattern a link can be made to: a sheet of the open crease pattern. */
export interface CpPatternSheet {
  sheet: CpSheetRegion;
  thumbnail: SheetThumbnail | null;
}

export type CpPatternSheets =
  | { status: 'no-pattern' }
  | { status: 'pending' }
  | { status: 'failed' }
  | {
      status: 'ready';
      sheets: readonly CpPatternSheet[];
      /** The index the sheets are of: what a linked step's own sheet is found in. */
      index: CpSheetIndex;
    };

/** What the sheets are while nothing wants them: not worked out. */
const NOT_WANTED: CpPatternSheets = { status: 'pending' };

/**
 * The patterns of the open crease pattern, for a picker — the Diagram's
 * pattern picker, Fold's Import CP: the sheets of the index every link is
 * made in (D3), each drawn from its own lines as the References rail draws
 * one. Worked out only while `wanted` — drawing every sheet for a picker no
 * one opened is work for nothing; on a 204-sheet canvas, drawing them from
 * faces once froze each selection for over a minute.
 */
export function useCpPatternSheets(wanted: boolean): CpPatternSheets {
  const state = useCpSheetIndexState(wanted);
  const document = useWorkspaceStore((store) => store.oristudioCpDocument?.document ?? null);
  return useMemo(() => {
    if (!wanted) return NOT_WANTED;
    if (state.status !== 'ready') return state;
    return {
      status: 'ready',
      sheets: sheetRegions(state.index).map((sheet) => ({
        sheet,
        thumbnail: document ? linesSheetThumbnail(document, sheet.lineIds) : null,
      })),
      index: state.index,
    };
  }, [wanted, state, document]);
}
