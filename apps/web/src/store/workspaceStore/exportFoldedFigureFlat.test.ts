/**
 * `exportOristudioCpFoldedFigure` for a flat figure: the kernel's paper scene
 * through the shared painter, on the export style and page, at the figure's
 * on-screen size — or the stored picture when there is no kernel to read a
 * scene from.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../analytics')>();
  return { ...actual, track: analytics.track };
});

// The rasteriser needs a browser; the page it is handed is what is under test.
const { svgToPng } = vi.hoisted(() => ({
  svgToPng: vi.fn(async (_svg: string, _width: number, _height: number) => new Uint8Array(3)),
}));
vi.mock('../../lib/svgToPng', () => ({ svgToPng }));

// The kernel lives in a worker; the scene it would answer with is hand-built
// in its own shape, and which handle it was asked for is part of the test.
const kernel = vi.hoisted(() => ({
  paperScene: vi.fn(async (_handle: number): Promise<unknown> => null),
}));
vi.mock('./oristudioCpRuntime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./oristudioCpRuntime')>();
  return { ...actual, getOristudioCpFoldedFigurePaperScene: kernel.paperScene };
});

const { useWorkspaceStore } = await import('./store');
const { useSettingsStore } = await import('../settingsStore');
const { DEFAULT_PAPER_STYLE } = await import('../../lib/paper/paperStyle');
const { DEFAULT_PAPER_EXPORT_SETTINGS } = await import('../../lib/paperExportSettings');
const { resetFoldedModelWriteQueueForTests } =
  await import('../../cp-workspace/folded/foldedModelWriteQueue');
const { IDENTITY_FOLDED_PLACEMENT } = await import('../../engine/oristudioCpTypes');
const { cpOverlayViewStore } = await import('../../cp-workspace/cpOverlayViewStore');
const { pageMarginPt } = await import('../../lib/paper/paperSvg');
const { paperPageOf } = await import('../../lib/paperExportSettings');
const { foldedFlatFigureScenePxPerUnit } =
  await import('../../cp-workspace/folded/foldedFlatFigureExport');

type Entry = import('../../engine/oristudioCpTypes').OristudioCpFoldedFigureEntry;
type Model = import('../../engine/oristudioCpTypes').OristudioCpFoldedFigureModel;
type Scene = import('../../engine/oristudioCpTypes').OristudioCpFoldedPaperScene;
type Snapshot = import('../../engine/oristudioCpTypes').OristudioCpFoldedRenderSnapshot;
type FileService = import('../../platform/fileService').FileService;

const HANDLE = 9;

/** Colours that already mirror the default style, so the paper mirror has nothing to write. */
const MODEL: Model = {
  front_color: { red: 255, green: 255, blue: 50 },
  back_color: { red: 233, green: 233, blue: 233 },
  line_color: { red: 0, green: 0, blue: 0 },
  scale: 1,
  rotation: 0,
  anti_alias: true,
  display_shadows: false,
  state: 'Front0',
  folded_cases: 1,
  transparent_transparency: 16,
  transparency_color: false,
};

/**
 * A sheet folded in half: face 0 (the left half, turned over) lies on face 1.
 * Both land on the same 200-unit square, so the whole picture is one subface
 * whose stack is `[0, 1]`; face 1 is buried.
 */
function kernelScene(): Scene {
  const square = [
    { x: 0, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 200 },
    { x: 0, y: 200 },
  ];
  const edges = (kinds: Array<'border' | 'fold'>) =>
    square.map((from, index) => ({
      from,
      to: square[(index + 1) % 4]!,
      kind: kinds[index]!,
    }));
  return {
    schema_version: 1,
    flipped: false,
    sheet: 400,
    faces: [
      { outline: square, front_up: false, edges: edges(['border', 'fold', 'border', 'border']) },
      { outline: square, front_up: true, edges: edges(['border', 'fold', 'border', 'border']) },
    ],
    subfaces: [{ polygon: square, faces_top_to_bottom: [0, 1] }],
    aux_lines: [],
  };
}

/** The drawer's picture of the same fold, as the canvas keeps it. */
function renderSnapshot(): Snapshot {
  return {
    schema_version: 1,
    fixture: null,
    pass: null,
    primitives: [
      {
        sequence: 0,
        kind: 'fill_polygon',
        style: {
          paint: { kind: 'color', color: { red: 233, green: 233, blue: 233, alpha: 255 } },
          stroke: { kind: 'none' },
          antialias: 'default',
        },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 200, y: 0 },
            { x: 200, y: 200 },
            { x: 0, y: 200 },
          ],
        },
      },
    ],
  };
}

/** A flat figure as the fold leaves it: a live handle, the drawer's picture stored. */
function flat(overrides: Partial<Entry> = {}): Entry {
  return {
    id: 'flat-1',
    title: 'Folded model 1',
    handle: HANDLE,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: {
      model: MODEL,
      display_style: 'Paper5',
      discovered_fold_cases: 1,
      outcome: 'Solved',
    } as unknown as NonNullable<Entry['snapshot']>,
    folded3d: null,
    renderSnapshot: renderSnapshot(),
    placement: IDENTITY_FOLDED_PLACEMENT,
    camera: null,
    frameRadius: null,
    error: null,
    ...overrides,
  };
}

