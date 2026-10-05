import type { TFunction } from 'i18next';
import type { DiagramArrowShapeGesture } from '../../analytics/events';
import type { ShortcutActionId } from '../../keyboard/shortcuts';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  MAX_PATH_NODES,
  canBeShaped,
  flipAnnotationArc,
  flipChangesArc,
  flipsArc,
  isCornerKind,
  isShapedArrow,
  turnRightAngle,
  type PictureFrame,
  type PicturePoint,
} from './annotationModel';
import {
  canResetPath,
  deletePathNode,
  movePathNode,
  pathNodesOf,
  resetPath,
  setPathNodeType,
  splitPathSegment,
} from './annotationPath';

/**
 * The verbs an annotation offers, for every surface that offers them: the
 * Step pane's buttons under the selected annotation, and Annotate's keys — F,
 * Delete through `edit.delete`, and the arrows that nudge a node.
 *
 * `foldedFigureActions.ts`'s shape: React-free and store-free, taking the
 * annotation and a bound edit and returning plain data. A verb's gate and its
 * edit are here once, so the pane and the keys cannot drift, and each surface
 * owns only its rendering.
 *
 * With Edit Path in hand on a fold or white arrow (decision 3) the node verbs join
 * them: step from node to node, make one smooth or a corner, add one, take
 * one out. Every edit takes the arrow as it is when it lands, arc or path, so
 * the first one shapes an arc.
 */
export type AnnotationActionId =
  | 'previous-node'
  | 'next-node'
  | 'smooth-node'
  | 'corner-node'
  | 'add-node'
  | 'delete-node'
  | 'flip-arc'
  | 'reset-path'
  | 'turn-right-angle'
  | 'delete';

/** Where a surface puts a verb: with the selected node, or with the annotation as a whole. */
export type AnnotationActionGroup = 'node' | 'annotation';

/** The verbs in the order a surface shows them: the node's, then the annotation's own, then Delete. */
const ANNOTATION_ACTION_ORDER: readonly AnnotationActionId[] = [
  'previous-node',
  'next-node',
  'smooth-node',
  'corner-node',
  'add-node',
  'delete-node',
  'flip-arc',
  'reset-path',
  'turn-right-angle',
  'delete',
];

const NODE_ACTIONS: ReadonlySet<AnnotationActionId> = new Set([
  'previous-node',
  'next-node',
  'smooth-node',
  'corner-node',
  'add-node',
  'delete-node',
]);

/**
 * The key that runs a verb, where one does. Delete is one key for two verbs:
 * the selected node's while there is one, else the annotation's — named on
 * whichever it would run, as `deleteKeyEdit` decides.
 */
function annotationActionShortcut(id: AnnotationActionId, node: number | null): ShortcutActionId | undefined {
  switch (id) {
    case 'flip-arc':
      return 'diagram.flipArc';
    case 'delete-node':
      return node !== null ? 'edit.delete' : undefined;
    case 'delete':
      return node === null ? 'edit.delete' : undefined;
    default:
      return undefined;
  }
}

/** A change to a step's readable annotations, made as one undo step called `label`. */
export interface AnnotationEdit {
  label: string;
  edit: (annotations: readonly KnownDiagramAnnotation[]) => readonly KnownDiagramAnnotation[];
  /** The annotation selected after it; absent, the selection stays. */
  select?: string | null;
  /** The node of the selected arrow selected after it; absent, the node selection stays while it still means a node. */
  selectPathNode?: number | null;
  /**
   * The arrow an edit may shape for the first time, and the gesture that
   * would: what the binding counts once, when an arc becomes a path.
   */
  shapes?: { annotationId: string; gesture: DiagramArrowShapeGesture };
}

