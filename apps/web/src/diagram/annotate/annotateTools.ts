import type { TFunction } from 'i18next';
import type { DiagramAnnotateShortcutId } from '../../keyboard/shortcuts';
import type { DiagramAnnotationKind, DiagramZoomShape, KnownDiagramAnnotation } from '../document/diagramDocument';
import { canBeShaped, isPointKind, isSolidArrow, SOLID_ARROW_LOOK, type WhiteArrowLook } from './annotationModel';
import type { AnnotationPaletteName } from './annotationColors';
import { isTextSizePt, TEXT_SIZES_PT, type TextStyle } from './textStyle';
import { DEFAULT_DIAGRAM_LINE_TYPE, lineKindOf, type DiagramLineKind, type DiagramLineType } from './lineTypes';
import type { PickProgress, ToolNotice } from './pickProgress';
import type { DiagramStarFill } from './starFill';

/**
 * Annotate's tools (D8), for every surface that offers them: the rail beside
 * the canvas, the keys, and the tool window's name, help and modifier keys
 * for the one in hand. React-free and store-free, as `diagramActions.ts` is;
 * each surface draws its own.
 */

/**
 * Edit Path (decision 3): the tool that shapes the selected fold arrow or
 * white arrow by its nodes, handles and curve, as Affinity's Node tool does.
 * It draws nothing.
 */
export const EDIT_PATH = 'edit-path';

/**
 * The Line tool (15a): a line in the type the rail's Line Type says — a
 * valley, a mountain, a hidden or a solid line (17a), each a kind of its own.
 */
export const LINE_TOOL = 'line';

/**
 * The Angle Bisector (15b): Edit's, on the picture — three points or two
 * lines, then the line it runs to — drawing a line in the type the rail's
 * Line Type says, and the equal-angle mark of the angle it halves.
 */
export const ANGLE_BISECTOR = 'angle-bisector';

/**
 * The Solid Arrow (15d): a white arrow laid in the solid arrow's look —
 * narrow, its tail square, filled with ink — and shaped and lengthened
 * afterwards with Edit Path, as any white arrow is.
 */
export const SOLID_ARROW = 'solid-arrow';

/**
 * Enlarge and Enlarge in Frame (Revision 2, Z1): an enlarge area laid on the
 * step, a circle dragged out from its middle or a rounded rectangle dragged
 * corner to corner, marking what a later step shows larger. Drawing one
 * changes no other step.
 */
export const ENLARGE = 'enlarge';
export const ENLARGE_FRAME = 'enlarge-frame';

/**
 * The signs no tool draws (Zach, 2026-10-05): turning the model over or round
 * is a step between steps (D22), not a sign on a picture. One already drawn
 * is kept, drawn, moved and deleted as any annotation is.
 */
type TurnSignKind = 'turn-over' | 'rotate';

/**
 * A tool that draws: the kind it draws, for every kind but the four lines,
 * which the Line tool draws in the type chosen, the turn signs, which none
 * does, and the enlarge area, which tools of its own lay in a shape each
 * (Revision 2); the Angle Bisector, which draws a line and a mark; and the
 * Solid Arrow, a white arrow in a look of its own. Its own id, so a tool need
 * not be a kind.
 */
export type DrawingTool =
  | Exclude<DiagramAnnotationKind, DiagramLineKind | TurnSignKind | 'zoom'>
  | typeof LINE_TOOL
  | typeof ANGLE_BISECTOR
  | typeof SOLID_ARROW
  | typeof ENLARGE
  | typeof ENLARGE_FRAME;

/** A tool that draws, Edit Path, or Select. */
export type AnnotateTool = DrawingTool | typeof EDIT_PATH | null;

/** Whether a tool draws something: not Select or Edit Path. */
export function isDrawingTool(tool: AnnotateTool): tool is DrawingTool {
  return tool !== null && tool !== EDIT_PATH;
}

/**
 * The kind a tool draws with a drag or a click, a line in `lineType`; null
 * for Select and Edit Path, which draw nothing, and for the tools that are a
 * sequence of picks (`isPickTool`), which draw what their picks make.
 */
export function drawingKind(tool: AnnotateTool, lineType: DiagramLineType): DiagramAnnotationKind | null {
  if (!isDrawingTool(tool) || isPickTool(tool)) return null;
  if (tool === SOLID_ARROW) return 'white-arrow';
  if (isEnlargeTool(tool)) return 'zoom';
  return tool === LINE_TOOL ? lineKindOf(lineType) : tool;
}

/**
 * The look a tool lays what it draws in, over its kind's own: the Solid
 * Arrow's (15d), the shape an enlarge area is drawn in (Revision 2) — a
 * circle with Enlarge, a rounded rectangle with Enlarge in Frame — the
 * colour the Line tool draws a solid line in (17a), or the style the Label
 * tool sets its text in (17b).
 */
export type DrawingLook = WhiteArrowLook & { shape?: DiagramZoomShape; color?: string; text?: TextStyle };

