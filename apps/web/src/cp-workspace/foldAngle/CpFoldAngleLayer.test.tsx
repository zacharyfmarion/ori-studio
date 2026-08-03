import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OristudioCpLineSegment } from '../../engine/oristudioCpTypes';
import { FOLD_MAGNITUDE_UNITS_PER_DEGREE } from '../../lib/foldAngle';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import type { ToolPreviewSegment } from '../tools/types';
import { CpFoldAngleLayer } from './CpFoldAngleLayer';

const deg = (value: number) => value * FOLD_MAGNITUDE_UNITS_PER_DEGREE;

function crease(
  color: string,
  y: number,
  foldMagnitude?: number,
  length = 200
): OristudioCpLineSegment {
  return {
    a: { x: 0, y },
    b: { x: length, y },
    color,
    active: 'Inactive0',
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    ...(foldMagnitude === undefined ? {} : { fold_magnitude: foldMagnitude }),
  };
}

describe('CpFoldAngleLayer', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    // Identity model→CSS affine, so model units are screen pixels.
    cpOverlayViewStore.set({
      model: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
      user: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const render = (segments: OristudioCpLineSegment[]) => {
    act(() => {
      root.render(<CpFoldAngleLayer lineSegments={segments} />);
    });
    return [...host.querySelectorAll('.cp-fold-angle-layer__badge')];
  };

  it('labels a non-classic crease with its signed angle', () => {
    const badges = render([crease('Red1', 10, deg(90))]);
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('-90°');
    expect((badges[0] as HTMLElement).dataset.detail).toBe('number');
  });

  it('signs the angle by direction, so the badge and the colour agree', () => {
    // Deliberately redundant with the crease colour. That is what makes the
    // convention learnable: a red crease reading -90 teaches "red is negative",
    // where an unsigned 90 on both would imply they are the same fold.
    const badges = render([crease('Red1', 10, deg(90)), crease('Blue2', 20, deg(90))]);
    expect(badges.map((b) => b.textContent)).toEqual(['-90°', '90°']);
  });

  it('never prints a negative zero', () => {
    // An unfolded mountain is an unfolded crease. `-0°` would read as a distinct
    // state, and it is not one — the ramp renders it identically to `Blue2+0`.
    const badges = render([crease('Red1', 10, 0), crease('Blue2', 20, 0)]);
    expect(badges.map((b) => b.textContent)).toEqual(['0°', '0°']);
  });

  it('renders nothing for a classic pattern', () => {
    // The whole point of the classic path: an Oriedita-compatible document must
    // look exactly as it did before this feature.
    expect(render([crease('Red1', 10), crease('Blue2', 20), crease('Black0', 30)])).toEqual([]);
  });

  it('ignores lines that cannot carry a fold angle', () => {
    expect(render([crease('Black0', 10, deg(90)), crease('Cyan3', 20, deg(45))])).toEqual([]);
  });

  it('degrades to a dot when the crease is too short for a number', () => {
    const badges = render([crease('Red1', 10, deg(45), 12)]);
    expect(badges).toHaveLength(1);
    expect((badges[0] as HTMLElement).dataset.detail).toBe('dot');
    expect(badges[0].textContent).toBe('');
  });

  it('renders nothing when there is no camera yet', () => {
    // Matches the other overlay layers: no view published means no projection.
    act(() => root.render(<CpFoldAngleLayer lineSegments={undefined} />));
    expect(host.querySelectorAll('.cp-fold-angle-layer__badge')).toHaveLength(0);
  });

  it('places the badge at the crease midpoint', () => {
    const badges = render([crease('Blue2', 40, deg(60), 100)]);
    expect((badges[0] as HTMLElement).style.transform).toContain('translate(50px, 40px)');
  });

  describe('tool candidates', () => {
    const candidate = (
      color: string,
      y: number,
      foldMagnitude?: number,
      length = 200
    ): ToolPreviewSegment => ({
      a: { x: 0, y },
      b: { x: length, y },
      crease: { color, ...(foldMagnitude === undefined ? {} : { foldMagnitude }) },
    });

    const renderCandidates = (candidates: ToolPreviewSegment[], segments: OristudioCpLineSegment[] = []) => {
      act(() => {
        root.render(<CpFoldAngleLayer lineSegments={segments} toolCandidates={candidates} />);
      });
      return [...host.querySelectorAll('.cp-fold-angle-layer__badge')];
    };

    it('labels a solved candidate with the angle it would commit', () => {
      const badges = renderCandidates([candidate('Red1', 10, deg(90))]);
      expect(badges).toHaveLength(1);
      expect(badges[0].textContent).toBe('-90°');
      expect((badges[0] as HTMLElement).dataset.candidate).toBe('true');
    });

    it('leaves a full-fold candidate unbadged, exactly as a document crease is', () => {
      // On a flat pattern every candidate is 180, so a number on each would be
      // noise laid over the colour — which already carries the fact that varies,
      // mountain or valley. Same rule the document follows.
      expect(renderCandidates([candidate('Blue2', 10)])).toEqual([]);
    });

    it('shows candidates even when the labels toggle is off', () => {
      // The angle is the tool's output, not document decoration.
      useWorkspaceStore.setState((state) => ({
        oristudioCpViewport: { ...state.oristudioCpViewport, foldAngleLabelsVisible: false },
      }));
      const badges = renderCandidates([candidate('Red1', 10, deg(45))], [crease('Red1', 20, deg(90))]);
      expect(badges).toHaveLength(1);
      expect((badges[0] as HTMLElement).dataset.candidate).toBe('true');
      useWorkspaceStore.setState((state) => ({
        oristudioCpViewport: { ...state.oristudioCpViewport, foldAngleLabelsVisible: true },
      }));
    });

    it('ignores a candidate the kernel did not solve a crease for', () => {
      act(() => {
        root.render(
          <CpFoldAngleLayer
            lineSegments={[]}
            toolCandidates={[{ a: { x: 0, y: 0 }, b: { x: 200, y: 0 } }]}
          />
        );
      });
      expect(host.querySelectorAll('.cp-fold-angle-layer__badge')).toHaveLength(0);
    });
  });
});