export interface AnnotationAction {
  id: AnnotationActionId;
  group: AnnotationActionGroup;
  label: string;
  disabled: boolean;
  /** Smooth or Corner: the type the selected node has. */
  active?: boolean;
  /**
   * The key that runs the same verb, for a surface that shows chords. Its own
   * path: the key goes through the shortcut runtime, which applies the same
   * edit ({@link annotationActionEdit}).
   */
  shortcutId?: ShortcutActionId;
  run: () => void;
}

/** What the verbs are offered against. */
export interface AnnotationActionState {
  /** The step can change: every edit is off on one that cannot. */
  editable: boolean;
  /** Edit Path is in hand: a fold arrow's node verbs are offered. */
  editingPath?: boolean;
  /** The selected node of the arrow, when one is (`selectedDiagramPathNode`). */
  node?: number | null;
  /** The picture's frame, which Reset bends toward when a path lies on neither side of its chord. */
  frame?: PictureFrame;
}

export interface AnnotationActionDeps {
  t: TFunction;
  /** Make the edit on the step the annotation is drawn on. */
  apply: (edit: AnnotationEdit) => void;
  /** Select a node of the selected arrow, or none: view state, not an edit. */
  selectNode?: (node: number | null) => void;
}

/** What an edit that names a node or a picture needs to know. */
export interface AnnotationEditContext {
  node?: number | null;
  /** How many nodes the arrow has: where Add Node's new node lands when the tip is selected. */
  nodes?: number;
  frame?: PictureFrame;
}

const SQUARE: PictureFrame = { width: 1, height: 1 };

/**
 * Whether `annotation` offers a verb at all: the node verbs a fold or white
 * arrow with Edit Path in hand; Flip arc an arc to flip; Reset an arrow
 * shaped (`isShapedArrow`), or any arrow in Edit Path (where it waits for the
 * first edit); Turn 90° a right angle; Delete, every one.
 */
export function offersAnnotationAction(
  id: AnnotationActionId,
  annotation: KnownDiagramAnnotation,
  state: Pick<AnnotationActionState, 'editingPath'> = {}
): boolean {
  const editingPath = state.editingPath === true && canBeShaped(annotation.kind);
  switch (id) {
    case 'previous-node':
    case 'next-node':
    case 'smooth-node':
    case 'corner-node':
    case 'add-node':
    case 'delete-node':
      return editingPath;
    case 'flip-arc':
      return flipsArc(annotation.kind);
    case 'reset-path':
      return editingPath || isShapedArrow(annotation);
    case 'turn-right-angle':
      return isCornerKind(annotation.kind);
    case 'delete':
      return true;
  }
}

/** One annotation edited, as the edit of its step's list: the rest as they were. */
export function editAnnotation(
  annotationId: string,
  change: (annotation: KnownDiagramAnnotation) => KnownDiagramAnnotation | null
): AnnotationEdit['edit'] {
  return (annotations) =>
    annotations.flatMap((annotation) => {
      if (annotation.id !== annotationId) return [annotation];
      const changed = change(annotation);
      return changed ? [changed] : [];
    });
}

/**
 * What a verb does to the annotation `annotationId` names, as an edit of its
 * step's list. Applied to the list as it is when it lands, so an edit made in
 * between is kept. A node verb names its node (`context.node`), and does
 * nothing without one; Reset takes the picture's frame. The two node
 * steppers are not edits, and are left as they are.
 */