/** The line the Line tool draws: its type, and the colour a solid one is drawn in, null for the style's ink. */
export interface LineChoice {
  type: DiagramLineType;
  color: string | null;
}

/**
 * The look a tool lays what it draws in ({@link DrawingLook}): `line` the
 * Line tool's choice, `text` the rail's Text Style for the Label tool's
 * (17b), `starFill` the rail's Fill for the Star tool's (Revision 3, R3-4 C);
 * nothing for any other tool.
 */
export function drawingLook(tool: AnnotateTool, line?: LineChoice, text?: TextStyle, starFill?: DiagramStarFill): DrawingLook {
  if (tool === SOLID_ARROW) return SOLID_ARROW_LOOK;
  if (tool === ENLARGE) return { shape: 'circle' };
  if (tool === ENLARGE_FRAME) return { shape: 'rounded' };
  if (tool === LINE_TOOL && line?.type === 'solid' && line.color !== null) return { color: line.color };
  if (tool === 'label' && text) return { text };
  if (tool === 'star' && starFill) return { fill: starFill };
  return {};
}

/** A star fill's name, for the rail's control and the Layers row. */
export function starFillLabel(t: TFunction, fill: DiagramStarFill): string {
  return fill === 'black'
    ? t('panels:diagram.annotations.starFilled', 'Filled')
    : t('panels:diagram.annotations.starOutline', 'Outline');
}

/** Whether a tool lays an enlarge area: Enlarge or Enlarge in Frame. */
export function isEnlargeTool(tool: AnnotateTool): tool is typeof ENLARGE | typeof ENLARGE_FRAME {
  return tool === ENLARGE || tool === ENLARGE_FRAME;
}

/**
 * Why an enlarge area goes on no enlarged step: a step is enlarged or holds
 * areas, not both (Revision 2). What the held Enlarge tools say, and a paste
 * that leaves an area out.
 */
export function enlargedStepTakesNoArea(t: TFunction): string {
  return t(
    'panels:diagram.annotate.enlargeOnEnlarged',
    'This step is already enlarged — draw the area on a step that shows the whole model'
  );
}

/**
 * Whether a step's picture can be x-rayed (Revision 3, R3-18a A): `ready`, a
 * flat fold with its faces on the paper; `fetch`, a flat fold captured before
 * they were kept, whose faces are folded again from its pattern as an x-ray is
 * laid; `refresh`, such a fold whose faces cannot be had without a Refresh —
 * its link is not current, or no pattern is open — numbered for the words that
 * say so; `none`, a picture with no layers: a crease pattern, a 3D or
 * simulated capture, an upload, a see-through development, a References step.
 */
export type XRayStanding =
  | { kind: 'ready' }
  | { kind: 'fetch' }
  | { kind: 'refresh'; number: number }
  | { kind: 'none' };

/**
 * Whether the X-Ray tool is held on a step (R3-18a A): its picture has no
 * layers, or its faces need a Refresh. The one answer the rail, the X key and
 * the tool in hand ask (`annotateToolInHand`), so the canvas never lays a
 * window the rail shows held.
 */
export function xrayToolHeld(standing: XRayStanding): boolean {
  return standing.kind === 'none' || standing.kind === 'refresh';
}

/** What an x-ray says it needs on a step that is not ready: the tool's held reason, and its Depth row's (R3-18). */
export function xrayHeldReason(t: TFunction, standing: XRayStanding): string | null {
  switch (standing.kind) {
    case 'ready':
    case 'fetch':
      return null;
    case 'refresh':
      return t('panels:diagram.annotate.xRayRefresh', 'Refresh step {{number}} to x-ray it', { number: standing.number });
    case 'none':
      return t('panels:diagram.annotate.xRayFlatOnly', 'X-ray works on flat folds');
  }
}

/**
 * Why a tool cannot draw on a step, or null when it can: an enlarge area is
 * not drawn on an enlarged step ({@link enlargedStepTakesNoArea}), and an
 * x-ray only on a flat fold whose faces are known or can be fetched
 * ({@link xrayHeldReason}). A diagram that cannot change, a newer build's
 * step and a step with no picture hold every tool, and say so where Annotate
 * is entered.
 */
export function annotateToolBlocker(
  t: TFunction,
  tool: AnnotateTool,
  { enlarged, xray = { kind: 'ready' } }: { enlarged: boolean; xray?: XRayStanding }
): string | null {
  if (enlarged && isEnlargeTool(tool)) return enlargedStepTakesNoArea(t);
  return tool === 'x-ray' ? xrayHeldReason(t, xray) : null;
}

/** Whether a tool draws in the line type: the Line tool and the Angle Bisector. */
export function isLineTool(tool: AnnotateTool): boolean {
  return tool === LINE_TOOL || tool === ANGLE_BISECTOR;
}

/**
 * Whether a tool draws by a sequence of presses, each a pick, rather than a
 * drag or a click: the Angle Bisector, and the equal-angle mark put down on
 * its own (three points: an arm, the vertex, the other arm).
 */
