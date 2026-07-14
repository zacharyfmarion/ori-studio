import type { OristudioCpCustomLineType } from '../../engine/oristudioCpTypes';
import type { OristudioCpCommandDefinition } from '../../lib/oristudioCpCommands';

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

export function allowsDirectEntitySelection(operationId: OpId): boolean {
  return operationId === 'CreaseSelect';
}

export function isRestrictedDrawOperation(operationId: OpId): boolean {
  return operationId === 'DrawCreaseRestricted';
}

export function isReflectSelectionOperation(operationId: OpId): boolean {
  return operationId === 'DrawCreaseSymmetric';
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

/** The plain box/click select mode: CreaseSelect active with no in-progress sequence. */
export function isDefaultSelectionMode(
  state: { activeOperationId: string | null; phase: string },
  pendingPointCount: number,
  pendingPathCount: number
): boolean {
  return (
    state.phase === 'active' &&
    state.activeOperationId === 'CreaseSelect' &&
    pendingPointCount === 0 &&
    pendingPathCount === 0
  );
}
