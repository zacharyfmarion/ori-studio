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
 * What a click (press with no drag) does while a drag-box tool is active. Oriedita's
 * `BoxSelectStepNode.runReleaseAction` runs the box action only for a gesture that
 * actually moved, and otherwise applies the tool to the crease nearest the cursor —
 * so every box tool below is equally a click tool.
 */
export type ToolClickAction = 'select' | 'crease' | 'erase';

export function toolClickAction(operationId: OpId): ToolClickAction | null {
  if (isLineClickSelectionOperation(operationId)) return 'select';
  if (isCreaseToggleMvClickTool(operationId)) return 'crease';
  if (isLineEraseClickTool(operationId)) return 'erase';
  return null;
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
  operationId: OpId,
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
    (group) => group !== 'line-color' && group !== 'line-select-help',
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
  lineType: OristudioCpCustomLineType,
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
  stepIndex: number,
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

/** The plain box/click select mode: CreaseSelect active with no in-progress sequence. */
export function isDefaultSelectionMode(
  state: { activeOperationId: string | null; phase: string },
  pendingPointCount: number,
  pendingPathCount: number,
): boolean {
  return (
    state.phase === 'active' &&
    state.activeOperationId === 'CreaseSelect' &&
    pendingPointCount === 0 &&
    pendingPathCount === 0
  );
}