export function isPickTool(tool: AnnotateTool): tool is typeof ANGLE_BISECTOR | 'angle-mark' {
  return tool === ANGLE_BISECTOR || tool === 'angle-mark';
}

/** The rail's groups: Shapes, after Marks, holds the Oval and the Rectangle (Revision 3, R3-25 A). */
export type AnnotateToolGroupId = 'select' | 'arrows' | 'lines' | 'marks' | 'shapes' | 'text';

export interface AnnotateToolGroup {
  id: AnnotateToolGroupId;
  tools: readonly AnnotateTool[];
}

/** The group each tool is in on the rail: a record, so no tool can be left off it. */
const TOOL_GROUP: Readonly<Record<DrawingTool, Exclude<AnnotateToolGroupId, 'select'>>> = {
  'valley-arrow': 'arrows',
  'mountain-arrow': 'arrows',
  'fold-unfold-arrow': 'arrows',
  'pleat-arrow': 'arrows',
  'push-arrow': 'arrows',
  'white-arrow': 'arrows',
  [SOLID_ARROW]: 'arrows',
  [LINE_TOOL]: 'lines',
  [ANGLE_BISECTOR]: 'lines',
  label: 'text',
  circle: 'marks',
  star: 'marks',
  'right-angle': 'marks',
  'angle-mark': 'marks',
  divisions: 'marks',
  eye: 'marks',
  'close-up': 'marks',
  [ENLARGE]: 'marks',
  [ENLARGE_FRAME]: 'marks',
  'x-ray': 'marks',
  oval: 'shapes',
  rectangle: 'shapes',
  callout: 'text',
};

/** The drawing tools in the order the rail offers them, each in its group. */
export const DRAWING_TOOLS = Object.keys(TOOL_GROUP) as readonly DrawingTool[];

/** The rail's groups, in order: Select and Edit Path; Arrows; Lines; Marks; Shapes; Text — each tool in its group. */
export const ANNOTATE_TOOL_GROUPS: readonly AnnotateToolGroup[] = [
  { id: 'select', tools: [null, EDIT_PATH] },
  ...(['arrows', 'lines', 'marks', 'shapes', 'text'] as const).map((id) => ({
    id,
    tools: DRAWING_TOOLS.filter((tool) => TOOL_GROUP[tool] === id),
  })),
];

/**
 * Each tool's key. The Line tool has none of its own: the keys that pick a
 * line type pick it (`LINE_TYPE_SHORTCUTS`).
 */
export const ANNOTATE_TOOL_SHORTCUTS: Readonly<Record<DrawingTool, DiagramAnnotateShortcutId | null>> = {
  'valley-arrow': 'diagram.toolValleyArrow',
  'mountain-arrow': 'diagram.toolMountainArrow',
  'fold-unfold-arrow': 'diagram.toolFoldUnfoldArrow',
  'pleat-arrow': 'diagram.toolPleatArrow',
  'push-arrow': 'diagram.toolPushArrow',
  'white-arrow': 'diagram.toolWhiteArrow',
  [SOLID_ARROW]: 'diagram.toolSolidArrow',
  [LINE_TOOL]: null,
  [ANGLE_BISECTOR]: 'diagram.toolAngleBisector',
  label: 'diagram.toolLabel',
  circle: 'diagram.toolCircle',
  star: 'diagram.toolStar',
  'right-angle': 'diagram.toolRightAngle',
  'angle-mark': null,
  divisions: 'diagram.toolDivisions',
  eye: 'diagram.toolEye',
  'close-up': 'diagram.toolCloseUp',
  [ENLARGE]: 'diagram.toolEnlarge',
  [ENLARGE_FRAME]: 'diagram.toolEnlargeFrame',
  'x-ray': 'diagram.toolXRay',
  oval: 'diagram.toolOval',
  rectangle: 'diagram.toolRectangle',
  callout: 'diagram.toolCallout',
};

/**
 * The key that picks each line type — the keys the three first line tools
 * had, so a rebinding carries over, and Shift+L for Solid (17a), as Shift+V
 * and Shift+M pick theirs. Each picks the Line tool too, unless a tool
 * that draws in the type is already in hand (`runDiagramAnnotateShortcut`).
 */
export const LINE_TYPE_SHORTCUTS: Readonly<Record<DiagramLineType, DiagramAnnotateShortcutId>> = {
  valley: 'diagram.toolValleyLine',
  mountain: 'diagram.toolMountainLine',
  hidden: 'diagram.toolHiddenLine',
  solid: 'diagram.toolSolidLine',
};

/** Edit Path's key. */
export const EDIT_PATH_SHORTCUT: DiagramAnnotateShortcutId = 'diagram.toolEditPath';

/** The key that picks a tool; Select has none (Escape puts a tool down), nor has Line (its types do). */
export function annotateToolShortcut(tool: AnnotateTool): DiagramAnnotateShortcutId | undefined {
  if (tool === null) return undefined;
  return tool === EDIT_PATH ? EDIT_PATH_SHORTCUT : (ANNOTATE_TOOL_SHORTCUTS[tool] ?? undefined);
}

