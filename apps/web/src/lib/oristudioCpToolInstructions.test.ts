import { describe, expect, it } from 'vitest';
import { cpRailActions } from './oristudioCpActions';
import {
  instructionsForCpAction,
  instructionsForOrieditaAction,
} from './oristudioCpToolInstructions';

describe('Oriedita CP tool instructions', () => {
  it('provides instructions for every visible sidebar tool', () => {
    const missing = cpRailActions().filter((action) => !instructionsForCpAction(action));

    expect(missing.map((action) => action.label)).toEqual([]);
  });

  it('resolves Rabbit Ear to the detailed Oriedita instruction text', () => {
    expect(instructionsForOrieditaAction('rabbitEarAction')).toMatchObject({
      intro: ['Draw lines toward inner center.'],
      steps: [
        'Select point A.',
        'Select point B.',
        'Select point C.',
        'Three lines toward inner center are drawn.',
      ],
    });
  });

  it('uses Oriedita-style Angle Bisector line and point method instructions', () => {
    expect(instructionsForOrieditaAction('angleBisectorAction')?.steps).toEqual([
      'Select 2 segments or 3 points.',
      '3-point method: select 3 points, then select segment to end.',
      '2-line method: select 2 lines, then select segment to end.',
      'Parallel line method: select segment/indicator to end.',
    ]);
  });

  it('resolves rail aliases by their upstream Oriedita action', () => {
    const railActions = cpRailActions();

    expect(
      instructionsForCpAction(
        railActions.find(
          (action) => action.kind === 'command' && action.operationId === 'DrawCreaseAngleRestricted5'
        )
      )?.intro?.[0]
    ).toBe('Draw angle restricted line with selected angle restriction.');

    expect(
      instructionsForCpAction(
        railActions.find(
          (action) => action.kind === 'command' && action.operationId === 'DrawCreaseAngleRestricted'
        )
      )?.intro?.[0]
    ).toBe('Draw converging lines with angle offset.');

    expect(
      instructionsForCpAction(
        railActions.find((action) => action.kind === 'command' && action.operationId === 'DrawPoint')
      )?.intro
    ).toEqual(['Add a vertex.']);

    expect(
      instructionsForCpAction(
        railActions.find((action) => action.kind === 'command' && action.operationId === 'CreaseMove')
      )?.intro
    ).toEqual(['Move selected lines by drawing a line.']);

    expect(
      instructionsForCpAction(
        railActions.find((action) => action.kind === 'command' && action.operationId === 'CircleDraw')
      )?.intro
    ).toEqual(['Draw circles snapping to grid and vertices.']);
  });

  it('returns null for unmapped Oriedita actions', () => {
    expect(instructionsForOrieditaAction('missingAction')).toBeNull();
    expect(instructionsForCpAction(undefined)).toBeNull();
  });
});
