import { describe, expect, it } from 'vitest';
import type { OristudioCpCommandDefinition } from '../../lib/oristudioCpCommands';
import {
  allowsDirectEntitySelection,
  isCircleTangentPointOperation,
  isCreaseToggleMvClickTool,
  isDefaultSelectionMode,
  isLengthenCreaseOperation,
  isLineClickSelectionOperation,
  isLineEraseClickTool,
  isReflectSelectionOperation,
  isRestrictedDrawOperation,
  isSelectionCircleApplyOperation,
  isSquareBisectorOperation,
  isTextAnnotationOperation,
  isVariablePointSequenceOperation,
  lineColorMatchesCustomType,
  shouldPreferPointSnapForStep,
} from './predicates';

describe('operation predicates', () => {
  it('match only their operation ids', () => {
    expect(isLineClickSelectionOperation('CreaseSelect')).toBe(true);
    expect(isLineClickSelectionOperation('CreaseUnselect')).toBe(true);
    expect(isLineClickSelectionOperation('DrawCreaseFree')).toBe(false);

    expect(isLengthenCreaseOperation('LengthenCrease')).toBe(true);
    expect(isLengthenCreaseOperation('LengthenCreaseSameColor')).toBe(true);
    expect(isLengthenCreaseOperation('CreaseSelect')).toBe(false);

    expect(isCreaseToggleMvClickTool('CreaseToggleMv')).toBe(true);
    expect(isSquareBisectorOperation('SquareBisector')).toBe(true);
    expect(isLineEraseClickTool('LineSegmentDelete')).toBe(true);
    expect(allowsDirectEntitySelection('CreaseSelect')).toBe(true);
    expect(allowsDirectEntitySelection('CreaseUnselect')).toBe(false);
    expect(isRestrictedDrawOperation('DrawCreaseRestricted')).toBe(true);
    expect(isReflectSelectionOperation('DrawCreaseSymmetric')).toBe(true);
    expect(isVariablePointSequenceOperation('VoronoiCreate')).toBe(true);
    expect(isTextAnnotationOperation('Text')).toBe(true);
    expect(isCircleTangentPointOperation('CircleDrawTangentLine')).toBe(true);
  });

  it('null / undefined operation ids never match', () => {
    expect(isLineClickSelectionOperation(null)).toBe(false);
    expect(isSquareBisectorOperation(undefined)).toBe(false);
  });

  it('isSelectionCircleApplyOperation covers the four selection-circle ops', () => {
    for (const op of [
      'CircleDrawTangentLine',
      'CircleDrawInverted',
      'CircleDrawConcentricSelect',
      'CircleDrawConcentricTwoCircleSelect',
    ]) {
      expect(isSelectionCircleApplyOperation(op)).toBe(true);
    }
    expect(isSelectionCircleApplyOperation('CircleDraw')).toBe(false);
  });
});

describe('lineColorMatchesCustomType', () => {
  it('applies the eraser line-type filter', () => {
    expect(lineColorMatchesCustomType('Red1', 'Any')).toBe(true);
    expect(lineColorMatchesCustomType('Black0', 'Edge')).toBe(true);
    expect(lineColorMatchesCustomType('Red1', 'Edge')).toBe(false);
    expect(lineColorMatchesCustomType('Red1', 'Mountain')).toBe(true);
    expect(lineColorMatchesCustomType('Blue2', 'Valley')).toBe(true);
    expect(lineColorMatchesCustomType('Blue2', 'Mountain')).toBe(false);
    expect(lineColorMatchesCustomType('Red1', 'MountainAndValley')).toBe(true);
    expect(lineColorMatchesCustomType('Blue2', 'MountainAndValley')).toBe(true);
    expect(lineColorMatchesCustomType('Cyan3', 'Aux')).toBe(true);
  });
});

describe('shouldPreferPointSnapForStep', () => {
  const cmd = (
    operationId: string,
    toolSteps?: string[]
  ): OristudioCpCommandDefinition =>
    ({ operationId, toolSteps } as unknown as OristudioCpCommandDefinition);

  it('symmetric-draw axes always prefer points', () => {
    expect(shouldPreferPointSnapForStep(cmd('DrawCreaseSymmetric'), 0)).toBe(true);
    expect(shouldPreferPointSnapForStep(cmd('DoubleSymmetricDraw'), 1)).toBe(true);
  });

  it('reads the step wording: crease/line → false, point-ish → true', () => {
    const c = cmd('AngleSystem', ['Pick base point', 'Select target crease', 'Set radius']);
    expect(shouldPreferPointSnapForStep(c, 0)).toBe(true); // "point"
    expect(shouldPreferPointSnapForStep(c, 1)).toBe(false); // "crease"
    expect(shouldPreferPointSnapForStep(c, 2)).toBe(true); // "radius"
  });

  it('is false when the step is missing or unclassifiable', () => {
    expect(shouldPreferPointSnapForStep(cmd('X', ['Drag box']), 0)).toBe(false);
    expect(shouldPreferPointSnapForStep(cmd('X', []), 0)).toBe(false);
    expect(shouldPreferPointSnapForStep(null, 0)).toBe(false);
  });
});

describe('isDefaultSelectionMode', () => {
  it('is the active CreaseSelect tool with no in-progress sequence', () => {
    expect(
      isDefaultSelectionMode({ activeOperationId: 'CreaseSelect', phase: 'active' }, 0, 0)
    ).toBe(true);
    // A pending point or path means a sequence is in progress → not default select.
    expect(
      isDefaultSelectionMode({ activeOperationId: 'CreaseSelect', phase: 'active' }, 1, 0)
    ).toBe(false);
    expect(
      isDefaultSelectionMode({ activeOperationId: 'DrawCreaseFree', phase: 'active' }, 0, 0)
    ).toBe(false);
    expect(
      isDefaultSelectionMode({ activeOperationId: 'CreaseSelect', phase: 'idle' }, 0, 0)
    ).toBe(false);
  });
});
