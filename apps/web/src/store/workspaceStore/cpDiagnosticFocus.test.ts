import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerCpCamera, type CpCameraHandle } from '../../cp-workspace/renderer/cpCameraRegistry';
import { createCpSuppressionRegion } from '../../cp-workspace/annotations/suppressionRegion';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import type { WorkspaceState } from './types';
import { frameActiveCpDiagnostic } from './cpDiagnosticFocus';

/**
 * A suppressed diagnostic must not move the camera.
 *
 * This function was the last place the check-class filter had to reach, and the
 * only one where leaving it out is invisible rather than merely wrong: the marker
 * is not drawn and the HUD row is not listed, so all the user sees is the canvas
 * jumping to a spot with nothing on it. Every other call site renders something,
 * so a missing filter there shows up as a stray marker.
 */
const KAWASAKI = {
  id: 'kawasaki-1',
  rule: 'Angles',
  point: { x: 120, y: 80 },
  violation_color: 'Unknown',
} as unknown as OristudioCpDiagnosticEntry;

const MAEKAWA = {
  id: 'maekawa-1',
  rule: 'Maekawa',
  point: { x: 300, y: 200 },
  violation_color: 'NotEnoughMountain',
} as unknown as OristudioCpDiagnosticEntry;

function stateWith(
  entries: readonly OristudioCpDiagnosticEntry[],
  activeId: string,
  viewport: Record<string, unknown>,
  annotations: readonly unknown[] = []
): WorkspaceState {
  return {
    oristudioCpCamvResult: { diagnostic_entries: entries },
    oristudioCpDocument: null,
    oristudioCpActiveDiagnosticId: activeId,
    oristudioCpViewport: { camvIssuesVisible: true, ...viewport },
    oristudioCpAnnotations: annotations,
  } as unknown as WorkspaceState;
}

let framed = 0;
let release: (() => void) | null = null;

beforeEach(() => {
  framed = 0;
  release = registerCpCamera({
    frameModelBounds: () => {
      framed += 1;
    },
  } as unknown as CpCameraHandle);
});

afterEach(() => {
  release?.();
  release = null;
});

describe('frameActiveCpDiagnostic', () => {
  it('frames a visible diagnostic', () => {
    frameActiveCpDiagnostic(stateWith([KAWASAKI], KAWASAKI.id, {}));
    expect(framed).toBe(1);
  });

  it('does not frame one hidden by the document check-class filter', () => {
    frameActiveCpDiagnostic(
      stateWith([KAWASAKI], KAWASAKI.id, { suppressedCheckClasses: ['kawasaki'] })
    );
    expect(framed).toBe(0);
  });

  it('does not frame one hidden by a region it sits inside', () => {
    const region = createCpSuppressionRegion({
      center: { x: 120, y: 80 },
      width: 100,
      height: 100,
      suppress: ['kawasaki'],
    });
    frameActiveCpDiagnostic(stateWith([KAWASAKI], KAWASAKI.id, {}, [region]));
    expect(framed).toBe(0);
  });

  it('still frames one the region does not cover', () => {
    const region = createCpSuppressionRegion({
      center: { x: 120, y: 80 },
      width: 20,
      height: 20,
      suppress: ['kawasaki', 'bigLittleBig', 'maekawa', 'vertexClosure'],
    });
    // Maekawa's point is well outside the box, so the region has no say over it.
    frameActiveCpDiagnostic(stateWith([KAWASAKI, MAEKAWA], MAEKAWA.id, {}, [region]));
    expect(framed).toBe(1);
  });
});
