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
      root.render(<CpFoldAngleLayer lineSegments={segments} toolReplacedLineIds={[]} />);
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

  it('rounds a solved angle to two decimals', () => {
    // What a solve actually hands back. A dense pattern puts neighbouring badges
    // within a few pixels of each other, so the digits past the second are width
    // the label cannot spend — they push it into its neighbour and both stop
    // being readable.
    const badges = render([crease('Red1', 10, deg(70.5288)), crease('Blue2', 20, deg(53.4588))]);
    expect(badges.map((b) => b.textContent)).toEqual(['-70.53°', '53.46°']);
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
    act(() => root.render(<CpFoldAngleLayer lineSegments={undefined} toolReplacedLineIds={[]} />));
    expect(host.querySelectorAll('.cp-fold-angle-layer__badge')).toHaveLength(0);
  });

  it('places the badge at the crease midpoint', () => {
    const badges = render([crease('Blue2', 40, deg(60), 100)]);
    expect((badges[0] as HTMLElement).style.transform).toContain('translate(50px, 40px)');
  });

  describe('camera', () => {
    const setView = (origin: [number, number], ex: [number, number], ey: [number, number]) => {
      act(() => {
        cpOverlayViewStore.set({ model: { origin, ex, ey }, user: { origin, ex, ey } });
      });
    };
    const layer = () => host.querySelector('.cp-fold-angle-layer') as HTMLElement;

    it('translates the whole layer on a pan, leaving the badges untouched', () => {
      // The optimisation this layer exists on: a pan moves `origin` only, so one
      // transform on the container reproduces every badge position exactly. If
      // this ever regresses to re-projecting per badge, panning a dense pattern
      // costs a React render and 300 style writes per frame.
      const badges = render([crease('Red1', 10, deg(90)), crease('Blue2', 20, deg(45))]);
      const before = badges.map((badge) => (badge as HTMLElement).style.transform);

      setView([30, -12], [1, 0], [0, 1]);

      const after = [...host.querySelectorAll('.cp-fold-angle-layer__badge')];
      expect(after[0]).toBe(badges[0]);
      expect(after[1]).toBe(badges[1]);
      expect(after.map((badge) => (badge as HTMLElement).style.transform)).toEqual(before);
      expect(layer().style.transform).toBe('translate(30px, -12px)');
    });

    it('re-projects on a zoom, because screen lengths decide the plan', () => {
      render([crease('Blue2', 40, deg(60), 100)]);

      setView([0, 0], [2, 0], [0, 2]);

      // Midpoint (50, 40) through a 2x basis, and the accumulated pan offset is
      // back to zero because the badges carry their own new positions again.
      expect((host.querySelector('.cp-fold-angle-layer__badge') as HTMLElement).style.transform)
        .toContain('translate(100px, 80px)');
      expect(layer().style.transform).toBe('');
    });

    it('keeps panning correctly after a zoom re-plan', () => {
      render([crease('Blue2', 40, deg(60), 100)]);
      setView([0, 0], [2, 0], [0, 2]);
      // The delta is measured from the re-planned view, not the original one.
      setView([15, 25], [2, 0], [0, 2]);
      expect(layer().style.transform).toBe('translate(15px, 25px)');
    });
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
        root.render(
          <CpFoldAngleLayer
            lineSegments={segments}
            toolCandidates={candidates}
            toolReplacedLineIds={[]}
          />
        );
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
            toolReplacedLineIds={[]}
          />
        );
      });
      expect(host.querySelectorAll('.cp-fold-angle-layer__badge')).toHaveLength(0);
    });
  });

  describe('creases a tool has taken the place of', () => {
    const candidate = (color: string, y: number, foldMagnitude?: number): ToolPreviewSegment => ({
      a: { x: 0, y },
      b: { x: 200, y },
      crease: { color, ...(foldMagnitude === undefined ? {} : { foldMagnitude }) },
    });

    const renderReview = (
      segments: OristudioCpLineSegment[],
      candidates: ToolPreviewSegment[],
      replaced: number[]
    ) => {
      act(() => {
        root.render(
          <CpFoldAngleLayer
            lineSegments={segments}
            toolCandidates={candidates}
            toolReplacedLineIds={replaced}
          />
        );
      });
      return [...host.querySelectorAll('.cp-fold-angle-layer__badge')].map((badge) => ({
        text: badge.textContent,
        candidate: (badge as HTMLElement).dataset.candidate === 'true',
      }));
    };

    it('shows the answer alone, not the answer beside the angle it replaces', () => {
      // The reported case, minus the geometry: the second solution takes a
      // crease sitting at 109.47° down to flat. The canvas has already stopped
      // drawing that crease, so the only number left should be the tool's.
      expect(
        renderReview([crease('Blue2', 10, deg(109.47))], [candidate('Blue2', 10, 0)], [1])
      ).toEqual([{ text: '0°', candidate: true }]);
    });

    it('leaves every crease the tool did not name alone', () => {
      // The set is a claim about three creases at one vertex, not about the
      // document — a filter that reached further would blank a pattern whenever
      // any tool opened.
      expect(
        renderReview(
          [crease('Red1', 10, deg(90)), crease('Blue2', 20, deg(45))],
          [candidate('Red1', 10, 0)],
          [1]
        )
      ).toEqual([
        { text: '45°', candidate: false },
        { text: '0°', candidate: true },
      ]);
    });

    it('reads the ids one-based, the space the kernel and the canvas both use', () => {
      // Off by one and this drops a bystander's badge while leaving the stale
      // one it was aimed at — which looks like the bug it fixes, one crease over.
      expect(renderReview([crease('Red1', 10, deg(90)), crease('Blue2', 20, deg(45))], [], [2])).toEqual(
        [{ text: '-90°', candidate: false }]
      );
    });

    it('says nothing at all where the answer decided nothing', () => {
      // A zero answer leaves an unassigned crease undecided rather than picking
      // a direction for it, so the candidate carries no angle and gets no badge.
      // The old number must go with the stroke regardless: it is the one thing
      // on screen that would still claim the solve had chosen something.
      expect(renderReview([crease('Blue2', 10, deg(109.47))], [candidate('None', 10)], [1])).toEqual(
        []
      );
    });
  });
});
