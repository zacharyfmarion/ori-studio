import type { AuxLine } from '@treemaker/origami-simulator';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { creaseRoleOf } from '../references/creaseRole';

/**
 * `lineIds` (the kernel's ids, from 1) split into the lines the simulated
 * paper is built from and the aux lines drawn on it, the latter as their two
 * ends. With `auxLinesAreFacets` every line is the paper's
 * (`lib/simulationAuxLines.ts`).
 */
export function splitSimulationLines(
  document: OristudioCpDocumentSnapshot,
  lineIds: readonly number[],
  auxLinesAreFacets: boolean
): { paper: number[]; aux: AuxLine[] } {
  if (auxLinesAreFacets) return { paper: [...lineIds], aux: [] };
  const lines = document.crease_pattern.line_segments;
  const paper: number[] = [];
  const aux: AuxLine[] = [];
  for (const id of lineIds) {
    const line = lines[id - 1];
    if (line && creaseRoleOf(line) === 'aux') {
      aux.push([
        [line.a.x, line.a.y],
        [line.b.x, line.b.y],
      ]);
    } else paper.push(id);
  }
  return { paper, aux };
}

const hasAuxLines = new WeakMap<OristudioCpDocumentSnapshot, boolean>();

/** Whether the document holds an aux line; once per snapshot. */
export function documentHasAuxLines(document: OristudioCpDocumentSnapshot): boolean {
  let has = hasAuxLines.get(document);
  if (has === undefined) {
    has = document.crease_pattern.line_segments.some((line) => creaseRoleOf(line) === 'aux');
    hasAuxLines.set(document, has);
  }
  return has;
}
