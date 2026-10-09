import type {
  DiagramAnnotationColor,
  DiagramAnnotationTool,
  DiagramStarFillName,
  DiagramTextSize,
  DiagramTextToggle,
} from '../../analytics/events';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import { annotationColorName } from './annotationColors';
import { carriesColor, carriesTextStyle, isSolidArrow } from './annotationModel';
import { TEXT_SIZES_PT } from './textStyle';

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
  star: 'star',
  eye: 'eye',
  oval: 'oval',
  rectangle: 'rectangle',
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

/** A label's size as the analytics events name it (17b): with the picture, one Size offers, or `other` — never its value. */
export function textSizeName(sizePt: number | null | undefined): DiagramTextSize {
  if (sizePt === null || sizePt === undefined) return 'picture';
  return TEXT_SIZES_PT.includes(sizePt) ? (String(sizePt) as DiagramTextSize) : 'other';
}

/** On or off, as the analytics events name a label's Bold and halo (17b). */
export function textToggleName(on: boolean | undefined): DiagramTextToggle {
  return on ? 'on' : 'off';
}

/** A star's fill as the analytics events name it (Revision 3): `filled` with ink, or an `outline`. */
export function starFillName(annotation: Pick<KnownDiagramAnnotation, 'fill'>): DiagramStarFillName {
  return annotation.fill === 'black' ? 'filled' : 'outline';
}

/**
 * What `diagram annotation added` says of a mark beyond its kind (17a, 17b):
 * a solid line's colour by name, a label's colour, Bold, halo and size, and
 * a star's fill (Revision 3); nothing for any other mark.
 */
export function annotationEventDetail(annotation: Pick<KnownDiagramAnnotation, 'kind' | 'color' | 'bold' | 'halo' | 'sizePt' | 'fill'>): {
  color?: DiagramAnnotationColor;
  bold?: DiagramTextToggle;
  halo?: DiagramTextToggle;
  size?: DiagramTextSize;
  fill?: DiagramStarFillName;
} {
  if (annotation.kind === 'star') return { fill: starFillName(annotation) };
  const color = annotationEventColor(annotation);
  if (!carriesTextStyle(annotation.kind)) return color ? { color } : {};
  return {
    ...(color ? { color } : {}),
    bold: textToggleName(annotation.bold),
    halo: textToggleName(annotation.halo),
    size: textSizeName(annotation.sizePt),
  };
}
