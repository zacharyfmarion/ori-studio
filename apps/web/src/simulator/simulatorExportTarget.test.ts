import { describe, expect, it, vi } from 'vitest';
import type { PaperScene } from '../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES, surfacePaperStyle } from '../lib/paper/paperStyleResolve';
import type { PaperSceneInput } from '../paperExport/paperExportTarget';
import type { SimulatorExportSceneOptions } from './simulatorSession';
import { simulatorExportTarget, type SimulatorExportCapture } from './simulatorExportTarget';

const SCENE: PaperScene = {
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  sheet: 10,
  items: [
    { kind: 'face', face: 0, side: 'front', rings: [[[0, 0], [10, 0], [10, 10]]], shade: 1, hidden: false },
  ],
};

const EXPORT_STYLE: PaperStyle = { ...DEFAULT_PAPER_STYLE, paper: { front: '#123456', back: '#654321' } };

function snapshot() {
  return {
    scene: vi.fn(async (_options: SimulatorExportSceneOptions): Promise<PaperScene | null> => SCENE),
    release: vi.fn(),
  };
}

function targetOf(overrides: Partial<SimulatorExportCapture> = {}) {
  return simulatorExportTarget({
    snapshot: snapshot(),
    surface: 'simulator',
    title: 'Export view',
    fileStem: 'Crane',
    exportStyle: EXPORT_STYLE,
    pins: null,
    ...overrides,
  });
}

function input(overrides: Partial<PaperSceneInput> = {}): PaperSceneInput {
  return { page: 0, style: DEFAULT_PAPER_STYLE, markHidden: false, background: null, ...overrides };
}

/** The default style with one field of it changed. */
function restyled(change: (style: PaperStyle) => Partial<PaperStyle>): PaperStyle {
  return { ...DEFAULT_PAPER_STYLE, ...change(DEFAULT_PAPER_STYLE) };
}

describe('simulatorExportTarget', () => {
  it('is the view as captured: its surface, names and styles, one page that can bury faces', () => {
    const pins = { 'paper.back': '#abcdef' } as const;
    const target = targetOf({ surface: 'inline-simulation', pins });
    expect(target).toMatchObject({
      surface: 'inline-simulation',
      title: 'Export view',
      fileStem: 'Crane',
      exportStyle: EXPORT_STYLE,
      pins,
      buriesFaces: true,
      pages: null,
    });
    expect(target.fixedPicture ?? null).toBeNull();
    expect(target.hint ?? null).toBeNull();
  });

  it('rebuilds the scene for the light, the widest pen and the hidden test', () => {
    const target = targetOf();
    const key = target.sceneKey(input());
    const rebuilt = [
      input({ markHidden: true }),
      input({ style: restyled(({ light }) => ({ light: { ...light, enabled: false } })) }),
      input({ style: restyled(({ light }) => ({ light: { ...light, azimuth: light.azimuth + 30 } })) }),
      input({ style: restyled(({ light }) => ({ light: { ...light, elevation: light.elevation - 10 } })) }),
      input({ style: restyled(({ edges }) => ({ edges: { ...edges, width: 3 } })) }),
    ];
    for (const changed of rebuilt) expect(target.sceneKey(changed)).not.toBe(key);
  });

  it('only repaints for a colour, the background, or a pen the simulator does not draw', () => {
    const target = targetOf();
    const key = target.sceneKey(input());
    const repainted = [
      input({ background: '#000000' }),
      input({ style: restyled(() => ({ paper: { front: '#ff0000', back: '#00ff00' } })) }),
      input({ style: restyled(({ edges }) => ({ edges: { ...edges, color: '#ff0000' } })) }),
      // Wider than every pen the simulator draws, but only References draws arrows.
      input({ style: restyled(({ arrows }) => ({ arrows: { ...arrows, width: 5 } })) }),
    ];
    for (const changed of repainted) expect(target.sceneKey(changed)).toBe(key);
  });

  it('asks the frozen frame for the scene, with the style and the hidden test', async () => {
    const frozen = snapshot();
    const target = targetOf({ snapshot: frozen });
    const style = restyled(({ light }) => ({ light: { ...light, azimuth: 30 } }));
    await expect(target.buildScene(input({ style, markHidden: true }))).resolves.toBe(SCENE);
    expect(frozen.scene).toHaveBeenCalledWith({ style, markHidden: true });
  });

  it('answers null when the frozen frame has nothing to draw', async () => {
    const frozen = snapshot();
    frozen.scene.mockResolvedValueOnce(null);
    await expect(targetOf({ snapshot: frozen }).buildScene(input())).resolves.toBeNull();
  });

  it('paints with the simulator’s policy on either surface', () => {
    const style: PaperStyle = {
      ...DEFAULT_PAPER_STYLE,
      foldsAsEdges: false,
      arrows: { ...DEFAULT_PAPER_STYLE.arrows, color: '#ff0000' },
      light: { ...DEFAULT_PAPER_STYLE.light, azimuth: 30 },
    };
    const simulator = surfacePaperStyle(style, PAPER_STYLE_POLICIES.simulator);
    expect(simulator.arrows).toEqual(DEFAULT_PAPER_STYLE.arrows);
    expect(targetOf().paintStyle(style)).toEqual(simulator);
    expect(targetOf({ surface: 'inline-simulation' }).paintStyle(style)).toEqual(simulator);
    expect(simulator).toEqual(surfacePaperStyle(style, PAPER_STYLE_POLICIES['inline-simulation']));
  });

  it('lets go of the frozen frame when the dialog does', () => {
    const frozen = snapshot();
    const target = targetOf({ snapshot: frozen });
    expect(target.release).toBe(frozen.release);
    target.release();
    expect(frozen.release).toHaveBeenCalledTimes(1);
  });
});