export function annotationActionEdit(
  id: Exclude<AnnotationActionId, 'previous-node' | 'next-node'>,
  annotationId: string,
  context: AnnotationEditContext = {}
): AnnotationEdit {
  const node = context.node ?? null;
  const onNode = (change: (annotation: KnownDiagramAnnotation, node: number) => KnownDiagramAnnotation | null) =>
    editAnnotation(annotationId, (annotation) => (node === null ? annotation : change(annotation, node)));
  const shapes = (gesture: DiagramArrowShapeGesture) => ({ shapes: { annotationId, gesture } });
  switch (id) {
    case 'smooth-node':
    case 'corner-node':
      return {
        label: id === 'smooth-node' ? 'Make node smooth' : 'Make node corner',
        edit: onNode((annotation, at) => setPathNodeType(annotation, at, id === 'smooth-node' ? 'smooth' : 'corner')),
        ...shapes('node_type'),
      };
    case 'add-node': {
      // After the selected node, halfway along: before it for the tip, which has nothing after.
      return {
        label: 'Add node',
        edit: onNode((annotation, at) => {
          const count = pathNodesOf(annotation)?.length ?? 0;
          return splitPathSegment(annotation, Math.min(at, count - 2), 0.5);
        }),
        // The node it adds: after the selected one, or before the tip — which then moves on one.
        ...(node !== null
          ? { selectPathNode: (context.nodes !== undefined ? Math.min(node, context.nodes - 2) : node) + 1 }
          : {}),
        ...shapes('add_node'),
      };
    }
    case 'delete-node':
      return {
        label: 'Delete node',
        // A two-node arrow's last node is the arrow (decision 5): it goes too.
        edit: onNode((annotation, at) => deletePathNode(annotation, at)),
        // The node before it, so Delete again goes on along the arrow.
        ...(node !== null ? { selectPathNode: Math.max(0, node - 1) } : {}),
        ...shapes('delete_node'),
      };
    case 'flip-arc':
      return {
        label: 'Flip arc',
        edit: editAnnotation(annotationId, flipAnnotationArc),
      };
    case 'reset-path':
      return {
        label: 'Reset shape',
        edit: editAnnotation(annotationId, (annotation) => resetPath(annotation, context.frame ?? SQUARE)),
        selectPathNode: null,
      };
    case 'turn-right-angle':
      // Into the next quadrant clockwise, about its corner: where a click found the wrong one.
      return {
        label: 'Turn right angle',
        edit: editAnnotation(annotationId, turnRightAngle),
      };
    case 'delete':
      return {
        label: 'Delete annotation',
        edit: (annotations) => annotations.filter((annotation) => annotation.id !== annotationId),
        select: null,
      };
  }
}

/**
 * What Delete (`edit.delete`) does in Annotate: the selected node, while
 * Edit Path has one; otherwise the selected annotation.
 */
export function deleteKeyEdit(annotationId: string, node: number | null): AnnotationEdit {
  return node === null ? annotationActionEdit('delete', annotationId) : annotationActionEdit('delete-node', annotationId, { node });
}

/** How far an arrow key nudges a node, in picture units: a thousandth of the frame, or a hundredth with Shift. */
export const NUDGE_STEP = { small: 0.001, large: 0.01 } as const;

/** A node moved by `delta` (an arrow key, decision 6), as one undo step. */
export function nudgePathNodeEdit(annotationId: string, node: number, delta: PicturePoint): AnnotationEdit {
  return {
    label: 'Nudge node',
    edit: editAnnotation(annotationId, (annotation) => {
      const at = pathNodesOf(annotation)?.[node]?.at;
      return at ? movePathNode(annotation, node, [at[0] + delta[0], at[1] + delta[1]]) : annotation;
    }),
    shapes: { annotationId, gesture: 'nudge' },
  };
}

/**
 * The node a stepper lands on: the next or the one before, stopping at the
 * ends; from none, the first going on and the last going back.
 */
export function steppedNode(node: number | null, count: number, direction: -1 | 1): number | null {
  if (count <= 0) return null;
  if (node === null) return direction > 0 ? 0 : count - 1;
  return Math.min(count - 1, Math.max(0, node + direction));
}

