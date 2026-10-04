import type { TFunction } from 'i18next';
import type { DiagramAnnotateShortcutId } from '../../keyboard/shortcuts';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import { ANNOTATION_KINDS, canBeShaped, isPointKind } from './annotationModel';

/**
 * Annotate's tools (D8), for every surface that offers them: the rail beside
 * the canvas, the keys, and the Step pane's name and help for the one in
 * hand. React-free and store-free, as `diagramActions.ts` is; each surface
 * draws its own.
 */

/**
 * Edit Path (decision 3): the tool that shapes the selected fold arrow by its
 * nodes, handles and curve, as Affinity's Node tool does. It draws nothing.
 */
export const EDIT_PATH = 'edit-path';

/** A kind to draw, Edit Path, or Select. */
export type AnnotateTool = DiagramAnnotationKind | typeof EDIT_PATH | null;

/** The kind a tool draws; null for Select and Edit Path, which draw nothing. */
export function drawingKind(tool: AnnotateTool): DiagramAnnotationKind | null {
  return tool === null || tool === EDIT_PATH ? null : tool;
}

export type AnnotateToolGroupId = 'select' | 'arrows' | 'lines' | 'text';

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
  'turn-over': 'arrows',
  rotate: 'arrows',
  'valley-line': 'lines',
  'mountain-line': 'lines',
  'hidden-line': 'lines',
  label: 'text',
};

/** The rail's groups, in order: Select and Edit Path; Arrows; Lines; Text — each kind's tool in its group, in kind order. */
export const ANNOTATE_TOOL_GROUPS: readonly AnnotateToolGroup[] = [
  { id: 'select', tools: [null, EDIT_PATH] },
  ...(['arrows', 'lines', 'text'] as const).map((id) => ({
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
  'turn-over': 'diagram.toolTurnOver',
  rotate: 'diagram.toolRotate',
  'valley-line': 'diagram.toolValleyLine',
  'mountain-line': 'diagram.toolMountainLine',
  'hidden-line': 'diagram.toolHiddenLine',
  label: 'diagram.toolLabel',
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
  }
}

export function annotateToolLabel(t: TFunction, tool: AnnotateTool): string {
  if (tool === null) return t('panels:diagram.annotate.select', 'Select');
  if (tool === EDIT_PATH) return t('tools:diagram.toolEditPath', 'Edit Path');
  return annotationKindLabel(t, tool);
}

/** What the tool in hand does, in a line: the Step pane says it under the tool's name. */
export function annotateToolHelp(t: TFunction, tool: AnnotateTool): string {
  if (tool === null) {
    return t(
      'panels:diagram.annotate.selectHelp',
      'Click an annotation to select it. Drag it, or the dot at either end, to move it. Double-click a fold arrow to shape it.'
    );
  }
  switch (tool) {
    case EDIT_PATH:
      return t(
        'panels:diagram.annotate.editPathHelp',
        'Drag a fold arrow’s nodes, their handles or its curve to shape it. Click the curve to add a node; double-click a node to make it a corner or smooth.'
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
    case 'valley-line':
    case 'mountain-line':
    case 'hidden-line':
      return t('panels:diagram.annotate.lineHelp', 'Drag along the crease.');
    case 'turn-over':
    case 'rotate':
      return t('panels:diagram.annotate.glyphHelp', 'Click where the sign goes.');
    case 'label':
      return t('panels:diagram.annotate.labelHelp', 'Click where the label goes, then type it here.');
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
    case 'text':
      return t('panels:diagram.annotate.groupText', 'Text');
  }
}

/**
 * What Edit Path says in the Step pane about the annotation selected: how to
 * shape a fold arrow, or that nothing else is shaped (decision 1) — it edits
 * nothing then.
 */
export function editPathHelp(t: TFunction, selected: KnownDiagramAnnotation | null): string {
  if (selected === null) return t('panels:diagram.annotate.editPathNone', 'Select a fold arrow to shape it.');
  if (!canBeShaped(selected.kind)) {
    return t(
      'panels:diagram.annotate.editPathCannot',
      'Only fold arrows can be shaped: valley, mountain, and fold and unfold arrows.'
    );
  }
  return annotateToolHelp(t, EDIT_PATH);
}

/** Whether the tool is placed with a click rather than drawn with a drag. */
export function isClickTool(tool: AnnotateTool): boolean {
  const kind = drawingKind(tool);
  return kind !== null && isPointKind(kind);
}
