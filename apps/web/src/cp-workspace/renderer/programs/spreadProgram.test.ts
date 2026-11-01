/**
 * The spread pass's draws, on a recording regl: what a pane of its own —
 * Fold's, the Diagram's, a capture — is drawn with stays #563's to the value
 * (`WHOLE_CHANNEL_SPREAD`), and what Edit's canvas adds for its figures — a
 * band per figure, a fade, X-ray — stays inside the figure's band.
 */
import type { Visibility } from '@oristudio/layer-spread';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StrokeGeometry, ViewTransform } from '../types';
import { spreadInkDepthBias } from './spreadDepth';

const recorded = vi.hoisted(() => ({
  draws: [] as Array<{ command: string; props?: Record<string, unknown> }>,
  ink: [] as StrokeGeometry[],
  inkPrograms: 0,
}));
vi.mock('./strokeProgram', () => ({
  createStrokeProgram: () => {
    const id = recorded.inkPrograms++;
    return {
      setData: (geometry: StrokeGeometry) => recorded.ink.push(geometry),
      draw: () => recorded.draws.push({ command: `ink:${id}` }),
      dispose: () => {},
    };
  },
}));

const {
  createSpreadProgram,
  placedSpreadView,
  spreadDrawPlan,
  spreadSeesThrough,
  spreadXrayOrder,
  WHOLE_CHANNEL_SPREAD,
} = await import('./spreadProgram');
type SpreadGeometry = import('./spreadProgram').SpreadGeometry;
type SpreadLayout = import('./spreadProgram').SpreadLayout;

const DEPTH_BITS = 24;

/** A regl that records each draw by its depth state, and each clear. */
function recordingRegl() {
  const command = (config: Record<string, unknown>) => {
    const depth = config.depth as { enable: boolean; mask?: boolean; func?: string } | undefined;
    const name =
      typeof config.vert === 'string' && (config.uniforms as Record<string, unknown>).base
        ? `fill:${depth?.mask ? 'write' : 'keep'}:${depth?.func}`
        : typeof config.vert === 'string'
          ? 'mask'
          : 'scope';
    return (props: unknown, body?: () => void) => {
      if (typeof props === 'function') return (props as () => void)();
      recorded.draws.push({ command: name, props: props as Record<string, unknown> });
      body?.();
    };
  };
  const buffer = () => Object.assign(() => {}, { destroy: () => {} });
  return Object.assign(command, {
    buffer,
    clear: (options: Record<string, unknown>) =>
      recorded.draws.push({ command: `clear:${Object.keys(options).join(',')}` }),
    _gl: { DEPTH_BITS: 0x0d56, getParameter: () => DEPTH_BITS },
  }) as unknown as Parameters<typeof createSpreadProgram>[0];
}

function strokes(depth: number): StrokeGeometry {
  return {
    a: new Float32Array([0, 0]),
    b: new Float32Array([1, 0]),
    color: new Float32Array([0.1, 0.2, 0.3, 1]),
    widthMul: new Float32Array([1]),
    count: 1,
    depth: new Float32Array([depth]),
    depthEnd: new Float32Array([depth]),
  };
}

/** Faces of one triangle each, at the heights given, under `visibility`. */
function geometry(heights: number[], visibility: Visibility): SpreadGeometry {
  return {
    visibility,
    faces: heights.map((height) => ({
      fills: {
        position: new Float32Array([0, 0, 1, 0, 0, 1]),
        color: new Float32Array(12).fill(1),
        count: 3,
        depth: new Float32Array([height, height, height]),
      },
      strokes: strokes(height),
    })),
  };
}

const ACYCLIC: Visibility = { ranks: [1, 0], cyclic: false, above: [[], [0]] };
const CYCLIC: Visibility = { ranks: null, cyclic: true, above: [[1], [0]] };
const VIEW = { origin: [0, 0] as const, ex: [1, 0] as const, ey: [0, 1] as const };
const DRAW = { view: VIEW, viewport: { width: 10, height: 10, dpr: 1 }, widthPx: 1 };
const BAND: SpreadLayout = { band: { base: 0.5, span: 0.25 }, opacity: 1, xray: null };

const fills = () => recorded.draws.filter(({ command }) => command.startsWith('fill'));
const commands = () => recorded.draws.map(({ command }) => command);

beforeEach(() => {
  recorded.draws.length = 0;
  recorded.ink.length = 0;
  recorded.inkPrograms = 0;
});

