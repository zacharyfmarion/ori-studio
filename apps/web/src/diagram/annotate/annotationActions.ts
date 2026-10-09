import type { TFunction } from 'i18next';
import type { DiagramArrowShapeGesture } from '../../analytics/events';
import type { ShortcutActionId } from '../../keyboard/shortcuts';
import type { DiagramAnnotationKind, KnownDiagramAnnotation } from '../document/diagramDocument';
import {
  canBeShaped,
  flipAnnotation,
  flipAnnotationArc,
  flipChangesArc,
  flipChangesMark,
  flipsArc,
  flipsOver,
  isCornerKind,
  isShapedArrow,
  turnRightAngle,
  type FlipAxis,
  type PictureFrame,
  type PicturePoint,
} from './annotationModel';
import {
  canDeletePathNode,
  canResetPath,
  canSplitPathSegment,
  deletePathNode,
  hasNodeType,
  movePathNode,
  pathNodesOf,
  resetPath,
  setPathNodeType,
  splitPathSegment,
} from './annotationPath';

/**
 * The verbs an annotation offers, for every surface that offers them: the
 * Step pane's buttons under the selected annotation, and Annotate's keys — F,
 * Delete through `edit.delete`, and the arrows that nudge a node. Flip
 * Horizontal and Flip Vertical turn any mark with a side to it over in place
 * (Zach, 2026-10-05), from the pane alone, as Edit's flips have no keys.
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
  | 'flip-horizontal'
  | 'flip-vertical'
  | 'flip-arc'
  | 'reset-path'
  | 'turn-right-angle'
  | 'delete';

/**
 * Where a surface puts a verb: with the selected node, with the annotation as
 * a whole, or with the two flips, which turn the whole over.
 */
export type AnnotationActionGroup = 'node' | 'annotation' | 'flip';

