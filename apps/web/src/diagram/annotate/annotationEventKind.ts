import type { DiagramAnnotationColor, DiagramAnnotationTool } from '../../analytics/events';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import { annotationColorName } from './annotationColors';
import { carriesColor, isSolidArrow } from './annotationModel';

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
  'solid-line': 'solid_line',
  label: 'label',
  circle: 'circle',
  'right-angle': 'right_angle',
  callout: 'callout',
  'angle-mark': 'angle_mark',
  divisions: 'divisions',
  'close-up': 'close_up',
  // A circle; a rounded rectangle is the Enlarge in Frame tool's (`annotationEventKind`).
  zoom: 'enlarge',
};

/**
 * An annotation as the analytics events name it: by its kind, and by its look
 * where the look is a tool's own — a white arrow filled with ink is the Solid
 * Arrow's (15d), and an enlarge area drawn as a rounded rectangle Enlarge in
 * Frame's (Revision 2).
 */
export function annotationEventKind(
  annotation: Pick<KnownDiagramAnnotation, 'kind' | 'fill' | 'radius' | 'size'>
): DiagramAnnotationTool {
  if (isSolidArrow(annotation)) return 'solid_arrow';
  if (annotation.kind === 'zoom' && annotation.radius === undefined && annotation.size !== undefined) return 'enlarge_frame';
  return ANNOTATION_TOOL[annotation.kind];
}

/**
 * A mark's colour as the analytics events name it (17a): by the palette's
 * name, or `custom` — never its value — for a kind that has a colour; none
 * for any other.
 */
export function annotationEventColor(annotation: Pick<KnownDiagramAnnotation, 'kind' | 'color'>): DiagramAnnotationColor | undefined {
  return carriesColor(annotation.kind) ? annotationColorName(annotation.color) : undefined;
}
