import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { DiagramStep } from '../document/diagramDocument';
import { sourceSheet } from './linkStatus';
import type { CpPatternSheet as DiagramPatternSheet } from '../../cp-workspace/sheets/useCpPatternSheets';

// The pattern picker's sheets are the shared ones (`useCpPatternSheets`), which
// Fold's Import CP offers too: one reading of the sheet index for both.
export { useCpPatternSheets as useDiagramPatternSheets } from '../../cp-workspace/sheets/useCpPatternSheets';
export type { CpPatternSheet as DiagramPatternSheet, CpPatternSheets as DiagramPatternSheets } from '../../cp-workspace/sheets/useCpPatternSheets';

/**
 * The pattern a region-linked step shows, among these — found as its status
 * finds it, wherever its sheet is now (`stepSheet`); null for any other step,
 * or one whose pattern is gone.
 */
export function linkedSheet(
  step: DiagramStep,
  sheets: readonly DiagramPatternSheet[],
  document: OristudioCpDocumentSnapshot | null,
  index: CpSheetIndex
): DiagramPatternSheet | null {
  if (step.source?.kind !== 'cp') return null;
  const sheet = sourceSheet(step.source, document, index);
  return sheet ? (sheets.find((candidate) => candidate.sheet === sheet) ?? null) : null;
}
