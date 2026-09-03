import { describe, expect, it } from 'vitest';
import {
  CP_ACTIVE_TOOL_MODES,
  cpPointerReleaseRoute,
  toolModeArmsDrawStart,
  toolModeSnapsDrawPoint,
  type ActiveToolMode,
  type CpReleaseState,
} from './pointerRelease';

const idle: CpReleaseState = {
  toolMode: null,
  erasing: false,
  panning: false,
  drawing: false,
  movingSelection: false,
  selecting: false,
  moved: false,
  cancelled: false,
  transformPointCount: null,
  sequenceStep: 0,
};

const release = (over: Partial<CpReleaseState>) => cpPointerReleaseRoute({ ...idle, ...over });

describe('cpPointerReleaseRoute', () => {
  describe('an in-flight erase outranks every tool mode', () => {
    // The regression this file exists for: the Angle Restricted Line branch used to
    // match on `!panning` alone, so a right-drag started while that tool was active
    // was routed to the tool instead of the eraser. The box never committed, and the
    // skipped branch was also the one that clears `erasing` — leaving it set for the
    // life of the canvas, which fed every later drag to a stale erase runtime.
    //
    // Parameterised over CP_ACTIVE_TOOL_MODES (a total Record of ActiveToolMode, so
    // a new mode cannot be added without appearing here) to cover the whole class,
    // not just the two modes that were wrong.
    it.each([...CP_ACTIVE_TOOL_MODES, null])('routes to erase with toolMode %s', (toolMode) => {
      expect(release({ toolMode, erasing: true })).toBe('erase');
    });

    it('still routes to erase when the tool would otherwise commit a drag', () => {
      expect(
        release({
          toolMode: 'sequence',
          erasing: true,
          moved: true,
          transformPointCount: 2,
          sequenceStep: 1,
        })
      ).toBe('erase');
    });

    it('routes a cancelled erase to erase, so the gesture is torn down', () => {
      expect(release({ toolMode: 'angle-drag', erasing: true, cancelled: true })).toBe('erase');
    });

    it('routes to erase even while the canvas thinks it is drawing or selecting', () => {
      expect(release({ erasing: true, drawing: true })).toBe('erase');
      expect(release({ erasing: true, selecting: true })).toBe('erase');
      expect(release({ erasing: true, movingSelection: true })).toBe('erase');
    });
  });

  describe('a pan claims the gesture from every tool mode', () => {
    it.each(CP_ACTIVE_TOOL_MODES)('declines toolMode %s while panning', (toolMode) => {
      expect(release({ toolMode, panning: true })).toBe('none');
    });
  });

  describe('tool-mode releases', () => {
    it('routes angle-drag to its own handler', () => {
      expect(release({ toolMode: 'angle-drag' })).toBe('angle-drag');
      expect(release({ toolMode: 'angle-drag', moved: true })).toBe('angle-drag');
    });

    it('routes lengthen to its own handler', () => {
      expect(release({ toolMode: 'lengthen' })).toBe('lengthen');
    });

    it('routes text to its own handler', () => {
      expect(release({ toolMode: 'text' })).toBe('text');
    });

    it('commits a two-point sequence transform dragged to its destination', () => {
      expect(
        release({ toolMode: 'sequence', transformPointCount: 2, sequenceStep: 1, moved: true })
      ).toBe('sequence-drag-commit');
    });

    it('leaves a click (no drag) on a two-point transform to the click path', () => {
      expect(
        release({ toolMode: 'sequence', transformPointCount: 2, sequenceStep: 1, moved: false })
      ).toBe('none');
    });

    it('does not drag-commit a two-point transform on its first step', () => {
      expect(
        release({ toolMode: 'sequence', transformPointCount: 2, sequenceStep: 0, moved: true })
      ).toBe('none');
    });

    it('does not drag-commit a cancelled sequence gesture', () => {
      expect(
        release({
          toolMode: 'sequence',
          transformPointCount: 2,
          sequenceStep: 1,
          moved: true,
          cancelled: true,
        })
      ).toBe('none');
    });
  });

  describe('plain-canvas gestures', () => {
    it('routes a drag-engine draw to the draw handler', () => {
      expect(release({ toolMode: 'drag-line', drawing: true })).toBe('draw');
      expect(release({ toolMode: 'drag-box', drawing: true })).toBe('draw');
      expect(release({ toolMode: 'drag-path', drawing: true })).toBe('draw');
    });

    it('routes a selection translation to the move handler', () => {
      expect(release({ movingSelection: true, moved: true })).toBe('move-selection');
    });

    it('routes a plain press to selection', () => {
      expect(release({ selecting: true })).toBe('select');
    });

    it('routes an empty release to nothing', () => {
      expect(release({})).toBe('none');
    });
  });

  describe('mode coverage', () => {
    it('enumerates every ActiveToolMode', () => {
      // Guards the parameterised suites above: if a mode is dropped from ALL_MODES
      // the exhaustive cases silently stop covering it.
      const expected: ActiveToolMode[] = [
        'drag-line',
        'drag-box',
        'drag-path',
        'drag-vertex',
        'sequence',
        'line-entity',
        'lengthen',
        'angle-drag',
        'text',
      ];
      expect([...CP_ACTIVE_TOOL_MODES].sort()).toEqual(expected.sort());
    });
  });
});

