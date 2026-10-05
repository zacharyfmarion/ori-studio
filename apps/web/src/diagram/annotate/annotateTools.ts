import type { TFunction } from 'i18next';
import type { DiagramAnnotateShortcutId } from '../../keyboard/shortcuts';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import { canBeShaped, isPointKind, isSolidArrow, SOLID_ARROW_LOOK, type WhiteArrowLook } from './annotationModel';
import { DEFAULT_DIAGRAM_LINE_TYPE, lineKindOf, type DiagramLineKind, type DiagramLineType } from './lineTypes';
import type { PickProgress } from './pickProgress';

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
 * valley, a mountain or a hidden line, each a kind of its own.
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
 * A tool that draws: the kind it draws, for every kind but the three lines,
 * which the Line tool draws in the type chosen; the Angle Bisector, which
 * draws a line and a mark; and the Solid Arrow, a white arrow in a look of
 * its own. Its own id, so a tool need not be a kind.
 */
export type DrawingTool =
  | Exclude<DiagramAnnotationKind, DiagramLineKind>
  | typeof LINE_TOOL
  | typeof ANGLE_BISECTOR
  | typeof SOLID_ARROW;

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
  return tool === LINE_TOOL ? lineKindOf(lineType) : tool;
}

/** The look a tool lays what it draws in, over its kind's own: the Solid Arrow's; nothing for any other tool. */
export function drawingLook(tool: AnnotateTool): WhiteArrowLook {
  return tool === SOLID_ARROW ? SOLID_ARROW_LOOK : {};
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

export type AnnotateToolGroupId = 'select' | 'arrows' | 'lines' | 'marks' | 'text';

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
  'turn-over': 'arrows',
  rotate: 'arrows',
  [LINE_TOOL]: 'lines',
  [ANGLE_BISECTOR]: 'lines',
  label: 'text',
  circle: 'marks',
  'right-angle': 'marks',
  'angle-mark': 'marks',
  callout: 'text',
};

/** The drawing tools in the order the rail offers them, each in its group. */
export const DRAWING_TOOLS = Object.keys(TOOL_GROUP) as readonly DrawingTool[];

/** The rail's groups, in order: Select and Edit Path; Arrows; Lines; Marks; Text — each tool in its group. */
export const ANNOTATE_TOOL_GROUPS: readonly AnnotateToolGroup[] = [
  { id: 'select', tools: [null, EDIT_PATH] },
  ...(['arrows', 'lines', 'marks', 'text'] as const).map((id) => ({
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
  'turn-over': 'diagram.toolTurnOver',
  rotate: 'diagram.toolRotate',
  [LINE_TOOL]: null,
  [ANGLE_BISECTOR]: 'diagram.toolAngleBisector',
  label: 'diagram.toolLabel',
  circle: 'diagram.toolCircle',
  'right-angle': 'diagram.toolRightAngle',
  'angle-mark': null,
  callout: 'diagram.toolCallout',
};

/**
 * The key that picks each line type — the keys today's three line tools had,
 * so a rebinding carries over. Each picks the Line tool too, unless a tool
 * that draws in the type is already in hand (`runDiagramAnnotateShortcut`).
 */
export const LINE_TYPE_SHORTCUTS: Readonly<Record<DiagramLineType, DiagramAnnotateShortcutId>> = {
  valley: 'diagram.toolValleyLine',
  mountain: 'diagram.toolMountainLine',
  hidden: 'diagram.toolHiddenLine',
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
  }
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
  return annotationKindLabel(t, tool);
}

/** What a tool does, in a line: the tool window says it under the tool's name, and the rail's tooltip after it. */
export function annotateToolHelp(t: TFunction, tool: AnnotateTool): string {
  if (tool === null) {
    return t(
      'panels:diagram.annotate.selectHelp',
      'Click an annotation to select it. Drag it, or the dot at either end, to move it. Double-click a fold or white arrow to shape it.'
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
    case 'turn-over':
    case 'rotate':
      return t('panels:diagram.annotate.glyphHelp', 'Click where the sign goes.');
    case 'label':
      return t('panels:diagram.annotate.labelHelp', 'Click where the label goes, then type it in the Step pane.');
    case 'circle':
      return t('panels:diagram.annotate.circleHelp', 'Click a point to circle it.');
    case 'right-angle':
      return t(
        'panels:diagram.annotate.rightAngleHelp',
        'Click inside a right angle to mark it, or drag from a corner into the angle.'
      );
    case 'callout':
      return t(
        'panels:diagram.annotate.calloutHelp',
        'Drag from a point to where the box goes, or click the point, then type its words in the Step pane.'
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
 * annotation, by its kind (null for none selected). None for Select, where
 * Annotate rests, as Edit's Box Select and the Simulator's orbit have none:
 * up whenever Annotate is open, it would lie over the Step pane's last fields.
 */
export function annotateToolHint(
  t: TFunction,
  tool: AnnotateTool,
  selected: DiagramAnnotationKind | null,
  host: AnnotateToolHost,
  progress: PickProgress | null = null
): AnnotateToolHint | null {
  if (tool === null) return null;
  let instructions: string;
  if (tool === EDIT_PATH) instructions = editPathHelp(t, selected);
  else if (isPickTool(tool) && progress) instructions = pickHelp(t, progress);
  else if (host.coarse && (tool === 'label' || tool === 'callout')) instructions = textHelpOnTouch(t, tool);
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
 * A label's and a callout's help on a touch screen, which keeps the Step pane
 * as a tab of the sheet behind its Settings pill: the field its words are
 * typed in named where that surface shows it, in its own words.
 */
function textHelpOnTouch(t: TFunction, tool: 'label' | 'callout'): string {
  const where = { sheet: t('common:viewDrawer.openSettings', 'Settings'), tab: t('panels:sidePane.step', 'Step') };
  return tool === 'label'
    ? t('panels:diagram.annotate.labelHelpTouch', 'Click where the label goes, then type it in {{sheet}}, under {{tab}}.', where)
    : t(
        'panels:diagram.annotate.calloutHelpTouch',
        'Drag from a point to where the box goes, or click the point, then type its words in {{sheet}}, under {{tab}}.',
        where
      );
}

/**
 * The keys a tool honours, a line each: ⌘ (Ctrl) puts what snaps down
 * anywhere (an arrow snaps nowhere, `snapsWhenPlaced`); Shift holds a right
 * angle to 45° steps, and in Edit Path a node to the eight directions and a
 * handle to 15° steps; Alt breaks a smooth node's handles apart. A switch, so
 * a new tool has to say.
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
    case 'right-angle':
      return [
        t('panels:diagram.annotate.rightAngleShiftKey', 'Shift-drag to open it in 45° steps where it finds no right angle.'),
        t('panels:diagram.annotate.cornerFreeKey', 'Hold {{modifier}} to put its corner down anywhere, without snapping.', {
          modifier: primary,
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
    case 'turn-over':
    case 'rotate':
    case 'label':
      return [];
  }
}