/** The tool a tool key picks; undefined for a key that is not a tool's (Flip arc, a line type's). */
export function toolForShortcut(id: DiagramAnnotateShortcutId): Exclude<AnnotateTool, null> | undefined {
  if (id === EDIT_PATH_SHORTCUT) return EDIT_PATH;
  return DRAWING_TOOLS.find((tool) => ANNOTATE_TOOL_SHORTCUTS[tool] === id);
}

/** The line type a key picks; undefined for any other key. */
export function lineTypeForShortcut(id: DiagramAnnotateShortcutId): DiagramLineType | undefined {
  return (Object.keys(LINE_TYPE_SHORTCUTS) as DiagramLineType[]).find((type) => LINE_TYPE_SHORTCUTS[type] === id);
}

/** A line type's name, for the rail's control, its keys and the Step pane. */
export function lineTypeLabel(t: TFunction, type: DiagramLineType): string {
  switch (type) {
    case 'valley':
      return t('panels:diagram.annotate.lineTypeValley', 'Valley');
    case 'mountain':
      return t('panels:diagram.annotate.lineTypeMountain', 'Mountain');
    case 'hidden':
      return t('panels:diagram.annotate.lineTypeHidden', 'Hidden');
    case 'solid':
      return t('panels:diagram.annotate.lineTypeSolid', 'Solid');
  }
}

/** A colour of the palette's name (17a), for the colour select. */
export function annotationColorLabel(t: TFunction, name: AnnotationPaletteName): string {
  switch (name) {
    case 'ink':
      return t('panels:diagram.annotations.colorInk', 'Ink');
    case 'reference':
      return t('panels:diagram.annotations.colorReference', 'Reference');
    case 'red':
      return t('panels:diagram.annotations.colorRed', 'Red');
    case 'orange':
      return t('panels:diagram.annotations.colorOrange', 'Orange');
    case 'green':
      return t('panels:diagram.annotations.colorGreen', 'Green');
    case 'blue':
      return t('panels:diagram.annotations.colorBlue', 'Blue');
    case 'purple':
      return t('panels:diagram.annotations.colorPurple', 'Purple');
  }
}

/** Size's With the picture (17b): a label with no size of its own, as an id a select can hold. */
export const TEXT_SIZE_PICTURE = 'picture';

/**
 * The sizes Size offers (17b), for the rail's Text Style and a label's Layers
 * row: With the picture, then 7, 9, 12 and 16 pt — and a size from a file
 * that is none of these as an item of its own while it is `current`, as a
 * colour picked by hand is. Each an id a select holds ({@link textSizeOfId}).
 */
export function textSizeOptions(t: TFunction, current: number | null): { id: string; label: string }[] {
  const sizes = current !== null && !TEXT_SIZES_PT.includes(current) ? [...TEXT_SIZES_PT, current].sort((a, b) => a - b) : TEXT_SIZES_PT;
  return [
    { id: TEXT_SIZE_PICTURE, label: t('panels:diagram.annotations.sizeWithPicture', 'With the picture') },
    ...sizes.map((size) => ({ id: String(size), label: t('panels:diagram.annotations.sizePt', '{{size}} pt', { size }) })),
  ];
}

/** A size's id as a select holds it ({@link textSizeOptions}). */
export function textSizeId(sizePt: number | null): string {
  return sizePt === null ? TEXT_SIZE_PICTURE : String(sizePt);
}

/** The size an id names: null for With the picture, or for one that names no size a label can have. */
export function textSizeOfId(id: string): number | null {
  const size = Number(id);
  return id !== TEXT_SIZE_PICTURE && isTextSizePt(size) ? size : null;
}

