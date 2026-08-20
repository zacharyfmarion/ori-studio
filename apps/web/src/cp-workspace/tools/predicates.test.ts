import { describe, expect, it } from 'vitest';
import {
  cpCommandByOperation,
  type OristudioCpCommandDefinition,
} from '../../lib/oristudioCpCommands';
import {
  allowsDirectEntitySelection,
  cpCommandRequiresContextApply,
  creaseClickSelection,
  creaseTransformTool,
  isCircleTangentPointOperation,
  isCreaseToggleMvClickTool,
  isLengthenCreaseOperation,
  isLineClickSelectionOperation,
  isLineEraseClickTool,
  isReflectSelectionOperation,
  isModelAlignedBoxOperation,
  isRestrictedDrawOperation,
  regionSelectionClick,
  toolClickAction,
  isSelectionCircleApplyOperation,
  isSquareBisectorOperation,
  isTextAnnotationOperation,
  isVariablePointSequenceOperation,
  isWholeDocumentCpCommand,
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

  it('only the operation frame keeps a model-aligned box', () => {
    // Every other drag-box tool resolves its region through
    // `required_selection_polygon`, which takes four corners; the frame's handler
    // reads its points positionally and would build a frame across an edge.
    expect(isModelAlignedBoxOperation('OperationFrameCreate')).toBe(true);
    for (const op of ['LineSegmentDelete', 'CreaseSelect', 'CreaseUnselect', 'CreaseToggleMv']) {
      expect(isModelAlignedBoxOperation(op as never)).toBe(false);
    }
    expect(isModelAlignedBoxOperation(undefined)).toBe(false);
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

describe('regionSelectionClick', () => {
  it('covers every region-select tool, box and freehand alike', () => {
    // The lasso pair is Box Select/Deselect with a freehand region, so a click —
    // which has no region — applies the same way in both.
    expect(regionSelectionClick('CreaseSelect')).toBe('select');
    expect(regionSelectionClick('SelectLasso')).toBe('select');
    expect(regionSelectionClick('SelectPolygon')).toBe('select');
    expect(regionSelectionClick('CreaseUnselect')).toBe('unselect');
    expect(regionSelectionClick('UnselectLasso')).toBe('unselect');
    expect(regionSelectionClick('UnselectPolygon')).toBe('unselect');
  });

  it('is null for tools that select by other means, and for no tool at all', () => {
    // Dragged *lines*, not regions: they resolve their creases from the drawn
    // segment kernel-side, and a click has nothing to apply.
    expect(regionSelectionClick('SelectLineIntersecting')).toBeNull();
    expect(regionSelectionClick('UnselectLineIntersecting')).toBeNull();
    expect(regionSelectionClick('DrawCreaseFree')).toBeNull();
    expect(regionSelectionClick(null)).toBeNull();
  });
});

describe('creaseClickSelection', () => {
  it('answers with the armed region tool’s direction', () => {
    expect(
      creaseClickSelection({ activeOperationId: 'CreaseSelect', phase: 'active' }, 0, 0)
    ).toBe('select');
    expect(
      creaseClickSelection({ activeOperationId: 'SelectLasso', phase: 'active' }, 0, 0)
    ).toBe('select');
    expect(
      creaseClickSelection({ activeOperationId: 'UnselectLasso', phase: 'active' }, 0, 0)
    ).toBe('unselect');
  });

  it('is null with no region tool armed, or one mid-sequence', () => {
    // A pending point or path means a tool is collecting input, and the click
    // belongs to that rather than to the selection.
    expect(
      creaseClickSelection({ activeOperationId: 'CreaseSelect', phase: 'active' }, 1, 0)
    ).toBeNull();
    expect(
      creaseClickSelection({ activeOperationId: 'SelectLasso', phase: 'active' }, 0, 1)
    ).toBeNull();
    expect(
      creaseClickSelection({ activeOperationId: 'DrawCreaseFree', phase: 'active' }, 0, 0)
    ).toBeNull();
    expect(
      creaseClickSelection({ activeOperationId: 'CreaseSelect', phase: 'idle' }, 0, 0)
    ).toBeNull();
  });
});

describe('toolClickAction', () => {
  it('names the click behaviour of each box tool, and nothing else', () => {
    expect(toolClickAction('CreaseSelect')).toBe('select');
    expect(toolClickAction('CreaseUnselect')).toBe('select');
    // The lasso tools take a click too — without this the canvas discards the
    // gesture, since their drag engine needs two points to commit anything.
    expect(toolClickAction('SelectLasso')).toBe('select');
    expect(toolClickAction('UnselectLasso')).toBe('select');
    // Oriedita's CREASE_TOGGLE_MV_58 flips the crease under a bare click, so the
    // flip tool must not need a drag first.
    expect(toolClickAction('CreaseToggleMv')).toBe('crease');
    expect(toolClickAction('LineSegmentDelete')).toBe('erase');
    expect(toolClickAction('DrawCreaseFree')).toBeNull();
    expect(toolClickAction(null)).toBeNull();
  });
});

describe('creaseTransformTool', () => {
  it('classifies the four transform tools by variant and point count', () => {
    expect(creaseTransformTool('CreaseMove')).toEqual({ kind: 'move', pointCount: 2 });
    expect(creaseTransformTool('CreaseCopy')).toEqual({ kind: 'copy', pointCount: 2 });
    expect(creaseTransformTool('CreaseMove4p')).toEqual({ kind: 'move', pointCount: 4 });
    expect(creaseTransformTool('CreaseCopy4p')).toEqual({ kind: 'copy', pointCount: 4 });
  });

  it('is null for every other tool, so they keep the kernel preview', () => {
    expect(creaseTransformTool('DrawCreaseFree')).toBeNull();
    expect(creaseTransformTool('CreaseSelect')).toBeNull();
    expect(creaseTransformTool(null)).toBeNull();
    expect(creaseTransformTool(undefined)).toBeNull();
  });
});

describe('cpCommandRequiresContextApply', () => {
  it('requires an explicit Apply for selection-driven commands', () => {
    // Voronoi applies against the accumulated seed list, not per drag.
    expect(cpCommandRequiresContextApply(cpCommandByOperation('VoronoiCreate')!)).toBe(true);
  });

  it('does not require Apply for step-driven draw tools', () => {
    // Tools that commit through their own tool-step gestures need no Apply button.
    expect(cpCommandRequiresContextApply(cpCommandByOperation('DrawCreaseFree')!)).toBe(false);
    expect(cpCommandRequiresContextApply(cpCommandByOperation('PerpendicularDraw')!)).toBe(false);
  });

  it('does not require Apply for the Text tool (authored inline on the canvas)', () => {
    expect(cpCommandRequiresContextApply(cpCommandByOperation('Text')!)).toBe(false);
  });
});

describe('isWholeDocumentCpCommand', () => {
  it('holds for repairs and checks that take no input at all', () => {
    for (const op of ['Fix1', 'Fix2', 'Check1', 'CheckCamv', 'OrganizeCircles'] as const) {
      expect(isWholeDocumentCpCommand(cpCommandByOperation(op)!)).toBe(true);
    }
  });

  it('holds for both delete-extra-vertices sweeps', () => {
    expect(isWholeDocumentCpCommand(cpCommandByOperation('DeleteExtraVertices')!)).toBe(true);
    expect(
      isWholeDocumentCpCommand(cpCommandByOperation('DeleteExtraVerticesIgnoreColor')!)
    ).toBe(true);
  });

  it('is false for tools the canvas has to stay armed with', () => {
    // Steps to walk through.
    expect(isWholeDocumentCpCommand(cpCommandByOperation('DrawCreaseFree')!)).toBe(false);
    // A selection to act on — these run immediately too, but the rail keeps
    // them active because the context panel still renders their settings.
    expect(isWholeDocumentCpCommand(cpCommandByOperation('CreaseMakeMountain')!)).toBe(false);
    // Settings to configure before applying.
    expect(isWholeDocumentCpCommand(cpCommandByOperation('VoronoiCreate')!)).toBe(false);
  });
});
