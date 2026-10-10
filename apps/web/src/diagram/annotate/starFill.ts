import type { DiagramWhiteArrowFill } from '../../cp-workspace/references/diagram/diagramInk';

/**
 * A star's fill (Revision 3, R3-4 C, R3-5 A), as the rail's Fill and a star's
 * Layers row offer it: filled with the marks' ink (`black`), or an outline,
 * white inside (`white`). Stored as a white arrow's `fill` is: `'black'`, or
 * unsaid. Its own module, as `lineTypes.ts` is, so the settings store reads
 * the rail's choice without the tools' records.
 */
export type DiagramStarFill = DiagramWhiteArrowFill;

/** Every star fill, Filled first: the rail's and the Layers row's order. */
export const STAR_FILLS: readonly DiagramStarFill[] = ['black', 'white'];

/** Whether a value is a star fill: what the rail's stored choice is read as. */
export function isStarFill(value: unknown): value is DiagramStarFill {
  return value === 'black' || value === 'white';
}
