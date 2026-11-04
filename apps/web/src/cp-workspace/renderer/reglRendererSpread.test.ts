// @vitest-environment jsdom
/**
 * The canvas renderer's spread pass with many figures: a program per picture,
 * kept by key and fed only when its picture or layout changes, drawn far to
 * near through each figure's own placement, before the folded fills.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CpRenderFrame } from './CpRenderer';
import type { FoldedGeometry, FoldedSpreadLayer, ViewTransform } from './types';

const spread = vi.hoisted(() => ({
  programs: [] as Array<{ id: number; uploads: unknown[]; draws: ViewTransform[]; disposed: boolean }>,
  log: [] as string[],
}));
vi.mock('./programs/spreadProgram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./programs/spreadProgram')>()),
  createSpreadProgram: () => {
    const program = { id: spread.programs.length, uploads: [] as unknown[], draws: [] as ViewTransform[], disposed: false };
    spread.programs.push(program);
    let held: unknown = null;
    let layout: unknown = null;
    return {
      setData: (geometry: unknown, next: unknown) => {
        // The real program's own rule: the picture it holds, at the layout it holds, uploads nothing.
        if (geometry === held && JSON.stringify(next) === JSON.stringify(layout)) return;
        held = geometry;
        layout = next;
        program.uploads.push(geometry);
      },
      draw: ({ view }: { view: ViewTransform }) => {
        program.draws.push(view);
        spread.log.push(`spread:${program.id}`);
      },
      seesThrough: () => Boolean((layout as { xray?: unknown } | null)?.xray),
      dispose: () => {
        program.disposed = true;
      },
    };
  },
}));
vi.mock('regl', () => ({
  default: () => ({
    poll: () => {},
    clear: () => {},
    destroy: () => {},
    buffer: () => ({ destroy: () => {} }),
    texture: () => ({ destroy: () => {} }),
    on: () => ({ cancel: () => {} }),
  }),
}));
const program = (name: string) => () => ({
  setData: () => {},
  draw: () => spread.log.push(name),
  dispose: () => {},
});
vi.mock('./programs/strokeProgram', () => ({ createStrokeProgram: program('strokes') }));
vi.mock('./programs/pointProgram', () => ({ createPointProgram: program('points') }));
vi.mock('./programs/fillProgram', () => ({ createFillProgram: program('fills') }));
vi.mock('./programs/shadowProgram', () => ({ createShadowProgram: program('shadows') }));
vi.mock('./programs/markerProgram', () => ({ createMarkerProgram: program('markers') }));
vi.mock('./programs/wedgeProgram', () => ({ createWedgeProgram: program('wedges') }));
vi.mock('./programs/imageProgram', () => ({ createImageProgram: program('images') }));
vi.mock('./programs/regionProgram', () => ({ createRegionProgram: program('regions') }));

const { createReglRenderer } = await import('./reglRenderer');

const VIEW: ViewTransform = { origin: [100, 50], ex: [2, 0], ey: [0, 2] };
const FRAME: CpRenderFrame = {
  clearColor: [0, 0, 0, 1],
  view: VIEW,
  userView: VIEW,
  strokeWidthPx: 1,
  userScalePx: 1,
  markerScalePx: 1,
  pointScalePx: 1,
  constantOutlinePx: 1,
  markerOutlinePx: 1,
  pointOutlinePx: 1,
  pointOpacity: 1,
};
const EMPTY = {
  fills: { position: new Float32Array(), color: new Float32Array(), count: 0 },
  strokes: { a: new Float32Array(), b: new Float32Array(), color: new Float32Array(), widthMul: new Float32Array(), count: 0 },
};
const picture = () => ({ faces: [], visibility: { ranks: [], cyclic: false, above: [] } });
const folded = (spreads: FoldedSpreadLayer[]): FoldedGeometry => ({ ...EMPTY, spreads });

function renderer() {
  const canvas = document.createElement('canvas');
  const made = createReglRenderer(canvas);
  made.resize({ width: 200, height: 100, dpr: 1 });
  return made;
}

beforeEach(() => {
  spread.programs.length = 0;
  spread.log.length = 0;
});

describe('the spread pass on the canvas', () => {
  it('keeps a program per figure, and uploads a picture once however often the channel is handed over', () => {
    const made = renderer();
    const a = picture();
    const b = picture();
    const band = { band: { base: 0, span: 0.5 }, opacity: 1, xray: null };
    const layers = (bOffset: number): FoldedSpreadLayer[] => [
      { key: 'a', geometry: a, layout: band },
      { key: 'b', geometry: b, layout: { ...band, band: { base: 0.5, span: 0.5 } }, transform: { scale: 1, x: bOffset, y: 0 } },
    ];
    // A drag of figure b: every frame hands both figures over again.
    for (let frame = 0; frame < 5; frame += 1) made.setFolded(folded(layers(frame)));
    expect(spread.programs).toHaveLength(2);
    expect(spread.programs.map((p) => p.uploads.length)).toEqual([1, 1]);
  });

  it('draws far to near before the folded fills, each through its own placement', () => {
    const made = renderer();
    made.setFolded(
      folded([
        { key: 'a', geometry: picture() },
        { key: 'b', geometry: picture(), transform: { scale: 3, x: 10, y: -4 } },
      ])
    );
    spread.log.length = 0;
    made.render(FRAME);
    const at = spread.log.indexOf('spread:0');
    expect(spread.log.slice(at, at + 3)).toEqual(['spread:0', 'spread:1', 'fills']);
    expect(spread.programs[0]!.draws[0]).toEqual(VIEW);
    expect(spread.programs[1]!.draws[0]).toEqual({ origin: [100 + 10 * 2, 50 - 4 * 2], ex: [6, 0], ey: [0, 6] });
  });

  it('draws a see-through picture after the other figures’ paper, so it blends over what it covers', () => {
    const made = renderer();
    const xray = { band: { base: 0.5, span: 0.5 }, opacity: 1, xray: { faceAlpha: 0.3 } };
    made.setFolded(
      folded([
        { key: 'x', geometry: picture(), layout: xray },
        { key: 'a', geometry: picture() },
      ])
    );
    spread.log.length = 0;
    made.render(FRAME);
    const folds = spread.log.filter((entry) => entry.startsWith('spread') || ['fills', 'shadows', 'strokes'].includes(entry));
    const paper = folds.lastIndexOf('fills');
    expect(folds.indexOf('spread:1')).toBeLessThan(paper);
    expect(folds.indexOf('spread:0')).toBeGreaterThan(folds.lastIndexOf('strokes'));
  });

  it('lets a figure that stopped spreading go', () => {
    const made = renderer();
    made.setFolded(folded([{ key: 'a', geometry: picture() }, { key: 'b', geometry: picture() }]));
    made.setFolded(folded([{ key: 'b', geometry: picture() }]));
    expect(spread.programs.map((p) => p.disposed)).toEqual([true, false]);
    made.setFolded(EMPTY);
    expect(spread.programs.map((p) => p.disposed)).toEqual([true, true]);
    spread.log.length = 0;
    made.render(FRAME);
    expect(spread.log.some((entry) => entry.startsWith('spread'))).toBe(false);
  });
});