/** A kind's name: the tool that draws it, and the row an annotation of it is listed as. */
export function annotationKindLabel(t: TFunction, kind: DiagramAnnotationKind): string {
  switch (kind) {
    case 'valley-arrow':
      return t('tools:diagram.toolValleyArrow', 'Valley Fold Arrow');
    case 'mountain-arrow':
      return t('tools:diagram.toolMountainArrow', 'Mountain Fold Arrow');
    case 'fold-unfold-arrow':
      return t('tools:diagram.toolFoldUnfoldArrow', 'Fold and Unfold Arrow');
    case 'pleat-arrow':
      return t('tools:diagram.toolPleatArrow', 'Pleat Arrow');
    case 'push-arrow':
      return t('tools:diagram.toolPushArrow', 'Push Arrow');
    case 'white-arrow':
      return t('tools:diagram.toolWhiteArrow', 'White Arrow');
    case 'turn-over':
      return t('tools:diagram.toolTurnOver', 'Turn Over');
    case 'rotate':
      return t('tools:diagram.toolRotate', 'Rotate');
    case 'valley-line':
      return t('tools:diagram.toolValleyLine', 'Valley Line');
    case 'mountain-line':
      return t('tools:diagram.toolMountainLine', 'Mountain Line');
    case 'hidden-line':
      return t('tools:diagram.toolHiddenLine', 'Hidden Line');
    case 'solid-line':
      return t('tools:diagram.toolSolidLine', 'Solid Line');
    case 'label':
      return t('tools:diagram.toolLabel', 'Label');
    case 'circle':
      return t('tools:diagram.toolCircle', 'Circle');
    case 'right-angle':
      return t('tools:diagram.toolRightAngle', 'Right Angle');
    case 'callout':
      return t('tools:diagram.toolCallout', 'Callout');
    case 'angle-mark':
      return t('tools:diagram.toolAngleMark', 'Equal Angles');
    case 'divisions':
      return t('tools:diagram.toolDivisions', 'Equal Divisions');
    case 'close-up':
      return t('tools:diagram.toolCloseUp', 'Close-Up');
    case 'zoom':
      return t('panels:diagram.annotations.enlargeArea', 'Enlarge Area');
    case 'star':
      return t('tools:diagram.toolStar', 'Star');
    case 'eye':
      return t('tools:diagram.toolEye', 'Eye');
    case 'oval':
      return t('tools:diagram.toolOval', 'Oval');
    case 'rectangle':
      return t('tools:diagram.toolRectangle', 'Rectangle');
    case 'x-ray':
      return t('tools:diagram.toolXRay', 'X-Ray');
  }
}

/**
 * An annotation's name, by its look where its look names it: a white arrow
 * filled with ink is a Solid Arrow (15d), as the tool that lays one is.
 */
export function annotationLabel(t: TFunction, annotation: Pick<KnownDiagramAnnotation, 'kind' | 'fill'>): string {
  return isSolidArrow(annotation) ? t('tools:diagram.toolSolidArrow', 'Solid Arrow') : annotationKindLabel(t, annotation.kind);
}

export function annotateToolLabel(t: TFunction, tool: AnnotateTool): string {
  if (tool === null) return t('panels:diagram.annotate.select', 'Select');
  if (tool === EDIT_PATH) return t('tools:diagram.toolEditPath', 'Edit Path');
  if (tool === LINE_TOOL) return t('tools:diagram.toolLine', 'Line');
  if (tool === ANGLE_BISECTOR) return t('tools:diagram.toolAngleBisector', 'Angle Bisector');
  if (tool === SOLID_ARROW) return t('tools:diagram.toolSolidArrow', 'Solid Arrow');
  if (tool === ENLARGE) return t('tools:diagram.toolEnlarge', 'Enlarge');
  if (tool === ENLARGE_FRAME) return t('tools:diagram.toolEnlargeFrame', 'Enlarge in Frame');
  return annotationKindLabel(t, tool);
}

/** What a tool does, in a line: the tool window says it under the tool's name, and the rail's tooltip after it. */
export function annotateToolHelp(t: TFunction, tool: AnnotateTool): string {
  if (tool === null) {
    return t(
      'panels:diagram.annotate.selectHelp',
      'Click an annotation to select it. Drag it, or the dot at either end, to move it. A label that hangs off a dot moves by its words alone; drag its dot to move both. Drag equal divisions to set how far off their line they sit. Double-click a fold or white arrow to shape it.'
    );
  }
  switch (tool) {
    case EDIT_PATH:
      return t(
        'panels:diagram.annotate.editPathHelp',
        'Drag an arrow’s nodes, their handles or its curve to shape it. Click the curve to add a node; double-click a node to make it a corner or smooth.'
      );
    case 'valley-arrow':
    case 'mountain-arrow':
      return t('panels:diagram.annotate.arrowHelp', 'Drag from where the paper starts to where it lands.');
    case 'fold-unfold-arrow':
      return t(
        'panels:diagram.annotate.foldUnfoldHelp',
        'Drag from where the paper starts to where it lands: it folds over, then back.'
      );
    case 'pleat-arrow':
      return t('panels:diagram.annotate.pleatHelp', 'Drag the way the paper is pleated or crimped.');
    case 'push-arrow':
      return t('panels:diagram.annotate.pushHelp', 'Drag toward the place to push.');
    case 'white-arrow':
    case SOLID_ARROW:
      return t(
        'panels:diagram.annotate.whiteArrowHelp',
        'Drag from where the paper starts to where it goes. Shape it with Edit Path.'
      );
    case LINE_TOOL:
      return t('panels:diagram.annotate.lineHelp', 'Drag along the crease.');
    case ANGLE_BISECTOR:
      return t(
        'panels:diagram.annotate.bisectorHelp',
        'Click three points, the vertex second, or two lines; then the line it runs to.'
      );
    case 'angle-mark':
      return t('panels:diagram.annotate.angleMarkHelp', 'Click a point on one arm, the vertex, then a point on the other arm.');
    case 'divisions':
      return t(
        'panels:diagram.annotate.divisionsHelp',
        'Drag along a line from one end to the other, or click it, to divide it; then type how many parts. With Select, drag the mark to set how far off the line it sits.'
      );
    case 'label':
      return t('panels:diagram.annotate.labelHelp', 'Click where the label goes, then type it in the Layers pane.');
    case 'circle':
      return t('panels:diagram.annotate.circleHelp', 'Click a point to circle it.');
    case 'star':
      return t('panels:diagram.annotate.starHelp', 'Click a point to mark it with a star.');
    case 'eye':
      return t(
        'panels:diagram.annotate.eyeHelp',
        'Drag from where the viewer stands toward what they look at, or click to look at the middle.'
      );
    case 'right-angle':
      return t(
        'panels:diagram.annotate.rightAngleHelp',
        'Click inside a right angle to mark it, or drag from a corner into the angle.'
      );
    case 'close-up':
      return t(
        'panels:diagram.annotate.closeUpHelp',
        'Drag out from the middle of the area to show larger, or click it. With Select, drag either circle to move it, or its ring to resize it.'
      );
    case 'callout':
      return t(
        'panels:diagram.annotate.calloutHelp',
        'Drag from a point to where the box goes, or click the point, then type its words in the Layers pane.'
      );
    case ENLARGE:
      return t(
        'panels:diagram.annotate.enlargeHelp',
        'Drag out from the middle of an area to mark it for an enlarged step. Click for a standard size.'
      );
    case ENLARGE_FRAME:
      return t(
        'panels:diagram.annotate.enlargeFrameHelp',
        'Drag from corner to corner round an area to mark it for an enlarged step. Click for a standard size.'
      );
    case 'oval':
    case 'rectangle':
      return t(
        'panels:diagram.annotate.shapeHelp',
        'Drag from corner to corner round an area to ring it. Click for a standard size.'
      );
    case 'x-ray':
      return t(
        'panels:diagram.annotate.xRayHelp',
        'Drag out from the middle of an area to see through its top layer, or click for a standard size; then type how many layers to take away.'
      );
  }
}

