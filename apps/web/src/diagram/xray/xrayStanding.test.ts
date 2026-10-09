import { describe, expect, it } from 'vitest';
import type { DiagramStep } from '../document/diagramDocument';
import { craneStep } from '../zoom/zoom.fixtures';
import { xrayStanding } from './xrayStanding';

const linked = (step: DiagramStep, render: object): DiagramStep => {
  if (step.source?.kind !== 'cp') throw new Error('a linked step');
  return { ...step, source: { ...step.source, render: { ...step.source.render, ...render } as never } };
};

describe('whether a step’s picture can be x-rayed (Revision 3, R3-18a A)', () => {
  const at = { link: 'current' as const, patternOpen: true, number: 15 };

  it('is ready on a flat fold with its faces on the paper, whatever its link says', () => {
    expect(xrayStanding(craneStep('S.none'), at)).toEqual({ kind: 'ready' });
    expect(xrayStanding(craneStep('S.affine'), { link: 'stale', patternOpen: false, number: 3 })).toEqual({ kind: 'ready' });
  });

  it('fetches the faces of a flat fold captured before they were kept while its pattern is open and its link not out of date', () => {
    const older = craneStep('S.none', { faces: false });
    expect(xrayStanding(older, at)).toEqual({ kind: 'fetch' });
    // A link still being checked is checked as the faces are fetched.
    expect(xrayStanding(older, { ...at, link: 'unknown' })).toEqual({ kind: 'fetch' });
  });

  it('asks for a Refresh, by the step’s number, where the faces cannot be had: a stale or missing link, or no pattern open', () => {
    const older = craneStep('S.none', { faces: false });
    expect(xrayStanding(older, { ...at, link: 'stale' })).toEqual({ kind: 'refresh', number: 15 });
    expect(xrayStanding(older, { ...at, link: 'missing' })).toEqual({ kind: 'refresh', number: 15 });
    expect(xrayStanding(older, { ...at, link: 'current', patternOpen: false })).toEqual({ kind: 'refresh', number: 15 });
  });

  it('holds it on a picture with no layers: a crease pattern, 3D, a step with no picture', () => {
    expect(xrayStanding(linked(craneStep('S.none'), { mode: 'crease-pattern' }), at)).toEqual({ kind: 'none' });
    expect(xrayStanding(linked(craneStep('S.none'), { mode: 'folded-3d' }), at)).toEqual({ kind: 'none' });
    expect(xrayStanding({ ...craneStep('S.none'), picture: null }, at)).toEqual({ kind: 'none' });
  });
});
