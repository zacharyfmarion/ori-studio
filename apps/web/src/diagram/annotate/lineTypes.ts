/**
 * The three lines Annotate draws, as a type the rail's control and the Line
 * tool share (implementation-plans/diagram-annotate-second-pass.md, 15a): a
 * valley fold, a mountain fold, and a hidden line — the "dotted" one. Each is
 * a kind of its own in the file (`valley-line`, `mountain-line`,
 * `hidden-line`), which the type only chooses between.
 *
 * A leaf: the settings store reads it, so it imports nothing at run time.
 */
import type { DiagramAnnotationKind } from '../document/diagramDocument';

export type DiagramLineType = 'valley' | 'mountain' | 'hidden';

/** The types, in the order every surface offers them: as Edit's rail offers mountain and valley, a diagram's valley first. */
export const DIAGRAM_LINE_TYPES: readonly DiagramLineType[] = ['valley', 'mountain', 'hidden'];

/** The type a new line is drawn in until another is chosen. */
export const DEFAULT_DIAGRAM_LINE_TYPE: DiagramLineType = 'valley';

/** A line's kind. */
export type DiagramLineKind = 'valley-line' | 'mountain-line' | 'hidden-line';

const LINE_KIND: Readonly<Record<DiagramLineType, DiagramLineKind>> = {
  valley: 'valley-line',
  mountain: 'mountain-line',
  hidden: 'hidden-line',
};

export function isDiagramLineType(value: unknown): value is DiagramLineType {
  return typeof value === 'string' && (DIAGRAM_LINE_TYPES as readonly string[]).includes(value);
}

/** The kind a line of `type` is. */
export function lineKindOf(type: DiagramLineType): DiagramLineKind {
  return LINE_KIND[type];
}

export function isLineKind(kind: DiagramAnnotationKind): kind is DiagramLineKind {
  return kind === 'valley-line' || kind === 'mountain-line' || kind === 'hidden-line';
}

/** A line's type; null for any other kind. */
export function lineTypeOf(kind: DiagramAnnotationKind): DiagramLineType | null {
  switch (kind) {
    case 'valley-line':
      return 'valley';
    case 'mountain-line':
      return 'mountain';
    case 'hidden-line':
      return 'hidden';
    default:
      return null;
  }
}