describe('spreadDrawPlan', () => {
  const faces = [0, 1];
  it('draws a whole-channel picture as #563 did: fills in their bands, then ink; a cycle clears depth', () => {
    expect(spreadDrawPlan(ACYCLIC, WHOLE_CHANNEL_SPREAD, faces, faces)).toEqual([
      { kind: 'fills', faces, depth: 'write' },
      { kind: 'ink', faces },
    ]);
    expect(spreadDrawPlan(CYCLIC, WHOLE_CHANNEL_SPREAD, faces, faces).map((pass) => pass.kind)).toEqual([
      'fills',
      'ink',
      'clear-depth',
      'corrected-fills',
      'corrected-ink',
    ]);
  });

  it('never clears depth inside a band: a cycle resets its own footprint', () => {
    const kinds = spreadDrawPlan(CYCLIC, BAND, faces, faces).map((pass) => pass.kind);
    expect(kinds).toEqual(['fills', 'ink', 'reset-depth', 'corrected-fills', 'corrected-ink']);
    expect(kinds).not.toContain('clear-depth');
  });

  it('fades paper through a depth-only pass, so each pixel blends its top face once', () => {
    expect(spreadDrawPlan(ACYCLIC, { ...BAND, opacity: 0.45 }, faces, faces)).toEqual([
      { kind: 'fills', faces, depth: 'only' },
      { kind: 'fills', faces, depth: 'equal' },
      { kind: 'ink', faces },
    ]);
  });

  it('draws X-ray back to front writing no depth, then every line, then the depth', () => {
    for (const visibility of [ACYCLIC, CYCLIC]) {
      expect(spreadDrawPlan(visibility, { ...BAND, xray: { faceAlpha: 0.3 } }, faces, [1, 0])).toEqual([
        { kind: 'fills', faces: [1, 0], depth: 'test' },
        { kind: 'ink', faces },
        { kind: 'fills', faces, depth: 'only' },
      ]);
    }
  });
});

describe('spreadSeesThrough', () => {
  it('is X-ray, or a fade on an acyclic picture; never opaque paper or a whole-channel pane', () => {
    expect(spreadSeesThrough(ACYCLIC, WHOLE_CHANNEL_SPREAD)).toBe(false);
    expect(spreadSeesThrough(CYCLIC, BAND)).toBe(false);
    expect(spreadSeesThrough(ACYCLIC, { ...BAND, opacity: 0.45 })).toBe(true);
    expect(spreadSeesThrough(CYCLIC, { ...BAND, opacity: 0.45 })).toBe(false);
    expect(spreadSeesThrough(CYCLIC, { ...BAND, xray: { faceAlpha: 0.3 } })).toBe(true);
  });
});

describe('spreadXrayOrder', () => {
  it('goes by global rank, then height, then face', () => {
    expect(spreadXrayOrder({ ranks: [2, 0, 1, 0], cyclic: false, above: [] }, [0.1, 0.9, 0.5, 0.2])).toEqual([
      3, 1, 2, 0,
    ]);
  });

  it('goes by height alone through a cycle', () => {
    expect(spreadXrayOrder({ ranks: null, cyclic: true, above: [] }, [0.7, 0.2, 0.2])).toEqual([1, 2, 0]);
  });
});

describe('placedSpreadView', () => {
  it('is the view after a scale and a shift', () => {
    const view: ViewTransform = { origin: [10, 20], ex: [2, 1], ey: [-1, 2] };
    const placed = placedSpreadView(view, { scale: 3, x: 5, y: -4 });
    const through = (v: ViewTransform, [x, y]: [number, number]) => [
      v.origin[0] + x * v.ex[0] + y * v.ey[0],
      v.origin[1] + x * v.ex[1] + y * v.ey[1],
    ];
    for (const p of [
      [0, 0],
      [1, 2],
      [-3, 0.5],
    ] as Array<[number, number]>) {
      const [ux, uy] = [3 * p[0] + 5, 3 * p[1] - 4];
      expect(through(placed, p)[0]).toBeCloseTo(through(view, [ux, uy])[0]!, 12);
      expect(through(placed, p)[1]).toBeCloseTo(through(view, [ux, uy])[1]!, 12);
    }
  });
});

