import type { DiagramAnnotationTool } from '../../analytics/events';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import { isSolidArrow } from './annotationModel';

/** Each kind in the analytics events' spelling: a new kind is a type error until it has one. */
const ANNOTATION_TOOL: Readonly<Record<DiagramAnnotationKind, DiagramAnnotationTool>> = {
  'valley-arrow': 'valley_arrow',
  'mountain-arrow': 'mountain_arrow',
  'fold-unfold-arrow': 'fold_unfold_arrow',
  'pleat-arrow': 'pleat_arrow',
  'push-arrow': 'push_arrow',
  'white-arrow': 'white_arrow',
  'turn-over': 'turn_over',
  rotate: 'rotate',
  'valley-line': 'valley_line',
  'mountain-line': 'mountain_line',
  'hidden-line': 'hidden_line',
  label: 'label',
  circle: 'circle',
  'right-angle': 'right_angle',
  callout: 'callout',
  'angle-mark': 'angle_mark',
  'close-up': 'close_up',
};

/**
 * An annotation as the analytics events name it: by its kind, and by its look
 * where the look is a tool's own — a white arrow filled with ink is the Solid
 * Arrow's (15d).
 */
export function annotationEventKind(annotation: Pick<KnownDiagramAnnotation, 'kind' | 'fill'>): DiagramAnnotationTool {
  return isSolidArrow(annotation) ? 'solid_arrow' : ANNOTATION_TOOL[annotation.kind];
}