function fileServiceMock(): FileService & {
  saveTextFile: ReturnType<typeof vi.fn>;
  saveBinaryFile: ReturnType<typeof vi.fn>;
} {
  return {
    saveTextFile: vi.fn(async (options: { suggestedName: string }) => ({
      name: options.suggestedName,
      path: null,
    })),
    saveBinaryFile: vi.fn(async (options: { suggestedName: string }) => ({
      name: options.suggestedName,
      path: null,
    })),
  } as unknown as FileService & {
    saveTextFile: ReturnType<typeof vi.fn>;
    saveBinaryFile: ReturnType<typeof vi.fn>;
  };
}

const paperExported = () =>
  analytics.track.mock.calls
    .filter(([name]) => name === 'paper exported')
    .map(([, properties]) => properties);

/** Every `<polygon>` in the page, as its attribute map. */
function polygons(svg: string): Record<string, string>[] {
  const found: Record<string, string>[] = [];
  for (const match of svg.matchAll(/<polygon\s([^>]*)\/>/g)) {
    const attrs: Record<string, string> = {};
    for (const attr of match[1]!.matchAll(/([\w-]+)="([^"]*)"/g)) attrs[attr[1]!] = attr[2]!;
    found.push(attrs);
  }
  return found;
}

const exportSvg = async (files = fileServiceMock()) => {
  const done = await useWorkspaceStore.getState().exportOristudioCpFoldedFigure('svg', 'flat-1', files);
  const call = files.saveTextFile.mock.calls.at(-1)?.[0] as
    | { contents: string; suggestedName: string }
    | undefined;
  return { done, files, svg: call?.contents ?? null, name: call?.suggestedName ?? null };
};

/** The overlay view of a canvas at 100%: one CSS px per user unit, the box as with no canvas. */
const UNIT_VIEW = { origin: [0, 0], ex: [1, 0], ey: [0, 1] } as const;

beforeEach(() => {
  vi.clearAllMocks();
  kernel.paperScene.mockImplementation(async () => kernelScene());
  resetFoldedModelWriteQueueForTests();
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useWorkspaceStore.setState({
    workspaceTitle: 'Crane',
    oristudioCpFoldedFigures: [flat()],
    // The paper mirror answers a pinned colour with a kernel write; there is
    // no kernel here, and the export reads the style, not the model.
    updateOristudioCpFoldedFigureModel: vi.fn(async () => true) as never,
  });
});

afterEach(() => {
  resetFoldedModelWriteQueueForTests();
  // The store takes no null; a unit view is the unmounted scale.
  cpOverlayViewStore.set({ model: UNIT_VIEW, user: UNIT_VIEW });
});