/** The verbs in the order a surface shows them: the node's, then the annotation's own, then Delete. */
const ANNOTATION_ACTION_ORDER: readonly AnnotationActionId[] = [
  'previous-node',
  'next-node',
  'smooth-node',
  'corner-node',
  'add-node',
  'delete-node',
  'flip-horizontal',
  'flip-vertical',
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
 * whichever it would run, as `deleteKeyEdit` decides. F is Flip Arc's, and on
 * an eye its Flip row's Horizontal ({@link flipKeyAction}).
 */
function annotationActionShortcut(
  id: AnnotationActionId,
  node: number | null,
  annotation: KnownDiagramAnnotation
): ShortcutActionId | undefined {
  switch (id) {
    case 'flip-arc':
      return 'diagram.flipArc';
    case 'flip-horizontal':
      return flipKeyAction(annotation) === id ? 'diagram.flipArc' : undefined;
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
  /** The mark a flip turns over, and which way: what the binding counts. */
  flips?: { annotationId: string; axis: FlipAxis };
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
 * first edit); Turn 90° a right angle; the two flips a mark with a side to it
 * (`flipsOver`); Delete, every one.
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
    case 'flip-horizontal':
    case 'flip-vertical':
      return flipsOver(annotation.kind);
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
        edit: onNode((annotation, at) => splitPathSegment(annotation, addNodeSegment(annotation, at), 0.5)),
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
    case 'flip-horizontal':
    case 'flip-vertical': {
      const axis = flipAxis(id);
      return {
        label: axis === 'horizontal' ? 'Flip horizontal' : 'Flip vertical',
        edit: editAnnotation(annotationId, (annotation) => flipAnnotation(annotation, axis)),
        flips: { annotationId, axis },
      };
    }
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

/** Where a surface shows a verb ({@link AnnotationActionGroup}). */
function actionGroup(id: AnnotationActionId): AnnotationActionGroup {
  if (NODE_ACTIONS.has(id)) return 'node';
  return id === 'flip-horizontal' || id === 'flip-vertical' ? 'flip' : 'annotation';
}

/** The way a flip verb turns a mark over. */
function flipAxis(id: 'flip-horizontal' | 'flip-vertical'): FlipAxis {
  return id === 'flip-horizontal' ? 'horizontal' : 'vertical';
}

/**
 * What Delete (`edit.delete`) does in Annotate: the selected node, while
 * Edit Path has one; otherwise the selected annotation.
 */
export function deleteKeyEdit(annotationId: string, node: number | null): AnnotationEdit {
  return node === null ? annotationActionEdit('delete', annotationId) : annotationActionEdit('delete-node', annotationId, { node });
}

/**
 * The verb F (`diagram.flipArc`) runs on `annotation`: Flip Arc on a mark
 * whose arc flips (`flipsArc`); on an eye, its Flip row's Horizontal — the
 * eye mirrored across, so it looks the other way and stays as upright as it
 * was (R3-9b A, as Zach's F was settled after 18c, 2026-10-08), rather than a
 * half turn, which would stand a level eye on its head; none on the rest.
 */
export function flipKeyAction(annotation: KnownDiagramAnnotation): 'flip-arc' | 'flip-horizontal' | null {
  if (flipsArc(annotation.kind)) return 'flip-arc';
  return annotation.kind === 'eye' ? 'flip-horizontal' : null;
}

/**
 * What F does to the selected `annotation`, as one undo step: its verb's own
 * edit ({@link flipKeyAction}), counted as that verb is; null where it has
 * none or would change nothing — a straight arrow's, or an eye looking
 * straight up or down — so the key falls through.
 */
export function flipKeyEdit(annotation: KnownDiagramAnnotation): AnnotationEdit | null {
  switch (flipKeyAction(annotation)) {
    case 'flip-arc':
      return flipChangesArc(annotation) ? annotationActionEdit('flip-arc', annotation.id) : null;
    case 'flip-horizontal':
      return flipChangesMark(annotation, 'horizontal') ? annotationActionEdit('flip-horizontal', annotation.id) : null;
    case null:
      return null;
  }
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

/** The segment Add Node cuts with `node` selected: the one after it, or before the tip — which has none after. */
function addNodeSegment(annotation: KnownDiagramAnnotation, node: number): number {
  return Math.min(node, (pathNodesOf(annotation)?.length ?? 0) - 2);
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

/** A verb's name on an annotation of `kind`: Flip arc, on a pleat arrow or equal divisions, only flips — neither has an arc. */
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
    case 'flip-horizontal':
      return t('panels:diagram.annotations.flipHorizontal', 'Flip Horizontal');
    case 'flip-vertical':
      return t('panels:diagram.annotations.flipVertical', 'Flip Vertical');
    case 'flip-arc':
      return kind === 'pleat-arrow' || kind === 'divisions'
        ? t('panels:diagram.annotations.flip', 'Flip')
        : t('tools:diagram.flipArc', 'Flip Arc');
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
 * needs a node selected, and Smooth and Corner one with a type to set
 * (`hasNodeType`): not an end, which has one handle, nor a fold-and-unfold
 * arrow's tip. Add Node needs room in its half of the arrow, and Delete Node
 * a node it may take out. Reset needs a path to undo.
 */
export function buildAnnotationActions(
  annotation: KnownDiagramAnnotation,
  state: AnnotationActionState,
  deps: AnnotationActionDeps
): AnnotationAction[] {
  const nodes = pathNodesOf(annotation);
  const count = nodes?.length ?? 0;
  const node = state.node ?? null;
  const typed = node !== null && hasNodeType(annotation, node);
  const context: AnnotationEditContext = { node, nodes: count, frame: state.frame };
  return ANNOTATION_ACTION_ORDER.filter((id) => offersAnnotationAction(id, annotation, state)).map((id) => {
    const shortcutId = annotationActionShortcut(id, node, annotation);
    const base = {
      id,
      group: actionGroup(id),
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
        const corner = typed && nodes![node!]!.type === 'corner';
        return {
          ...base,
          disabled: !state.editable || !typed,
          active: typed && (id === 'corner-node' ? corner : !corner),
          run: () => deps.apply(annotationActionEdit(id, annotation.id, context)),
        };
      }
      case 'add-node':
      case 'delete-node':
        return {
          ...base,
          // A half holds no more than its most nodes, and a fold-and-unfold arrow keeps its tip and a return.
          disabled:
            !state.editable ||
            node === null ||
            !(id === 'add-node'
              ? canSplitPathSegment(annotation, addNodeSegment(annotation, node))
              : canDeletePathNode(annotation, node)),
          run: () => deps.apply(annotationActionEdit(id, annotation.id, context)),
        };
      case 'reset-path':
        return {
          ...base,
          // A loop whose ends meet has no arc to go back to.
          disabled: !state.editable || !canResetPath(annotation),
          run: () => deps.apply(annotationActionEdit(id, annotation.id, context)),
        };
      case 'flip-horizontal':
      case 'flip-vertical':
        return {
          ...base,
          // A line flipped along itself turns over onto itself: offered, and held.
          disabled: !state.editable || !flipChangesMark(annotation, flipAxis(id)),
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
