import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';

/**
 * The sheet a crease selection makes up exactly: every line of one sheet of the
 * {@link CpSheetIndex}, and nothing else. That is what the selection toolbar
 * acts on and what `Shift+S` simulates.
 */
export interface SelectedSheet {
  /** The sheet's position in the index: the key export, share and simulate scope by. */
  sheet: number;
  /** Its 1-based line ids, ascending: the selection, put in order. */
  cpLineIds: readonly number[];
}

/**
 * The sheet these line ids make up exactly, or `null` when they are empty, span
 * more than one sheet, leave part of one out, or include a line in no sheet.
 * One pass over the ids (see {@link CpSheetIndex.sheetMadeBy}).
 */
export function resolveSelectedSheet(
  index: CpSheetIndex | null | undefined,
  lineIds: readonly number[]
): SelectedSheet | null {
  if (!index) return null;
  const sheet = index.sheetMadeBy(lineIds);
  return sheet === null ? null : { sheet, cpLineIds: index.lines(sheet) };
}

/**
 * The sheet every one of these lines is in, whether or not they make it up
 * whole: the crease pattern a fold of them came from. `null` when they are
 * empty, span more than one sheet, or include a line in no sheet.
 */
export function sheetHoldingLines(index: CpSheetIndex | null | undefined, lineIds: readonly number[]): number | null {
  if (!index || lineIds.length === 0) return null;
  const sheet = index.sheetOfLine(lineIds[0]!);
  if (sheet < 0) return null;
  return lineIds.every((id) => index.sheetOfLine(id) === sheet) ? sheet : null;
}

export interface SelectedSheetDiagnosis {
  /** Why no sheet, when there is none — the first failing precondition. */
  reason: 'matched' | 'no-index' | 'empty-selection' | 'no-sheets' | 'no-sheet-matches';
  sheets: number;
  selectedLines: number;
  /** Selected lines inside no sheet: outside every closed border. */
  outsideEverySheet: number;
  /** Every sheet holding a selected line, the closest to matching first. */
  touched: Array<{
    sheet: number;
    lines: number;
    selected: number;
    /** In this sheet but not selected. */
    missing: number;
  }>;
}

/**
 * What {@link resolveSelectedSheet} saw, for the dev console: which sheets the
 * selection touches and how far each is from being selected whole. Every
 * rejection collapses to `null` there, which looks the same as "no match".
 */
export function explainSelectedSheet(
  index: CpSheetIndex | null | undefined,
  lineIds: readonly number[]
): SelectedSheetDiagnosis {
  const base: SelectedSheetDiagnosis = {
    reason: 'matched',
    sheets: index?.sheetCount ?? 0,
    selectedLines: lineIds.length,
    outsideEverySheet: 0,
    touched: [],
  };
  if (!index) return { ...base, reason: 'no-index' };
  if (lineIds.length === 0) return { ...base, reason: 'empty-selection' };
  if (index.sheetCount === 0) return { ...base, reason: 'no-sheets' };

  const selectedPerSheet = new Map<number, Set<number>>();
  let outsideEverySheet = 0;
  for (const id of lineIds) {
    const sheet = index.sheetOfLine(id);
    if (sheet < 0) {
      outsideEverySheet += 1;
      continue;
    }
    const selected = selectedPerSheet.get(sheet) ?? new Set<number>();
    selected.add(id);
    selectedPerSheet.set(sheet, selected);
  }
  const touched = [...selectedPerSheet].map(([sheet, selected]) => ({
    sheet,
    lines: index.lineCount(sheet),
    selected: selected.size,
    missing: index.lineCount(sheet) - selected.size,
  }));
  touched.sort((a, b) => a.missing - b.missing || b.selected - a.selected);
  const matched = resolveSelectedSheet(index, lineIds) !== null;
  return {
    ...base,
    reason: matched ? 'matched' : 'no-sheet-matches',
    outsideEverySheet,
    touched,
  };
}