export function annotateGroupLabel(t: TFunction, group: AnnotateToolGroupId): string {
  switch (group) {
    case 'select':
      return t('panels:diagram.annotate.groupSelect', 'Select');
    case 'arrows':
      return t('panels:diagram.annotate.groupArrows', 'Arrows');
    case 'lines':
      return t('panels:diagram.annotate.groupLines', 'Lines');
    case 'marks':
      return t('panels:diagram.annotate.groupMarks', 'Marks');
    case 'shapes':
      return t('panels:diagram.annotate.groupShapes', 'Shapes');
    case 'text':
      return t('panels:diagram.annotate.groupText', 'Text');
  }
}

/**
 * What Edit Path says in the tool window about the annotation selected, by
 * its kind: how to shape a fold or white arrow, or that nothing else is
 * shaped (decision 1) — it edits nothing then.
 */
export function editPathHelp(t: TFunction, selected: DiagramAnnotationKind | null): string {
  if (selected === null) {
    return t('panels:diagram.annotate.editPathNone', 'Select a fold arrow or a white arrow to shape it.');
  }
  if (!canBeShaped(selected)) {
    return t('panels:diagram.annotate.editPathCannot', 'Only fold arrows and white arrows can be shaped.');
  }
  return annotateToolHelp(t, EDIT_PATH);
}

/** Whether the tool is placed with a click rather than drawn with a drag. */
export function isClickTool(tool: AnnotateTool): boolean {
  // What it draws: no line, in any type, is put down with a click.
  const kind = drawingKind(tool, DEFAULT_DIAGRAM_LINE_TYPE);
  return kind !== null && isPointKind(kind);
}

/** What the tool window can promise on this device, and the names of its keys. */
export interface AnnotateToolHost {
  /** A finger: no keys to hold, so none are offered. */
  coarse: boolean;
  /** The platform's name for the key that places freely: Cmd or Ctrl (`primaryModifierLabel`). */
  primary: string;
  /** Its name for Alt: Option or Alt (`altModifierLabel`). */
  alt: string;
}

/**
 * What the tool window says for the tool in hand (decision 7): its name, how
 * to use it, and the keys held while using it, a line each — as the canvas
 * honours them (`useAnnotateCanvas`, `editPathGesture`, `rightAnglePlacement`).
 */
export interface AnnotateToolHint {
  title: string;
  instructions: string;
  modifiers: readonly string[];
}

/**
 * The tool window for `tool`. Edit Path says what it can do to the selected
 * annotation, by its kind (null for none selected). A pick tool says what its
 * next press is for; a drawing tool, what its last press could not do, when
 * it set a `notice`. None for Select, where Annotate rests, as Edit's Box
 * Select and the Simulator's orbit have none: up whenever Annotate is open,
 * it would lie over the Step pane's last fields.
 */
