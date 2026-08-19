import { describe, expect, it } from 'vitest';
import { cpInputModel } from './inputModelRegistry';
import { isCreaseStep, loneCandidateAutoPick, requiresCreaseInRange } from './sequenceSteps';

const RAY = { a: { x: 0, y: 0 }, b: { x: 10, y: 20 } };

describe('isCreaseStep', () => {
  it('covers both crease flavours and nothing else', () => {
    expect(isCreaseStep('crease')).toBe(true);
    expect(isCreaseStep('crease-required')).toBe(true);
    expect(isCreaseStep('point')).toBe(false);
    expect(isCreaseStep('candidate')).toBe(false);
    expect(isCreaseStep(undefined)).toBe(false);
  });
});

describe('requiresCreaseInRange', () => {
  it('gates only the required flavour, so a free-draw crease step still commits', () => {
    expect(requiresCreaseInRange('crease-required')).toBe(true);
    expect(requiresCreaseInRange('crease')).toBe(false);
    expect(requiresCreaseInRange('point')).toBe(false);
    expect(requiresCreaseInRange(undefined)).toBe(false);
  });

  it('has nothing to gate on Foldable Line, which no longer asks for a destination', () => {
    const snap = cpInputModel('VertexMakeAngularlyFlatFoldable')?.snapPerStep ?? [];
    expect([...snap]).toEqual(['point', 'candidate']);
    expect(snap.some(requiresCreaseInRange)).toBe(false);
  });

  it("leaves FoldableLineDraw's free-draw step ungated", () => {
    const snap = cpInputModel('FoldableLineDraw')?.snapPerStep ?? [];
    expect(snap.some(requiresCreaseInRange)).toBe(false);
  });
});

describe('loneCandidateAutoPick', () => {
  const kinds = ['point', 'candidate', 'crease-required'] as const;

  it('resolves a single previewed ray to its midpoint', () => {
    expect(loneCandidateAutoPick(kinds, 1, [RAY])).toEqual({ x: 5, y: 10 });
  });

  it('waits for a pick when several rays are offered', () => {
    expect(loneCandidateAutoPick(kinds, 1, [RAY, RAY])).toBeNull();
  });

  it('waits when the kernel preview has not arrived yet', () => {
    expect(loneCandidateAutoPick(kinds, 1, [])).toBeNull();
  });

  it('does nothing on a step that is not a candidate step', () => {
    expect(loneCandidateAutoPick(kinds, 0, [RAY])).toBeNull();
    expect(loneCandidateAutoPick(kinds, 2, [RAY])).toBeNull();
  });

  it('never resolves a trailing candidate step, which would commit with no click', () => {
    expect(loneCandidateAutoPick(['point', 'point', 'candidate'], 2, [RAY])).toBeNull();
  });
});

describe('the lone candidate on Foldable Line', () => {
  it('commits on the vertex click, because there is nothing to choose between', () => {
    const entry = cpInputModel('VertexMakeAngularlyFlatFoldable');
    const snap = entry?.snapPerStep ?? [];
    expect(entry?.commitOnLoneCandidate).toBe(true);
    expect(
      loneCandidateAutoPick(snap, snap.length - 1, [RAY], entry?.commitOnLoneCandidate),
    ).toEqual({ x: 5, y: 10 });
  });

  it('still needs a click when there is more than one', () => {
    const entry = cpInputModel('VertexMakeAngularlyFlatFoldable');
    const snap = entry?.snapPerStep ?? [];
    const two = [RAY, { a: { x: 0, y: 0 }, b: { x: -10, y: 20 } }];
    expect(
      loneCandidateAutoPick(snap, snap.length - 1, two, entry?.commitOnLoneCandidate),
    ).toBeNull();
  });

  it('leaves a tool that did not ask for it alone', () => {
    // Every other tool ending on a candidate step keeps the guard: resolving it
    // would commit geometry off a preview arriving.
    const snap = cpInputModel('DrawCreaseAngleRestricted')?.snapPerStep ?? [];
    expect(snap[snap.length - 1]).toBe('candidate');
    expect(cpInputModel('DrawCreaseAngleRestricted')?.commitOnLoneCandidate).toBeUndefined();
    expect(loneCandidateAutoPick(snap, snap.length - 1, [RAY])).toBeNull();
  });
});
