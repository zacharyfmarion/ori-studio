import type { TFunction } from 'i18next';
import type { DiagramAnnotateShortcutId } from '../../keyboard/shortcuts';
import type { DiagramAnnotationKind } from '../document/diagramDocument';
import { ANNOTATION_KINDS, isPointKind } from './annotationModel';

/**
 * Annotate's tools (D8), for every surface that offers them: the rail beside
 * the canvas, the keys, and the Step pane's name and help for the one in
 * hand. React-free and store-free, as `diagramActions.ts` is; each surface
 * draws its own.
 */

/** A kind to draw, or Select. */
export type AnnotateTool = DiagramAnnotationKind | null;

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

/** The rail's groups, in order: Select; Arrows; Lines; Text — each kind's tool in its group, in kind order. */
export const ANNOTATE_TOOL_GROUPS: readonly AnnotateToolGroup[] = [
  { id: 'select', tools: [null] },
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

/** The kind a tool key picks; undefined for a key that is not a tool's (Flip arc). */
export function toolForShortcut(id: DiagramAnnotateShortcutId): DiagramAnnotationKind | undefined {
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
  return tool === null ? t('panels:diagram.annotate.select', 'Select') : annotationKindLabel(t, tool);
}

/** What the tool in hand does, in a line: the Step pane says it under the tool's name. */
export function annotateToolHelp(t: TFunction, tool: AnnotateTool): string {
  if (tool === null) {
    return t(
      'panels:diagram.annotate.selectHelp',
      'Click an annotation to select it. Drag it, or the dot at either end, to move it.'
    );
  }
  switch (tool) {
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

/** Whether the tool is placed with a click rather than drawn with a drag. */
export function isClickTool(tool: AnnotateTool): boolean {
  return tool !== null && isPointKind(tool);
}