export function annotateToolHint(
  t: TFunction,
  tool: AnnotateTool,
  selected: DiagramAnnotationKind | null,
  host: AnnotateToolHost,
  progress: PickProgress | null = null,
  notice: ToolNotice | null = null
): AnnotateToolHint | null {
  if (tool === null) return null;
  let instructions: string;
  if (tool === EDIT_PATH) instructions = editPathHelp(t, selected);
  else if (isPickTool(tool) && progress) instructions = pickHelp(t, progress);
  else if (notice !== null && notice.tool === tool) instructions = noticeHelp(t, notice);
  else if (host.coarse && (tool === 'label' || tool === 'callout' || tool === 'divisions' || tool === 'x-ray')) {
    instructions = textHelpOnTouch(t, tool);
  }
  else instructions = annotateToolHelp(t, tool);
  return {
    title: annotateToolLabel(t, tool),
    instructions,
    modifiers: host.coarse ? [] : annotateToolModifiers(t, tool, host),
  };
}

/**
 * What a pick tool's next press is for (15b), and — when its last sequence
 * drew nothing — why, first.
 */
function pickHelp(t: TFunction, { step, refusal }: PickProgress): string {
  const next = (() => {
    switch (step) {
      case 'first':
        return t('panels:diagram.annotate.bisectFirst', 'Click a point on one arm of the angle, or a line.');
      case 'vertex':
        return t('panels:diagram.annotate.bisectVertex', 'Click the angle’s vertex.');
      case 'third':
        return t('panels:diagram.annotate.bisectThird', 'Click a point on the other arm.');
      case 'end':
      case 'line-end':
        return t('panels:diagram.annotate.bisectEnd', 'Click the line it runs to, or where it ends.');
      case 'second-line':
        return t('panels:diagram.annotate.bisectSecondLine', 'Click the second line.');
      case 'parallel-first-end':
        return t('panels:diagram.annotate.bisectParallelFirst', 'The lines are parallel: click the line one end of the midline runs to.');
      case 'parallel-second-end':
        return t('panels:diagram.annotate.bisectParallelSecond', 'Click the line its other end runs to.');
      case 'arm':
        return t('panels:diagram.annotate.markArm', 'Click a point on one arm of the angle.');
      case 'mark-vertex':
        return t('panels:diagram.annotate.markVertex', 'Click the angle’s vertex.');
      case 'other-arm':
        return t('panels:diagram.annotate.markOtherArm', 'Click a point on the other arm.');
    }
  })();
  if (refusal === null) return next;
  const why = (() => {
    switch (refusal) {
      case 'no-angle':
        return t('panels:diagram.annotate.refusedNoAngle', 'Those make no angle.');
      case 'parallel':
        return t('panels:diagram.annotate.refusedParallel', 'It runs along that line, so it meets it nowhere.');
      case 'no-length':
        return t('panels:diagram.annotate.refusedNoLength', 'It would have no length.');
    }
  })();
  return `${why} ${next}`;
}

/**
 * What a drawing tool's last press could not do, and what to do instead:
 * equal divisions clicked on no line; an x-ray laid off the paper.
 */
function noticeHelp(t: TFunction, notice: ToolNotice): string {
  switch (notice.notice) {
    case 'no-line':
      return t('panels:diagram.annotate.divisionsNoLine', 'Click on a line to divide it whole, or drag from one end to the other.');
    case 'no-paper':
      return t('panels:diagram.annotate.xRayNoPaper', 'Start on the paper: a window peels away the layers inside it.');
  }
}

/**
 * A label's, a callout's, equal divisions' and an x-ray's help on a touch
 * screen, which keeps the Layers pane as a tab of the sheet behind its
 * Settings pill: the field their words, their count or its depth are typed in
 * named where that surface shows it, in its own words.
 */
function textHelpOnTouch(t: TFunction, tool: 'label' | 'callout' | 'divisions' | 'x-ray'): string {
  const where = { sheet: t('common:viewDrawer.openSettings', 'Settings'), tab: t('panels:sidePane.layers', 'Layers') };
  switch (tool) {
    case 'label':
      return t('panels:diagram.annotate.labelHelpTouch', 'Click where the label goes, then type it in {{sheet}}, under {{tab}}.', where);
    case 'callout':
      return t(
        'panels:diagram.annotate.calloutHelpTouch',
        'Drag from a point to where the box goes, or click the point, then type its words in {{sheet}}, under {{tab}}.',
        where
      );
    case 'divisions':
      return t(
        'panels:diagram.annotate.divisionsHelpTouch',
        'Drag along a line from one end to the other, or click it, to divide it; then type how many parts in {{sheet}}, under {{tab}}.',
        where
      );
    case 'x-ray':
      return t(
        'panels:diagram.annotate.xRayHelpTouch',
        'Drag out from the middle of an area to see through its top layer, or click for a standard size; then set how many layers to take away in {{sheet}}, under {{tab}}.',
        where
      );
  }
}

/**
 * The keys a tool honours, a line each: ⌘ (Ctrl) puts what snaps down
 * anywhere (an arrow snaps nowhere, `snapsWhenPlaced`); Shift holds a right
 * angle to 45° steps, an eye to 15° steps as it is laid or turned (Revision
 * 3), equal divisions' line to half millimetres as Select
 * drags it, and in Edit Path a node to the eight directions and a handle to
 * 15° steps; Alt breaks a smooth node's handles apart. A switch, so a new
 * tool has to say.
 */
