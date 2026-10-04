import { EDIT_PATH } from '../../diagram/annotate/annotateTools';
import { pathNodesOf } from '../../diagram/annotate/annotationPath';
import {
  isKnownAnnotation,
  stepById,
  stepsOf,
  type DiagramDocument,
  type KnownDiagramAnnotation,
} from '../../diagram/document/diagramDocument';
import { stepCanBeAnnotated } from '../../diagram/pictures/pictureFrame';
import { emptySnapshotHistory, type SnapshotHistory } from './snapshotHistory';
import type { WorkspaceState } from './types';

/**
 * The keys whose values belong to *the project's diagram*, and must all be
 * replaced together when the project is.
 *
 * The diagram is a project-level document, so this is deliberately a list of
 * its own and **not** part of `CP_DOCUMENT_SCOPED_KEYS`: Edit's
 * self-provisioning, `clearOristudioCpDocument` and every box-pleat open or
 * create discard the crease pattern, and a diagram made of uploaded pictures
 * must survive all of them.
 *
 * A tuple rather than only a type so a test can prove each project-replacing
 * entry point resets every key without keeping its own copy of the list.
 */
export const DIAGRAM_SCOPED_KEYS = [
  'diagram',
  'diagramHistory',
  'diagramLoadId',
  'diagramReadOnly',
  'diagramRaw',
  'diagramView',
  'diagramSelectedStepId',
  'diagramDetail',
  'diagramAnnotateTool',
  'diagramSelectedAnnotationId',
  'diagramSelectedPathNode',
  'diagramPictureNotices',
  'diagramCaptures',
  'diagramPatternPicker',
  'diagramRefreshAll',
  'diagramReferencesBrowser',
] as const;

/**
 * Everything scoped to the project's diagram. Not `Partial`: adding a key to
 * {@link DIAGRAM_SCOPED_KEYS} is a compile error until every producer says
 * what happens to it when the project is replaced.
 */
export type DiagramScopedState = {
  [K in (typeof DIAGRAM_SCOPED_KEYS)[number]]: WorkspaceState[K];
};

/**
 * Whether the step detail is annotating: open in Annotate on a step that can
 * be annotated. Annotate is kept as the detail's mode across the steps it
 * walks, and a step with no picture to draw on shows Pose — so this, not the
 * stored mode, is what the keys, Delete, the menus and the Step pane ask.
 */
export function isDiagramAnnotating(
  state: Pick<WorkspaceState, 'diagram' | 'diagramDetail' | 'diagramSelectedStepId'>
): boolean {
  const { diagram, diagramDetail, diagramSelectedStepId } = state;
  if (diagramDetail !== 'annotate' || !diagram || diagramSelectedStepId === null) return false;
  const step = stepById(diagram, diagramSelectedStepId);
  return step !== null && stepCanBeAnnotated(step, diagram.assets);
}

/**
 * What Delete removes in the Diagram: the node Edit Path has selected, else
 * the selected annotation while annotating, else the selected step — the one
 * answer the menu's reason and every surface that names the key read.
 */
export function diagramDeleteTarget(
  state: Parameters<typeof selectedDiagramPathNode>[0]
): 'step' | 'annotation' | 'node' {
  if (!isDiagramAnnotating(state)) return 'step';
  return selectedDiagramPathNode(state) !== null ? 'node' : 'annotation';
}

/** The selected annotation, when it is one this build reads, on the selected step. */
export function selectedDiagramAnnotation(
  state: Pick<WorkspaceState, 'diagram' | 'diagramSelectedStepId' | 'diagramSelectedAnnotationId'>
): KnownDiagramAnnotation | null {
  const { diagram, diagramSelectedStepId: stepId, diagramSelectedAnnotationId: id } = state;
  if (!diagram || stepId === null || id === null) return null;
  const annotation = stepById(diagram, stepId)?.annotations.find((candidate) => candidate.id === id);
  return annotation && isKnownAnnotation(annotation) ? annotation : null;
}

/**
 * The node Edit Path has selected, by its number along the selected arrow's
 * path — or null: not annotating, another tool in hand, no fold arrow
 * selected, or the selection taken against another arrow or another count of
 * nodes than it shows now (an undo, Reset, a node added or deleted under it).
 * The one check, so no edit has to clear the selection itself.
 */
export function selectedDiagramPathNode(
  state: Pick<
    WorkspaceState,
    | 'diagram'
    | 'diagramDetail'
    | 'diagramSelectedStepId'
    | 'diagramSelectedAnnotationId'
    | 'diagramAnnotateTool'
    | 'diagramSelectedPathNode'
  >
): number | null {
  const selection = state.diagramSelectedPathNode;
  if (selection === null || state.diagramAnnotateTool !== EDIT_PATH || !isDiagramAnnotating(state)) return null;
  const annotation = selectedDiagramAnnotation(state);
  if (!annotation || annotation.id !== selection.annotationId) return null;
  const nodes = pathNodesOf(annotation);
  if (!nodes || nodes.length !== selection.nodes || selection.node < 0 || selection.node >= nodes.length) return null;
  return selection.node;
}