const SNAPPING_MODES: ActiveToolMode[] = ['drag-line', 'angle-drag', 'drag-vertex'];
const ARMING_MODES: ActiveToolMode[] = ['drag-line', 'angle-drag'];

describe('toolModeSnapsDrawPoint', () => {
  // Every mode here measures a release against a start, so a phase left unsnapped
  // makes the snap displacement itself read as pointer travel. Angle Restricted
  // Line used to snap only its press (a 10px radius against a 4px click
  // threshold), so a stationary click near a vertex committed a crease from the
  // vertex to the cursor. Move Vertex is in the same position: its anchor is a
  // junction the surface resolved, so its release must be snapped to compare like
  // with like.
  it.each(SNAPPING_MODES)('snaps %s, which measures a release against a start', (mode) => {
    expect(toolModeSnapsDrawPoint(mode)).toBe(true);
  });

  // Selection/erase boxes and freehand paths follow the raw cursor, so a rubber-band
  // select doesn't jump to nearby points.
  it.each(CP_ACTIVE_TOOL_MODES.filter((mode) => !SNAPPING_MODES.includes(mode)))(
    'leaves %s on the raw cursor',
    (mode) => {
      expect(toolModeSnapsDrawPoint(mode)).toBe(false);
    }
  );

  it('is false with no tool active', () => {
    expect(toolModeSnapsDrawPoint(null)).toBe(false);
  });
});

describe('toolModeArmsDrawStart', () => {
  // The predicate that used to be conflated with snapping. `drawRuntime` hands
  // every arming mode the *persistent drag-line runtime*, so a mode listed here by
  // mistake draws creases instead of running its own engine — which is what would
  // have happened to Move Vertex had the two stayed one predicate.
  it.each(ARMING_MODES)('%s parks a start between gestures', (mode) => {
    expect(toolModeArmsDrawStart(mode)).toBe(true);
  });

  it.each(CP_ACTIVE_TOOL_MODES.filter((mode) => !ARMING_MODES.includes(mode)))(
    '%s opens a fresh engine per press',
    (mode) => {
      expect(toolModeArmsDrawStart(mode)).toBe(false);
    }
  );

  it('is a strict subset of the snapping modes', () => {
    // Arming implies snapping (both arming modes run `dragLineTool`), but not the
    // reverse — that asymmetry is the whole reason the two are separate.
    for (const mode of ARMING_MODES) expect(toolModeSnapsDrawPoint(mode)).toBe(true);
    expect(SNAPPING_MODES.some((mode) => !ARMING_MODES.includes(mode))).toBe(true);
  });

  it('is false with no tool active', () => {
    expect(toolModeArmsDrawStart(null)).toBe(false);
  });
});
