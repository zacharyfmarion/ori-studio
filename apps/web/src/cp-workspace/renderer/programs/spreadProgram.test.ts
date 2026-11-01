/**
 * The spread pass's draws, on a recording regl: what a pane of its own —
 * Fold's, the Diagram's, a capture — is drawn with stays #563's to the value
 * (`WHOLE_CHANNEL_SPREAD`), and what Edit's canvas adds for its figures — a
 * band per figure, a fade, X-ray — stays inside the figure's band. A pass over
 * every face is one draw however many faces there are; only a cycle's
 * corrected passes go face by face.
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
      draw: (_props: unknown, range?: { first: number; count: number }) =>
        recorded.draws.push({ command: range ? `ink:${id}:${range.first}+${range.count}` : `ink:${id}` }),
      dispose: () => {},
    };
  },
}));

const {
  createSpreadProgram,
  mergedSpreadInk,
  placedSpreadView,
  spreadDrawPlan,
  spreadSeesThrough,
  spreadXrayOrder,
  WHOLE_CHANNEL_SPREAD,
} = await import('./spreadProgram');
type SpreadGeometry = import('./spreadProgram').SpreadGeometry;
type SpreadLayout = import('./spreadProgram').SpreadLayout;

const DEPTH_BITS = 24;

/** A buffer as the recording regl hands it out: what it was last given. */
type RecordedBuffer = ((data: unknown) => void) & { data: unknown; destroy: () => void };

/**
 * A regl that records each draw by its depth state, each stencil scope by
 * whether it marks or tests and with which value, each clear, and what each
 * buffer holds.
 */