describe('exporting a flat folded figure with a live kernel', () => {
  it('paints the kernel’s scene for the figure’s handle with the export style and page', async () => {
    useSettingsStore.setState({
      paperStyle: {
        ...useSettingsStore.getState().paperStyle,
        export: {
          ...DEFAULT_PAPER_STYLE,
          paper: { front: '#123456', back: '#654321' },
          edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#0000ff' },
        },
      },
      paperExport: { ...DEFAULT_PAPER_EXPORT_SETTINGS, background: '#abcdef' },
    });

    const { done, files, svg, name } = await exportSvg();

    expect(done).toBe(true);
    expect(kernel.paperScene).toHaveBeenCalledWith(HANDLE);
    expect(files.saveTextFile).toHaveBeenCalledTimes(1);
    expect(name).toMatch(/^Crane.*\.svg$/);
    // The painter's page in points, not the snapshot's 1024 px document.
    expect(svg).toMatch(/<svg[^>]* width="[\d.]+pt"/);
    expect(svg).not.toContain('aria-label="Folded figure"');
    // Every layer, back to front: the buried face 1 (front up) under face 0
    // (turned over, so the back of the paper).
    expect(polygons(svg!).map((polygon) => polygon.fill)).toEqual(['#123456', '#654321']);
    expect(svg).toContain('stroke="#0000ff"');
    expect(svg).toContain('fill="#abcdef"');
    expect(paperExported()).toEqual([
      { surface: 'folded-flat', format: 'svg', hidden_faces: 'kept' },
    ]);
    expect(useWorkspaceStore.getState().projectMessage).toBe(`Exported ${name}`);
  });

  it('lays the figure’s own pins over the export style', async () => {
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [flat({ appearance: { 'paper.back': '#ff00ff' } })],
    });

    const { svg } = await exportSvg();

    expect(svg).toContain('fill="#ff00ff"');
  });

  it('drops the buried layer when the page says so, and says it did', async () => {
    useSettingsStore.setState({
      paperExport: { ...DEFAULT_PAPER_EXPORT_SETTINGS, pngDpi: 144, keepHiddenFaces: false },
    });
    const files = fileServiceMock();

    const done = await useWorkspaceStore
      .getState()
      .exportOristudioCpFoldedFigure('png', 'flat-1', files);

    expect(done).toBe(true);
    expect(files.saveBinaryFile.mock.calls[0]![0].suggestedName).toMatch(/\.png$/);
    const [svg, width, height] = svgToPng.mock.calls[0]!;
    expect(polygons(svg)).toHaveLength(1);
    // 144 dpi is 2 px per pt: the raster is exactly twice the page in points.
    const [, widthPt] = /width="([\d.]+)pt"/.exec(svg)!;
    const [, heightPt] = /height="([\d.]+)pt"/.exec(svg)!;
    expect(width).toBe(Math.round(Number(widthPt) * 2));
    expect(height).toBe(Math.round(Number(heightPt) * 2));
    expect(paperExported()).toEqual([
      { surface: 'folded-flat', format: 'png', hidden_faces: 'dropped' },
    ]);
  });

  it('sizes the page from the figure’s on-screen size: its placement at the mounted canvas', async () => {
    // D3: the default sheet size is the on-screen size — the kernel's units
    // through the paper affine, the placement's scale and the live user-space
    // affine the canvas publishes. Doubling the canvas doubles the artwork, as
    // does doubling the placement; the margin stays.
    const page = paperPageOf(useSettingsStore.getState().paperExport);
    const artworkWidthPt = async (): Promise<number> => {
      const { svg } = await exportSvg();
      const [, widthPt] = /width="([\d.]+)pt"/.exec(svg!)!;
      return Number(widthPt) - 2 * pageMarginPt(DEFAULT_PAPER_STYLE, page);
    };

    const atUnit = await artworkWidthPt();
    expect(atUnit).toBeCloseTo(200 * foldedFlatFigureScenePxPerUnit(flat()) * 0.75, 1);

    cpOverlayViewStore.set({
      model: { origin: [40, 40], ex: [3, 0], ey: [0, 3] },
      user: { origin: [40, 40], ex: [2, 0], ey: [0, 2] },
    });
    expect((await artworkWidthPt()) / atUnit).toBeCloseTo(2, 3);

    cpOverlayViewStore.set({ model: UNIT_VIEW, user: UNIT_VIEW });
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [
        flat({ placement: { ...IDENTITY_FOLDED_PLACEMENT, scale: 3, rotation: 1 } }),
      ],
    });
    expect((await artworkWidthPt()) / atUnit).toBeCloseTo(3, 3);
  });

  it('reports nothing exported when the save dialog is dismissed', async () => {
    const files = fileServiceMock();
    files.saveTextFile.mockResolvedValueOnce(null);

    const { done } = await exportSvg(files);

    expect(done).toBe(false);
    expect(paperExported()).toEqual([]);
  });
});

describe('exporting a flat folded figure the scene has no picture for', () => {
  it('serializes the stored picture when there is no handle, and fires no paper event', async () => {
    // Reopened from a file: no handle, so nothing to read a scene from.
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [flat({ handle: null })] });

    const { done, svg } = await exportSvg();

    expect(done).toBe(true);
    expect(kernel.paperScene).not.toHaveBeenCalled();
    expect(svg).toContain('aria-label="Folded figure"');
    expect(svg).not.toMatch(/width="[\d.]+pt"/);
    expect(paperExported()).toEqual([]);
  });

  it('takes the same path when the kernel has no paper picture for the handle', async () => {
    kernel.paperScene.mockResolvedValueOnce(null);

    const { svg } = await exportSvg();

    expect(kernel.paperScene).toHaveBeenCalledWith(HANDLE);
    expect(svg).toContain('aria-label="Folded figure"');
    expect(paperExported()).toEqual([]);
  });

  it('and for a wireframe, whose picture is not the paper scene', async () => {
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [flat({ displayStyle: 'Wire2' })] });

    const { svg } = await exportSvg();

    expect(kernel.paperScene).not.toHaveBeenCalled();
    expect(svg).toContain('aria-label="Folded figure"');
  });

  it('and for a fold with no layer ordering, without asking the kernel', async () => {
    // A contradiction (or a search with no solutions) lands the figure at
    // `Transparent3` with the drawer's development stored; there is no `Paper5`
    // picture to read, and asking would repeat the failed search or re-raise
    // the contradiction — an error where the stored picture exports fine.
    const entry = flat();
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [
        flat({
          displayStyle: 'Transparent3',
          snapshot: {
            ...entry.snapshot!,
            display_style: 'Transparent3',
            outcome: 'Contradiction',
            contradiction: { upper_face: 1, lower_face: 3 },
          },
        }),
      ],
    });
    kernel.paperScene.mockRejectedValueOnce(new Error('fold_contradiction'));

    const { done, svg } = await exportSvg();

    expect(done).toBe(true);
    expect(kernel.paperScene).not.toHaveBeenCalled();
    expect(svg).toContain('aria-label="Folded figure"');
    expect(useWorkspaceStore.getState().status).not.toBe('error');
    expect(paperExported()).toEqual([]);
  });

  it('refuses a figure with no picture at all', async () => {
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [flat({ handle: null, renderSnapshot: null })],
    });
    const files = fileServiceMock();

    const { done } = await exportSvg(files);

    expect(done).toBe(false);
    expect(files.saveTextFile).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().error?.code).toBe('invalid_operation');
  });
});
