import type { OristudioBpDocumentState } from '../../engine/oristudioBpTypes';
import { bpCanSubdivideSheet, bpCanUnsubdivideSheet } from '../../lib/bpSheetSize';

/**
 * One predicate per question: both the menu gating and any future button read
 * these rather than re-deriving the engine's rules.
 *
 * Optional all the way down, like every other reader in `workspaceCapabilityInput`.
 * That input is recomputed on every store read, so a throw in here does not
 * surface as a broken menu — it aborts whatever flow happened to be running, far
 * from anything that mentions the sheet.
 */
export function bpSheetCanSubdivide(document: OristudioBpDocumentState | null): boolean {
  const sheet = document?.snapshot?.packing?.sheet;
  return sheet ? bpCanSubdivideSheet(sheet) : false;
}

export function bpSheetCanUnsubdivide(document: OristudioBpDocumentState | null): boolean {
  const packing = document?.snapshot?.packing;
  return packing?.sheet ? bpCanUnsubdivideSheet(packing.sheet, packing.flaps ?? []) : false;
}
