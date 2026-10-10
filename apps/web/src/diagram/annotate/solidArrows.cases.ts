import type { DiagramPathNode, KnownDiagramAnnotation } from '../document/diagramDocument';
import { SOLID_ARROW_LOOK, type WhiteArrowLook } from './annotationModel';

/** A white arrow along `path`, in `look`, its ends its path's. */
function arrow(id: string, path: DiagramPathNode[], look: WhiteArrowLook): KnownDiagramAnnotation {
  const { fill, ...preset } = look;
  return {
    id,
    kind: 'white-arrow',
    from: path[0]!.at,
    to: path[path.length - 1]!.at,
    path,
    width: preset.width ?? 'regular',
    tail: preset.tail ?? 'pointed',
    ...(fill === 'black' ? { fill } : {}),
  };
}

/**
 * The solid arrows (Phase 15d) a card, a page and the canvas are checked
 * against: one as the Solid Arrow lays it, straight, step 129's block arrow;
 * its white twin, the same outline; one shaped with Edit Path, curving; and
 * the template's regular arrow and a wide cleft one, filled.
 */
export const SOLID_ARROW_CASES: readonly KnownDiagramAnnotation[] = [
  arrow('laid', [{ at: [0.15, 0.3] }, { at: [0.6, 0.3] }], SOLID_ARROW_LOOK),
  arrow('white-twin', [{ at: [0.15, 0.45] }, { at: [0.6, 0.45] }], { ...SOLID_ARROW_LOOK, fill: 'white' }),
  arrow('shaped', [{ at: [0.2, 0.7], out: [0.35, 0.5] }, { at: [0.75, 0.55], in: [0.55, 0.45] }], SOLID_ARROW_LOOK),
  arrow('regular', [{ at: [0.65, 0.15] }, { at: [0.9, 0.4] }], { fill: 'black' }),
  arrow('wide-cleft', [{ at: [0.1, 0.1] }, { at: [0.5, 0.15] }], { width: 'wide', tail: 'cleft', fill: 'black' }),
];