function recordingRegl() {
  const command = (config: Record<string, unknown>) => {
    const depth = config.depth as { enable: boolean; mask?: boolean; func?: string } | undefined;
    const stencil = config.stencil as { opFront?: { zpass: string } } | undefined;
    const name =
      typeof config.vert === 'string' && (config.uniforms as Record<string, unknown>).base
        ? `fill:${depth?.mask ? 'write' : 'keep'}:${depth?.func}`
        : typeof config.vert === 'string'
          ? 'mask'
          : stencil?.opFront?.zpass === 'replace'
            ? 'mark'
            : 'test';
    return (props: unknown, body?: () => void) => {
      if (typeof props === 'function') return (props as () => void)();
      const ref = (props as { ref?: number }).ref;
      recorded.draws.push({ command: ref === undefined ? name : `${name}:${ref}`, props: props as Record<string, unknown> });
      body?.();
    };
  };
  const buffer = (initial?: unknown) => {
    const handle = ((data: unknown) => {
      handle.data = data;
    }) as RecordedBuffer;
    handle.data = initial;
    handle.destroy = () => {};
    return handle;
  };
  return Object.assign(command, {
    buffer,
    clear: (options: Record<string, unknown>) =>
      recorded.draws.push({ command: `clear:${Object.keys(options).join(',')}` }),
    _gl: { DEPTH_BITS: 0x0d56, STENCIL_BITS: 0x0d57, getParameter: (name: number) => (name === 0x0d57 ? 8 : DEPTH_BITS) },
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
/** The rank on each vertex a fill draw is drawn from, in buffer order. */
const ranksOf = (draw: { props?: Record<string, unknown> }) =>
  Array.from((draw.props!.run as { rank: RecordedBuffer }).rank.data as Float32Array);

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
  it('draws a whole-channel picture as #563 did, every fill in one draw and every line in one', () => {
    const program = createSpreadProgram(recordingRegl());
    const picture = geometry([0.25, 0.75], ACYCLIC);
    program.setData(picture);
    program.draw(DRAW);
    expect(commands()).toEqual(['fill:write:lequal', 'ink:0']);
    const [every] = fills();
    expect(every!.props).toMatchObject({ base: 0, span: 1, alpha: 1, bands: 2, color: true, first: 0, count: 6 });
    // Each face's rank on its own vertices, in face order: the band a draw per face set.
    expect(ranksOf(every!)).toEqual([1, 1, 1, 0, 0, 0]);
    // #563's line depth, to the bit, face by face: (rank + 0.1 + 0.8 z) / bands + bias.
    const bias = spreadInkDepthBias(2, DEPTH_BITS);
    expect(Array.from(recorded.ink[0]!.depth!)).toEqual(
      Array.from(Float32Array.of((1 + 0.1 + 0.8 * 0.25) / 2 + bias, (0 + 0.1 + 0.8 * 0.75) / 2 + bias))
    );
    // Their own colours, face after face.
    expect(Array.from(recorded.ink[0]!.color)).toEqual([
      ...picture.faces[0]!.strokes.color,
      ...picture.faces[1]!.strokes.color,
    ]);
  });

  it('draws any number of faces in one fill draw and one line draw', () => {
    const program = createSpreadProgram(recordingRegl());
    const heights = Array.from({ length: 500 }, (_, f) => f / 500);
    program.setData(geometry(heights, { ranks: heights.map((_, f) => f % 7), cyclic: false, above: heights.map(() => []) }));
    program.draw(DRAW);
    expect(commands()).toEqual(['fill:write:lequal', 'ink:0']);
    expect(fills()[0]!.props).toMatchObject({ first: 0, count: 1500, bands: 7 });
    expect(recorded.ink[0]!.count).toBe(500);
    expect(recorded.inkPrograms).toBe(1);
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
    expect(resets).toHaveLength(1);
    // At the band's floor, below every fill of the figure and above every band beneath it.
    expect(resets[0]!.props).toMatchObject({ base: 0.5 + 0.25 * 0.05, span: 0, color: false, first: 0, count: 6 });
  });

  it('draws a cycle’s corrected faces one at a time, each inside its blockers’ mask', () => {
    const program = createSpreadProgram(recordingRegl());
    program.setData(geometry([0.25, 0.75], CYCLIC), BAND);
    program.draw(DRAW);
    // One clear, then each face marks its mask with a value of its own and is
    // drawn wherever the stencil holds any other: the masks before it never
    // need clearing away.
    expect(commands()).toEqual([
      'fill:write:lequal',
      'ink:0',
      'fill:write:always',
      'clear:stencil',
      'mark:1',
      'mask',
      'test:1',
      'fill:write:lequal',
      'mark:2',
      'mask',
      'test:2',
      'fill:write:lequal',
      'mark:3',
      'mask',
      'test:3',
      'ink:0:0+1',
      'mark:4',
      'mask',
      'test:4',
      'ink:0:1+1',
    ]);
    // Each corrected fill is its own face's range of the one buffer.
    const corrected = fills().filter(({ command }) => command === 'fill:write:lequal').slice(1);
    expect(corrected.map(({ props }) => [props!.first, props!.count])).toEqual([
      [0, 3],
      [3, 3],
    ]);
    // Each mask is the face's blocker, one triangle, at its run of one buffer.
    const masks = recorded.draws.filter(({ command }) => command === 'mask');
    expect(masks.map(({ props }) => [props!.first, props!.count])).toEqual([
      [0, 3],
      [3, 3],
      [0, 3],
      [3, 3],
    ]);
    expect(new Set(masks.map(({ props }) => props!.position)).size).toBe(1);
    // A face's own lines, for its corrected pass, are its range of the one ink program.
    expect(recorded.inkPrograms).toBe(1);
  });

  it('clears the stencil again only when a cycle’s mask values run out', () => {
    // A ring of faces, each under the next: 130 faces, 260 corrected steps.
    const count = 130;
    const ring: Visibility = { ranks: null, cyclic: true, above: Array.from({ length: count }, (_, f) => [(f + 1) % count]) };
    const program = createSpreadProgram(recordingRegl());
    program.setData(geometry(Array.from({ length: count }, (_, f) => f / count), ring), BAND);
    program.draw(DRAW);
    const marks = commands().filter((command) => command.startsWith('mark:') || command === 'clear:stencil');
    expect(marks.filter((command) => command === 'clear:stencil')).toHaveLength(2);
    // Values 1 to 255, a clear, and the rest from 1 again.
    expect(marks.slice(0, 2)).toEqual(['clear:stencil', 'mark:1']);
    expect(marks.slice(255, 258)).toEqual(['mark:255', 'clear:stencil', 'mark:1']);
    expect(marks.at(-1)).toBe(`mark:${2 * count - 255}`);
    // Every face is still drawn in each corrected pass, in face order.
    expect(commands().filter((command) => command.startsWith('test:'))).toHaveLength(2 * count);
  });

  it('draws again the same way, starting from a clear', () => {
    const program = createSpreadProgram(recordingRegl());
    program.setData(geometry([0.25, 0.75], CYCLIC), BAND);
    program.draw(DRAW);
    const first = commands();
    recorded.draws.length = 0;
    program.draw(DRAW);
    expect(commands()).toEqual(first);
  });

  it('keeps a banded figure’s fills and lines inside its band, faded by its opacity', () => {
    const program = createSpreadProgram(recordingRegl());
    program.setData(geometry([0, 1], ACYCLIC), { ...BAND, opacity: 0.45 });
    program.draw(DRAW);
    expect(commands()).toEqual(['fill:write:lequal', 'fill:keep:equal', 'ink:0']);
    const [prepass, colour] = fills();
    expect(prepass!.props).toMatchObject({ color: false, base: 0.5, span: 0.25 });
    expect(colour!.props).toMatchObject({ color: true, alpha: 0.45 });
    const bias = spreadInkDepthBias(2, DEPTH_BITS, 0.25);
    const [ink] = recorded.ink;
    for (let segment = 0; segment < ink!.count; segment++) {
      expect(ink!.depth![segment]).toBeGreaterThan(0.5);
      expect(ink!.depth![segment]).toBeLessThan(0.75);
      expect(ink!.color[segment * 4 + 3]).toBeCloseTo(0.45, 6);
    }
    expect(ink!.depth![0]).toBeCloseTo(0.5 + 0.25 * ((1 + 0.1) / 2) + bias, 6);
  });

  it('draws X-ray see-through: back to front at its alpha, writing no depth, lines after, depth last', () => {
    const program = createSpreadProgram(recordingRegl());
    program.setData(geometry([0.25, 0.75], ACYCLIC), { ...BAND, opacity: 0.5, xray: { faceAlpha: 0.4 } });
    program.draw(DRAW);
    expect(commands()).toEqual(['fill:keep:lequal', 'ink:0', 'fill:write:lequal']);
    const [see, depth] = fills();
    expect(see!.props).toMatchObject({ alpha: 0.4 * 0.5, color: true, first: 0, count: 6 });
    // Back to front: face 1 (rank 0) is drawn first, then face 0.
    expect(ranksOf(see!)).toEqual([0, 0, 0, 1, 1, 1]);
    expect(depth!.props).toMatchObject({ color: false });
    expect(ranksOf(depth!)).toEqual([1, 1, 1, 0, 0, 0]);
  });

  it('draws each face’s lines alone when their dashes need more slots than the program has', () => {
    const program = createSpreadProgram(recordingRegl());
    const picture = geometry([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7], {
      ranks: [0, 1, 2, 3, 4, 5, 6],
      cyclic: false,
      above: [[], [], [], [], [], [], []],
    });
    picture.faces.forEach((face, f) => {
      face.strokes = { ...face.strokes, dashPatterns: [[f + 1, 1]], dashSlot: Float32Array.of(1) };
    });
    program.setData(picture);
    program.draw(DRAW);
    expect(commands()).toEqual(['fill:write:lequal', 'ink:0', 'ink:1', 'ink:2', 'ink:3', 'ink:4', 'ink:5', 'ink:6']);
  });

  it('uploads nothing for the picture it holds, and only the lines for a new layout', () => {
    const program = createSpreadProgram(recordingRegl());
    const picture = geometry([0.25, 0.75], ACYCLIC);
    program.setData(picture, BAND);
    expect(recorded.ink).toHaveLength(1);
    program.setData(picture, { ...BAND });
    expect(recorded.ink).toHaveLength(1);
    expect(recorded.inkPrograms).toBe(1);
    program.setData(picture, { ...BAND, band: { base: 0.25, span: 0.25 } });
    expect(recorded.ink).toHaveLength(2);
    expect(recorded.inkPrograms).toBe(1);
    expect(recorded.ink[1]!.depth![0]).toBeLessThan(0.5);
  });
});

describe('mergedSpreadInk', () => {
  /** Lines with a dash table of their own and a slot per line. */
  function dashed(patterns: number[][] | undefined, slots: number[] | undefined, count: number): StrokeGeometry {
    return {
      a: new Float32Array(count * 2),
      b: new Float32Array(count * 2).fill(1),
      color: new Float32Array(count * 4).fill(1),
      widthMul: new Float32Array(count).fill(1),
      count,
      depth: Float32Array.from({ length: count }, (_, k) => k / 10),
      ...(patterns ? { dashPatterns: patterns } : {}),
      ...(slots ? { dashSlot: Float32Array.from(slots), dashPhase: Float32Array.from(slots, (_, k) => k + 1) } : {}),
    };
  }
  const valley = [4, 2];
  const mountain = [6, 2, 1, 2];

  it('joins the faces’ dash tables and renumbers each face’s slots into the join', () => {
    const merged = mergedSpreadInk([
      dashed([valley], [0, 1], 2),
      dashed([mountain, valley], [1, 2, 0], 3),
      dashed(undefined, undefined, 1),
    ]);
    expect(merged!.dashPatterns).toEqual([valley, mountain]);
    expect(Array.from(merged!.dashSlot!)).toEqual([0, 1, 2, 1, 0, 0]);
    expect(Array.from(merged!.dashPhase!)).toEqual([1, 2, 1, 2, 3, 0]);
    expect(merged!.count).toBe(6);
    // A line's end depth is its start's where it has none of its own.
    expect(Array.from(merged!.depthEnd!)).toEqual(Array.from(merged!.depth!));
  });

  it('dashes a face with a table and no slots by its first pattern, as the stroke program does', () => {
    const merged = mergedSpreadInk([dashed([valley], [1], 1), dashed([mountain], undefined, 2)]);
    expect(merged!.dashPatterns).toEqual([valley, mountain]);
    expect(Array.from(merged!.dashSlot!)).toEqual([1, 2, 2]);
  });

  it('leaves solid lines without a table', () => {
    const merged = mergedSpreadInk([dashed(undefined, undefined, 2), dashed(undefined, undefined, 1)]);
    expect(merged).not.toHaveProperty('dashPatterns');
    expect(merged!.count).toBe(3);
  });

  it('is null when the join needs more slots than the stroke program has', () => {
    expect(mergedSpreadInk(Array.from({ length: 7 }, (_, k) => dashed([[k + 1, 1]], [1], 1)))).toBeNull();
    expect(mergedSpreadInk(Array.from({ length: 6 }, (_, k) => dashed([[k + 1, 1]], [1], 1)))).not.toBeNull();
  });
});
