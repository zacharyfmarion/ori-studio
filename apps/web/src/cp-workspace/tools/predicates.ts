import type { OristudioCpCustomLineType } from '../../engine/oristudioCpTypes';
import type { OristudioCpCommandDefinition } from '../../lib/oristudioCpCommands';
import { cpToolSettingGroupsForCommand } from '../../lib/oristudioCpToolSettings';

/**
 * Pure operation predicates — small `(operationId) => boolean` classifiers that decide
 * how the CP surface routes a tool's pointer input. Renderer-agnostic; extracted from
 * `CreasePatternPanel` (Phase 8 decompose) so they can be unit-tested directly.
 */

type OpId = OristudioCpCommandDefinition['operationId'] | string | null | undefined;

export function isLineClickSelectionOperation(operationId: OpId): boolean {
  return operationId === 'CreaseSelect' || operationId === 'CreaseUnselect';
}

export function isLengthenCreaseOperation(operationId: OpId): boolean {
  return operationId === 'LengthenCrease' || operationId === 'LengthenCreaseSameColor';
}

// Oriedita `CREASE_TOGGLE_MV_58` (the 'C' tool): clicking a crease flips its
// mountain/valley assignment in place, keeping the tool active for the next click.
export function isCreaseToggleMvClickTool(operationId: OpId): boolean {
  return operationId === 'CreaseToggleMv';
}

export function isSquareBisectorOperation(operationId: OpId): boolean {
  return operationId === 'SquareBisector';
}

// Oriedita `LINE_SEGMENT_DELETE_3` (the eraser tool): clicking a crease deletes it
// (honoring the tool-options line-type filter), keeping the tool active for the next click.
export function isLineEraseClickTool(operationId: OpId): boolean {
  return operationId === 'LineSegmentDelete';
}

/**
 * What a click (press with no drag) does while a region or box tool is active.
 * Oriedita's `BoxSelectStepNode.runReleaseAction` runs the box action only for a
 * gesture that actually moved, and otherwise applies the tool to the crease nearest
 * the cursor — so every tool below is equally a click tool.
 */
export type ToolClickAction = 'select' | 'crease' | 'erase';

export function toolClickAction(operationId: OpId): ToolClickAction | null {
  if (regionSelectionClick(operationId)) return 'select';
  if (isCreaseToggleMvClickTool(operationId)) return 'crease';
  if (isLineEraseClickTool(operationId)) return 'erase';
  return null;
}

/** Which way a region-select tool's click moves the crease it lands on. */
export type RegionSelectionClick = 'select' | 'unselect';

/**
 * The region-select family, and the direction a click applies it in.
 *
 * Box Select/Deselect rubber-band a rectangle, the lasso pair draws a freehand
 * region, the (hidden) polygon pair draws a closed one. The region's shape is the
 * only thing that differs between them — and a click has no region at all — so a
 * click means the same thing in every one: apply the tool to the crease under the
 * cursor.
 *
 * Upstream states that rule for the box half (`BoxSelectStepNode.runReleaseAction`,
 * above). Its lasso has no click behaviour — `BaseMouseHandlerLasso.mouseReleased`
 * closes a degenerate path, which selects nothing — so carrying it across is ours,
 * alongside the modern-selection divergence these tools already have (a plain drag
 * replaces the selection where upstream's lasso is always additive).
 */
export function regionSelectionClick(operationId: OpId): RegionSelectionClick | null {
  switch (operationId) {
    case 'CreaseSelect':
    case 'SelectLasso':
    case 'SelectPolygon':
      return 'select';
    case 'CreaseUnselect':
    case 'UnselectLasso':
    case 'UnselectPolygon':
      return 'unselect';
    default:
      return null;
  }
}

export function allowsDirectEntitySelection(operationId: OpId): boolean {
  return operationId === 'CreaseSelect';
}

export function isRestrictedDrawOperation(operationId: OpId): boolean {
  return operationId === 'DrawCreaseRestricted';
}

/**
 * The one drag-box tool whose box must stay axis-aligned in *model* space, so it
 * commits two diagonal corners rather than four perimeter ones.
 *
 * Every other box tool resolves its region through `required_selection_polygon`,
 * which reads any number of points as a polygon. The operation frame does not:
 * its kernel handler reads `points[0]` as the press, the middle points as drags,
 * and the last as the release, so handing it four perimeter corners would build
 * a frame spanning an *edge* of the box instead of its diagonal.
 *
 * (Upstream's operation frame is screen-space too — `MouseHandlerOperationFrameCreate`
 * keeps `frame.getP1()` in TV coordinates and only calls `TV2object` to draw —
 * so this port already diverges under rotation. The tool is hidden-ui-only;
 * fixing that properly is a kernel change of its own.)
 */
export function isModelAlignedBoxOperation(operationId: OpId): boolean {
  return operationId === 'OperationFrameCreate';
}

export function isReflectSelectionOperation(operationId: OpId): boolean {
  return operationId === 'DrawCreaseSymmetric';
}

/**
 * The crease transform tools (Oriedita `CREASE_MOVE_21` / `CREASE_COPY_22` and
 * their four-point variants), which preview the selection at its prospective
 * position while the gesture runs.
 *
 * `kind` decides how the preview draws: a move shifts the real strokes in place,
 * a copy leaves them and ghosts the new geometry. `pointCount` is the tool's own
 * — two points is a translation, four resolves the similarity taking the source
 * pair onto the target pair.
 */