/**
 * The history holds whole diagrams. `null` is a real entry: the first edit
 * creates the diagram, and undoing it returns the project to having none.
 */
export type DiagramHistory = SnapshotHistory<DiagramDocument | null>;

let lastDiagramLoadId = 0;

/**
 * A new load id. Every replacement of the diagram takes one, so work started
 * against one diagram — an async capture, a pending text edit — can tell it
 * has been replaced before it writes into its successor.
 */
export function nextDiagramLoadId(): number {
  lastDiagramLoadId += 1;
  return lastDiagramLoadId;
}

/**
 * Let go of the project's diagram, for a replacement that brings its own (or
 * none). Spread it into the replacing `set`.
 */
export function discardDiagramState(): DiagramScopedState {
  return {
    diagram: null,
    diagramHistory: emptySnapshotHistory(),
    diagramLoadId: nextDiagramLoadId(),
    diagramReadOnly: false,
    diagramRaw: null,
    diagramView: 'steps',
    diagramSelectedStepId: null,
    diagramDetail: null,
    diagramAnnotateTool: null,
    diagramSelectedAnnotationId: null,
    diagramSelectedPathNode: null,
    diagramPictureNotices: {},
    diagramCaptures: {},
    diagramPatternPicker: null,
    diagramRefreshAll: null,
    diagramReferencesBrowser: null,
  };
}

/** The diagram-scoped state as it stands, to put back with one `set`. */
export function pickDiagramState(state: WorkspaceState): DiagramScopedState {
  return Object.fromEntries(DIAGRAM_SCOPED_KEYS.map((key) => [key, state[key]])) as DiagramScopedState;
}

/**
 * The most bytes of picture and asset data the undo history may keep alive,
 * beyond the current diagram itself.
 *
 * Snapshots share structure, so an edit that only moves a step costs a few
 * small arrays. What costs memory is a *replaced* picture or asset: each
 * recapture leaves the old picture reachable from history. The count cap
 * alone (`MAX_SNAPSHOT_HISTORY`) would let a hundred recaptures of a large
 * picture pin hundreds of MB.
 */
export const DIAGRAM_HISTORY_MAX_BYTES = 64 * 1024 * 1024;

const heavyBytes = new WeakMap<object, number>();

/** The JSON size of one heavy object, measured once. */
function bytesOf(value: object): number {
  const cached = heavyBytes.get(value);
  if (cached !== undefined) return cached;
  const size = JSON.stringify(value)?.length ?? 0;
  heavyBytes.set(value, size);
  return size;
}

/**
 * The objects in a diagram that are worth counting: pictures, assets, and the
 * raw form of anything carried verbatim. Everything else is a few fields per
 * step and is covered by the count cap.
 */
function heavyParts(document: DiagramDocument | null): object[] {
  if (!document) return [];
  const parts: object[] = [];
  for (const step of stepsOf(document)) {
    if (step.unknown) parts.push(step.unknown);
    const picture = step.picture as unknown;
    if (picture && typeof picture === 'object') parts.push(picture);
  }
  for (const asset of Object.values(document.assets)) parts.push(asset);
  return parts;
}

/**
 * About how many bytes of picture and asset data a diagram puts in the file,
 * for the save notice. Measured from the same cached sizes the history trim
 * uses, so saving again costs nothing for data that has not changed.
 */
export function diagramDataBytes(document: DiagramDocument | null): number {
  let total = 0;
  for (const part of heavyParts(document)) total += bytesOf(part);
  return total;
}

/**
 * Drop the oldest undo entries until the distinct heavy data they keep alive
 * fits {@link DIAGRAM_HISTORY_MAX_BYTES}. The current diagram is counted
 * first, so what it shares with history costs history nothing.
 */
export function trimDiagramHistory(
  history: DiagramHistory,
  current: DiagramDocument | null,
  maxBytes: number = DIAGRAM_HISTORY_MAX_BYTES
): DiagramHistory {
  const counted = new Set<object>(heavyParts(current));
  let total = 0;
  let keepFrom = 0;
  for (let index = history.past.length - 1; index >= 0; index--) {
    for (const part of heavyParts(history.past[index].snapshot)) {
      if (counted.has(part)) continue;
      counted.add(part);
      total += bytesOf(part);
    }
    if (total > maxBytes) {
      keepFrom = index + 1;
      break;
    }
  }
  return keepFrom === 0 ? history : { ...history, past: history.past.slice(keepFrom) };
}