function annotateToolModifiers(
  t: TFunction,
  tool: Exclude<AnnotateTool, null>,
  { primary, alt }: AnnotateToolHost
): string[] {
  switch (tool) {
    case EDIT_PATH:
      return [
        t('panels:diagram.annotate.nodeShiftKey', 'Shift-drag a node to move it only across, up and down, or at 45°.'),
        t('panels:diagram.annotate.handleShiftKey', 'Shift-drag a handle to turn it in 15° steps.'),
        t(
          'panels:diagram.annotate.handleAltKey',
          '{{modifier}}-drag a smooth node’s handle to move it alone: the node becomes a corner.',
          { modifier: alt }
        ),
      ];
    case LINE_TOOL:
      return [
        t('panels:diagram.annotate.endsFreeKey', 'Hold {{modifier}} to put an end down anywhere, without snapping.', {
          modifier: primary,
        }),
      ];
    case ANGLE_BISECTOR:
    case 'angle-mark':
      return [
        t('panels:diagram.annotate.pickFreeKey', 'Hold {{modifier}} to put a point down anywhere, without snapping.', {
          modifier: primary,
        }),
      ];
    case 'circle':
      return [
        t('panels:diagram.annotate.circleFreeKey', 'Hold {{modifier}} to put it down anywhere, without snapping.', {
          modifier: primary,
        }),
      ];
    case 'star':
      return [
        t('panels:diagram.annotate.circleFreeKey', 'Hold {{modifier}} to put it down anywhere, without snapping.', {
          modifier: primary,
        }),
        // With Select, or the Star still in hand (18d): no "With Select" to send the author to it.
        t('panels:diagram.annotate.starShiftKey', 'Shift-drag a round handle at a corner to turn it in 15° steps.'),
      ];
    case 'eye':
      // Put down freely (R3-24 A): no ⌘ line. Its drag sets the way it looks, as its box's turn handles turn it.
      return [
        t('panels:diagram.annotate.eyeShiftKey', 'Shift-drag to set the way it looks in 15° steps.'),
        // The star's words, a key of their own: several languages name the star, or agree with it.
        t('panels:diagram.annotate.eyeBoxShiftKey', 'Shift-drag a round handle at a corner to turn it in 15° steps.'),
      ];
    case 'right-angle':
      return [
        t('panels:diagram.annotate.rightAngleShiftKey', 'Shift-drag to open it in 45° steps where it finds no right angle.'),
        t(
          'panels:diagram.annotate.cornerFreeKey',
          'Hold {{modifier}} to put the corner it marks down anywhere, without snapping.',
          { modifier: primary }
        ),
      ];
    case 'divisions':
      return [
        t('panels:diagram.annotate.endsFreeKey', 'Hold {{modifier}} to put an end down anywhere, without snapping.', {
          modifier: primary,
        }),
        t('panels:diagram.annotate.divisionsShiftKey', 'With Select, Shift-drag the mark to move its line by half millimetres.'),
      ];
    case 'close-up':
      return [t('panels:diagram.annotate.closeUpShiftKey', 'Shift-drag the close-up’s ring to scale it by halves.')];
    case ENLARGE_FRAME:
      return [
        t('panels:diagram.annotate.enlargeFrameShiftKey', 'Shift-drag to make it square.'),
        t('panels:diagram.annotate.enlargeFrameAltKey', '{{modifier}}-drag to draw it out from its middle.', {
          modifier: alt,
        }),
      ];
    case 'oval':
    case 'rectangle':
      // Put down freely (R3-24 A): no ⌘ line. Laid as Enlarge in Frame's area is, in its words — keys of their own,
      // as the eye's are: several languages' "it" agrees with the area they name — and its box resized by R3-29c's keys.
      return [
        tool === 'oval'
          ? t('panels:diagram.annotate.ovalShiftKey', 'Shift-drag to make it a circle.')
          : t('panels:diagram.annotate.rectangleShiftKey', 'Shift-drag to make it square.'),
        t('panels:diagram.annotate.shapeAltKey', '{{modifier}}-drag to draw it out from its middle.', {
          modifier: alt,
        }),
        t(
          'panels:diagram.annotate.shapeBoxShiftKey',
          'Shift-drag a square to keep its proportions, or a round handle to turn it in 15° steps.'
        ),
        t('panels:diagram.annotate.shapeBoxAltKey', '{{modifier}}-drag a square to resize it about its middle.', {
          modifier: alt,
        }),
      ];
    case 'callout':
      return [
        t('panels:diagram.annotate.pointFreeKey', 'Hold {{modifier}} to put its point down anywhere, without snapping.', {
          modifier: primary,
        }),
      ];
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'pleat-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case SOLID_ARROW:
    case 'label':
    case ENLARGE:
    case 'x-ray':
      return [];
  }
}