/** A verb's name on an annotation of `kind`: Flip arc, on a pleat arrow, only flips — it has no arc. */
function annotationActionLabel(t: TFunction, id: AnnotationActionId, kind: DiagramAnnotationKind): string {
  switch (id) {
    case 'previous-node':
      return t('panels:diagram.annotations.previousNode', 'Previous Node');
    case 'next-node':
      return t('panels:diagram.annotations.nextNode', 'Next Node');
    case 'smooth-node':
      return t('panels:diagram.annotations.smooth', 'Smooth');
    case 'corner-node':
      return t('panels:diagram.annotations.corner', 'Corner');
    case 'add-node':
      return t('panels:diagram.annotations.addNode', 'Add Node');
    case 'delete-node':
      return t('panels:diagram.annotations.deleteNode', 'Delete Node');
    case 'flip-arc':
      return kind === 'pleat-arrow' ? t('panels:diagram.annotations.flip', 'Flip') : t('tools:diagram.flipArc', 'Flip Arc');
    case 'reset-path':
      return t('panels:diagram.annotations.resetShape', 'Reset Shape');
    case 'turn-right-angle':
      return t('panels:diagram.annotations.turnRightAngle', 'Turn 90°');
    case 'delete':
      return t('panels:diagram.annotations.delete', 'Delete');
  }
}

/**
 * The verbs `annotation` offers, in order, each enabled only on a step that
 * can change — the node steppers excepted, which change nothing. A node verb
 * needs a node selected, and Smooth and Corner one with a node on either side
 * (an end has one handle, and no type to have). Reset needs a path to undo.
 */
export function buildAnnotationActions(
  annotation: KnownDiagramAnnotation,
  state: AnnotationActionState,
  deps: AnnotationActionDeps
): AnnotationAction[] {
  const nodes = pathNodesOf(annotation);
  const count = nodes?.length ?? 0;
  const node = state.node ?? null;
  const interior = node !== null && node > 0 && node < count - 1;
  const context: AnnotationEditContext = { node, nodes: count, frame: state.frame };
  return ANNOTATION_ACTION_ORDER.filter((id) => offersAnnotationAction(id, annotation, state)).map((id) => {
    const shortcutId = annotationActionShortcut(id, node);
    const base = {
      id,
      group: NODE_ACTIONS.has(id) ? ('node' as const) : ('annotation' as const),
      label: annotationActionLabel(deps.t, id, annotation.kind),
      ...(shortcutId ? { shortcutId } : {}),
    };
    switch (id) {
      case 'previous-node':
      case 'next-node': {
        const direction = id === 'next-node' ? 1 : -1;
        const target = steppedNode(node, count, direction);
        return {
          ...base,
          disabled: target === null || target === node || !deps.selectNode,
          run: () => deps.selectNode?.(target),
        };
      }
      case 'smooth-node':
      case 'corner-node': {
        const corner = interior && nodes![node!]!.type === 'corner';
        return {
          ...base,
          disabled: !state.editable || !interior,
          active: interior && (id === 'corner-node' ? corner : !corner),
          run: () => deps.apply(annotationActionEdit(id, annotation.id, context)),
        };
      }
      case 'add-node':
      case 'delete-node':
        return {
          ...base,
          // An arrow holds no more than its most nodes: Add Node would add nothing there.
          disabled: !state.editable || node === null || (id === 'add-node' && count >= MAX_PATH_NODES),
          run: () => deps.apply(annotationActionEdit(id, annotation.id, context)),
        };
      case 'reset-path':
        return {
          ...base,
          // A loop whose ends meet has no arc to go back to.
          disabled: !state.editable || !canResetPath(annotation),
          run: () => deps.apply(annotationActionEdit(id, annotation.id, context)),
        };
      case 'flip-arc':
        return {
          ...base,
          // A straight arrow mirrors onto itself: offered, as on any arrow that flips, and held.
          disabled: !state.editable || !flipChangesArc(annotation),
          run: () => deps.apply(annotationActionEdit(id, annotation.id, context)),
        };
      case 'turn-right-angle':
      case 'delete':
        return {
          ...base,
          disabled: !state.editable,
          run: () => deps.apply(annotationActionEdit(id, annotation.id, context)),
        };
    }
  });
}