describe('createSpreadProgram', () => {
  it('draws a whole-channel picture exactly as #563 did', () => {
    const program = createSpreadProgram(recordingRegl());
    const picture = geometry([0.25, 0.75], ACYCLIC);
    program.setData(picture);
    program.draw(DRAW);
    expect(commands()).toEqual(['fill:write:lequal', 'fill:write:lequal', 'ink:0', 'ink:1']);
    for (const { props } of fills()) expect(props).toMatchObject({ base: 0, span: 1, alpha: 1, bands: 2, color: true });
    // #563's line depth, to the bit: (rank + 0.1 + 0.8 z) / bands + bias.
    const bias = spreadInkDepthBias(2, DEPTH_BITS);
    expect(Array.from(recorded.ink[0]!.depth!)).toEqual(Array.from(Float32Array.of((1 + 0.1 + 0.8 * 0.25) / 2 + bias)));
    expect(Array.from(recorded.ink[1]!.depth!)).toEqual(Array.from(Float32Array.of((0 + 0.1 + 0.8 * 0.75) / 2 + bias)));
    // Its own colours, handed over as they came.
    expect(recorded.ink[0]!.color).toBe(picture.faces[0]!.strokes.color);
  });

  it('clears depth for a whole-channel cycle and resets only its footprint inside a band', () => {
    const whole = createSpreadProgram(recordingRegl());
    whole.setData(geometry([0.25, 0.75], CYCLIC));
    whole.draw(DRAW);
    expect(commands()).toContain('clear:depth');
    expect(commands()).not.toContain('fill:write:always');

    recorded.draws.length = 0;
    const banded = createSpreadProgram(recordingRegl());
    banded.setData(geometry([0.25, 0.75], CYCLIC), BAND);
    banded.draw(DRAW);
    expect(commands()).not.toContain('clear:depth');
    const resets = recorded.draws.filter(({ command }) => command === 'fill:write:always');
    expect(resets).toHaveLength(2);
    // At the band's floor, below every fill of the figure and above every band beneath it.
    for (const { props } of resets) expect(props).toMatchObject({ base: 0.5 + 0.25 * 0.05, span: 0, color: false });
  });

  it('keeps a banded figure’s fills and lines inside its band, faded by its opacity', () => {
    const program = createSpreadProgram(recordingRegl());
    program.setData(geometry([0, 1], ACYCLIC), { ...BAND, opacity: 0.45 });
    program.draw(DRAW);
    expect(commands()).toEqual([
      'fill:write:lequal',
      'fill:write:lequal',
      'fill:keep:equal',
      'fill:keep:equal',
      'ink:0',
      'ink:1',
    ]);
    const [prepass, , colour] = fills();
    expect(prepass!.props).toMatchObject({ color: false, base: 0.5, span: 0.25 });
    expect(colour!.props).toMatchObject({ color: true, alpha: 0.45 });
    const bias = spreadInkDepthBias(2, DEPTH_BITS, 0.25);
    for (const ink of recorded.ink) {
      const depth = ink.depth![0]!;
      expect(depth).toBeGreaterThan(0.5);
      expect(depth).toBeLessThan(0.75);
      expect(ink.color[3]).toBeCloseTo(0.45, 6);
    }
    expect(recorded.ink[0]!.depth![0]).toBeCloseTo(0.5 + 0.25 * ((1 + 0.1) / 2) + bias, 6);
  });

  it('draws X-ray see-through: back to front at its alpha, writing no depth, lines after, depth last', () => {
    const program = createSpreadProgram(recordingRegl());
    program.setData(geometry([0.25, 0.75], ACYCLIC), { ...BAND, opacity: 0.5, xray: { faceAlpha: 0.4 } });
    program.draw(DRAW);
    expect(commands()).toEqual([
      'fill:keep:lequal',
      'fill:keep:lequal',
      'ink:0',
      'ink:1',
      'fill:write:lequal',
      'fill:write:lequal',
    ]);
    const [back, front] = fills();
    // Face 1 has rank 0: it is drawn first.
    expect(back!.props).toMatchObject({ rank: 0, alpha: 0.4 * 0.5, color: true });
    expect(front!.props).toMatchObject({ rank: 1 });
    for (const pass of fills().slice(2)) expect(pass.props).toMatchObject({ color: false });
  });

  it('uploads nothing for the picture it holds, and only the lines for a new layout', () => {
    const program = createSpreadProgram(recordingRegl());
    const picture = geometry([0.25, 0.75], ACYCLIC);
    program.setData(picture, BAND);
    expect(recorded.ink).toHaveLength(2);
    program.setData(picture, { ...BAND });
    expect(recorded.ink).toHaveLength(2);
    expect(recorded.inkPrograms).toBe(2);
    program.setData(picture, { ...BAND, band: { base: 0.25, span: 0.25 } });
    expect(recorded.ink).toHaveLength(4);
    expect(recorded.inkPrograms).toBe(2);
    expect(recorded.ink[2]!.depth![0]).toBeLessThan(0.5);
  });
});
