import type { TFunction } from 'i18next';
import type { DiagramAnnotateShortcutId } from '../../keyboard/shortcuts';
import type { DiagramAnnotationKind } from '../document/diagramDocument';
import { ANNOTATION_KINDS, canBeShaped, isPointKind } from './annotationModel';

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

/** A kind to draw, Edit Path, or Select. */
export type AnnotateTool = DiagramAnnotationKind | typeof EDIT_PATH | null;

/** The kind a tool draws; null for Select and Edit Path, which draw nothing. */
export function drawingKind(tool: AnnotateTool): DiagramAnnotationKind | null {
  return tool === null || tool === EDIT_PATH ? null : tool;
}

export type AnnotateToolGroupId = 'select' | 'arrows' | 'lines' | 'marks' | 'text';

export interface AnnotateToolGroup {
  id: AnnotateToolGroupId;
  tools: readonly AnnotateTool[];
}

/** The group each kind's tool is in on the rail: a record, so no kind can be left off it. */
const TOOL_GROUP: Readonly<Record<DiagramAnnotationKind, Exclude<AnnotateToolGroupId, 'select'>>> = {
  'valley-arrow': 'arrows',
  'mountain-arrow': 'arrows',
  'fold-unfold-arrow': 'arrows',
  'push-arrow': 'arrows',
  'white-arrow': 'arrows',
  'turn-over': 'arrows',
  rotate: 'arrows',
  'valley-line': 'lines',
  'mountain-line': 'lines',
  'hidden-line': 'lines',
  label: 'text',
  circle: 'marks',
  'right-angle': 'marks',
  callout: 'text',
};

/** The rail's groups, in order: Select and Edit Path; Arrows; Lines; Marks; Text — each kind's tool in its group, in kind order. */
export const ANNOTATE_TOOL_GROUPS: readonly AnnotateToolGroup[] = [
  { id: 'select', tools: [null, EDIT_PATH] },
  ...(['arrows', 'lines', 'marks', 'text'] as const).map((id) => ({
    id,
    tools: ANNOTATION_KINDS.filter((kind) => TOOL_GROUP[kind] === id),
  })),
];

/** Each kind's tool key. */
export const ANNOTATE_TOOL_SHORTCUTS: Readonly<Record<DiagramAnnotationKind, DiagramAnnotateShortcutId>> = {
  'valley-arrow': 'diagram.toolValleyArrow',
  'mountain-arrow': 'diagram.toolMountainArrow',
  'fold-unfold-arrow': 'diagram.toolFoldUnfoldArrow',
  'push-arrow': 'diagram.toolPushArrow',
  'white-arrow': 'diagram.toolWhiteArrow',
  'turn-over': 'diagram.toolTurnOver',
  rotate: 'diagram.toolRotate',
  'valley-line': 'diagram.toolValleyLine',
  'mountain-line': 'diagram.toolMountainLine',
  'hidden-line': 'diagram.toolHiddenLine',
  label: 'diagram.toolLabel',
  circle: 'diagram.toolCircle',
  'right-angle': 'diagram.toolRightAngle',
  callout: 'diagram.toolCallout',
};

/** Edit Path's key. */
export const EDIT_PATH_SHORTCUT: DiagramAnnotateShortcutId = 'diagram.toolEditPath';

/** The key that picks a tool; Select has none (Escape puts a tool down). */
export function annotateToolShortcut(tool: AnnotateTool): DiagramAnnotateShortcutId | undefined {
  if (tool === null) return undefined;
  return tool === EDIT_PATH ? EDIT_PATH_SHORTCUT : ANNOTATE_TOOL_SHORTCUTS[tool];
}

/** The tool a tool key picks; undefined for a key that is not a tool's (Flip arc). */
export function toolForShortcut(id: DiagramAnnotateShortcutId): Exclude<AnnotateTool, null> | undefined {
  if (id === EDIT_PATH_SHORTCUT) return EDIT_PATH;
  return (Object.keys(ANNOTATE_TOOL_SHORTCUTS) as DiagramAnnotationKind[]).find(
    (kind) => ANNOTATE_TOOL_SHORTCUTS[kind] === id
  );
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
  }
}

export function annotateToolLabel(t: TFunction, tool: AnnotateTool): string {
  if (tool === null) return t('panels:diagram.annotate.select', 'Select');
  if (tool === EDIT_PATH) return t('tools:diagram.toolEditPath', 'Edit Path');
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
    case 'push-arrow':
      return t('panels:diagram.annotate.pushHelp', 'Drag toward the place to push.');
    case 'white-arrow':
      return t(
        'panels:diagram.annotate.whiteArrowHelp',
        'Drag from where the paper starts to where it goes. Shape it with Edit Path.'
      );
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
      return t('panels:diagram.annotate.lineHelp', 'Drag along the crease.');
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
  const kind = drawingKind(tool);
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
  host: AnnotateToolHost
): AnnotateToolHint | null {
  if (tool === null) return null;
  let instructions: string;
  if (tool === EDIT_PATH) instructions = editPathHelp(t, selected);
  else if (host.coarse && (tool === 'label' || tool === 'callout')) instructions = textHelpOnTouch(t, tool);
  else instructions = annotateToolHelp(t, tool);
  return {
    title: annotateToolLabel(t, tool),
    instructions,
    modifiers: host.coarse ? [] : annotateToolModifiers(t, tool, host),
  };
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
 * anywhere; Shift holds a right angle to 45° steps, and in Edit Path a node
 * to the eight directions and a handle to 15° steps; Alt breaks a smooth
 * node's handles apart. A switch, so a new tool has to say.
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
    case 'valley-arrow':
    case 'mountain-arrow':
    case 'fold-unfold-arrow':
    case 'push-arrow':
    case 'white-arrow':
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
      return [
        t('panels:diagram.annotate.endsFreeKey', 'Hold {{modifier}} to put an end down anywhere, without snapping.', {
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
    case 'turn-over':
    case 'rotate':
    case 'label':
      return [];
  }
}