export function creaseTransformTool(
  operationId: OpId
): { kind: 'move' | 'copy'; pointCount: 2 | 4 } | null {
  switch (operationId) {
    case 'CreaseMove':
      return { kind: 'move', pointCount: 2 };
    case 'CreaseCopy':
      return { kind: 'copy', pointCount: 2 };
    case 'CreaseMove4p':
      return { kind: 'move', pointCount: 4 };
    case 'CreaseCopy4p':
      return { kind: 'copy', pointCount: 4 };
    default:
      return null;
  }
}

export function isVariablePointSequenceOperation(operationId: OpId): boolean {
  return operationId === 'VoronoiCreate';
}

export function isTextAnnotationOperation(operationId: OpId): boolean {
  return operationId === 'Text';
}

export function isSelectionCircleApplyOperation(operationId: OpId): boolean {
  return (
    operationId === 'CircleDrawTangentLine' ||
    operationId === 'CircleDrawInverted' ||
    operationId === 'CircleDrawConcentricSelect' ||
    operationId === 'CircleDrawConcentricTwoCircleSelect'
  );
}

export function isCircleTangentPointOperation(operationId: OpId): boolean {
  return operationId === 'CircleDrawTangentLine';
}

/**
 * Does this command need the context panel's Apply button — settings or a
 * selection the user confirms — rather than running the moment it is picked?
 *
 * Lived in `CpContextToolPanel` until the rail needed it too. A pure predicate
 * over a command definition has no business in a panel component.
 */
export function cpCommandRequiresContextApply(command: OristudioCpCommandDefinition): boolean {
  if (command.operationId === 'VoronoiCreate') return true;
  if (isSelectionCircleApplyOperation(command.operationId)) return true;
  if ((command.toolSteps?.length ?? 0) > 0) return false;
  return cpToolSettingGroupsForCommand(command).some(
    (group) => group !== 'line-color' && group !== 'line-select-help'
  );
}

/**
 * A verb over the whole document: nothing to pick on the canvas, nothing to
 * select first, nothing to configure. Check1-4, CheckCamv, Fix1/Fix2, the
 * delete-extra-vertices sweeps, OrganizeCircles.
 *
 * These are the actions that must *run* when chosen rather than arm the canvas.
 * The distinction matters because the rail persists whatever it activates: a
 * one-shot that took the active-tool slot would sit lit up afterwards while the
 * canvas had nothing armed, and clicks would go nowhere. Every other rail entry
 * is a mouse tool, so this is the first time the two came apart.
 *
 * Deliberately structural rather than an operation-id list — an id list would
 * drift the moment another whole-document repair lands.
 */
export function isWholeDocumentCpCommand(command: OristudioCpCommandDefinition): boolean {
  return (
    (command.toolSteps?.length ?? 0) === 0 &&
    command.selectionRequirement === undefined &&
    cpToolSettingGroupsForCommand(command).length === 0
  );
}

// Mirrors the kernel `CustomLineType::matches`: does a crease's line color pass the
// eraser's line-type filter? Used to preview which crease a click erases.
export function lineColorMatchesCustomType(
  color: string,
  lineType: OristudioCpCustomLineType
): boolean {
  switch (lineType) {
    case 'Any':
      return true;
    case 'Edge':
      return color === 'Black0';
    case 'MountainAndValley':
      return color === 'Red1' || color === 'Blue2';
    case 'Mountain':
      return color === 'Red1';
    case 'Valley':
      return color === 'Blue2';
    case 'Aux':
      return color === 'Cyan3';
    default:
      return false;
  }
}

/**
 * Whether a tool step should snap to a free point (grid/vertex) rather than onto a
 * crease. Symmetric-draw axes always prefer points; otherwise the decision is read from
 * the step prompt's wording (a 'crease'/'line' step snaps to creases; point/vertex/
 * endpoint/center/radius steps snap to free points).
 */
export function shouldPreferPointSnapForStep(
  command: OristudioCpCommandDefinition | null | undefined,
  stepIndex: number
): boolean {
  if (command?.operationId === 'DrawCreaseSymmetric') return true;
  if (command?.operationId === 'DoubleSymmetricDraw') return true;
  const step = command?.toolSteps?.[stepIndex]?.toLowerCase();
  if (!step) return false;
  if (step.includes('crease') || step.includes('line')) return false;
  return (
    step.includes('point') ||
    step.includes('vertex') ||
    step.includes('endpoint') ||
    step.includes('center') ||
    step.includes('radius')
  );
}

/**
 * What a click on a crease does right now: the armed region-select tool's
 * direction, or null when no such tool is armed.
 *
 * Null too while one is mid-sequence — a tool holding placed points or a path is
 * collecting input, and the click belongs to that rather than to the selection.
 * The box tools have a kernel-side click path to fall back to there; the lasso
 * tools have none, so their click is simply ignored, as it is today.
 */
export function creaseClickSelection(
  state: { activeOperationId: string | null; phase: string },
  pendingPointCount: number,
  pendingPathCount: number
): RegionSelectionClick | null {
  if (state.phase !== 'active' || pendingPointCount !== 0 || pendingPathCount !== 0) return null;
  return regionSelectionClick(state.activeOperationId);
}
