/**
 * `exportOristudioCpFoldedFigure` for a 3D figure: the window's scene through
 * the shared painter, on the export style and page, or the stored picture when
 * there is no kernel to build a scene from.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
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

const { useWorkspaceStore } = await import('./store');
const { useSettingsStore } = await import('../settingsStore');
const { DEFAULT_PAPER_STYLE } = await import('../../lib/paper/paperStyle');
const { DEFAULT_PAPER_EXPORT_SETTINGS } = await import('../../lib/paperExportSettings');
const { resetFolded3dRenderModels, setFolded3dRenderModel } =
  await import('../../cp-workspace/folded/folded3dRenderModels');
const { DEFAULT_FOLDED_3D_CAMERA, folded3dFrameRadius, projectFolded3dModel } =
  await import('../../cp-workspace/folded/foldedFigure3dProjection');
const { folded3dPaperStyle } = await import('../../cp-workspace/folded/folded3dStyle');
const { resetFoldedModelWriteQueueForTests } =
  await import('../../cp-workspace/folded/foldedModelWriteQueue');
const { IDENTITY_FOLDED_PLACEMENT } = await import('../../engine/oristudioCpTypes');
const { cpOverlayViewStore } = await import('../../cp-workspace/cpOverlayViewStore');
const { pageMarginPt } = await import('../../lib/paper/paperSvg');
const { paperPageOf } = await import('../../lib/paperExportSettings');

type Entry = import('../../engine/oristudioCpTypes').OristudioCpFoldedFigureEntry;
type Model = import('../../engine/oristudioCpTypes').OristudioCpFoldedFigureModel;
type RenderModel = import('../../engine/oristudioCpTypes').OristudioCpFolded3dRenderModel;
type FileService = import('../../platform/fileService').FileService;

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '../../cp-workspace/folded/__fixtures__');
const RENDER_MODEL: RenderModel = JSON.parse(
  readFileSync(join(FIXTURES, 'hinge_90.rendermodel.json'), 'utf8')
);
const HANDLE = 5;

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

const TOLERANCES = {
  angle_radians: 1e-7,
  distance_relative: 1e-6,
  flat_snap_degrees: 1e-6,
  overlap_area_relative: 1e-9,
};

/** A 3D figure as the fold leaves it: the projector's picture stored, the frame recorded. */
function spatial(overrides: Partial<Entry> = {}): Entry {
  const renderSnapshot = projectFolded3dModel(RENDER_MODEL, {
    camera: DEFAULT_FOLDED_3D_CAMERA,
    displayStyle: 'Paper5',
    style: folded3dPaperStyle(MODEL),
    tolerances: TOLERANCES,
  }).snapshot;
  return {
    id: 'spatial-1',
    title: 'Folded model 1',
    handle: HANDLE,
    sourceKind: 'generated-3d',
    sourceCpRevision: 1,
    startingFaceId: 1,
    displayStyle: 'Paper5',
    status: 'ready',
    snapshot: null,
    folded3d: { model: MODEL, diagnostics: { tolerances: TOLERANCES } } as unknown as NonNullable<
      Entry['folded3d']
    >,
    renderSnapshot,
    placement: IDENTITY_FOLDED_PLACEMENT,
    camera: DEFAULT_FOLDED_3D_CAMERA,
    frameRadius: folded3dFrameRadius(RENDER_MODEL),
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

beforeEach(() => {
  vi.clearAllMocks();
  resetFoldedModelWriteQueueForTests();
  resetFolded3dRenderModels();
  useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  setFolded3dRenderModel(HANDLE, RENDER_MODEL);
  useWorkspaceStore.setState({
    workspaceTitle: 'Crane',
    oristudioCpFoldedFigures: [spatial()],
    // The paper mirror answers a pinned colour with a kernel write; there is
    // no kernel here, and the export reads the style, not the model.
    updateOristudioCpFoldedFigureModel: vi.fn(async () => true) as never,
  });
});

/** The overlay view of a canvas at 100%: one CSS px per user unit, the box as with no canvas. */
const UNIT_VIEW = { origin: [0, 0], ex: [1, 0], ey: [0, 1] } as const;

afterEach(() => {
  resetFoldedModelWriteQueueForTests();
  resetFolded3dRenderModels();
  // The store takes no null; a unit view is the unmounted scale.
  cpOverlayViewStore.set({ model: UNIT_VIEW, user: UNIT_VIEW });
});

describe('exporting a 3D folded figure with a live kernel', () => {
  it('paints the scene with the export style and the export page', async () => {
    // A distinctive export style, set apart from display: the paper, the edge
    // pen and the light off so a fill is the paper colour exactly. The page
    // carries a background.
    useSettingsStore.setState({
      paperStyle: {
        ...useSettingsStore.getState().paperStyle,
        export: {
          ...DEFAULT_PAPER_STYLE,
          paper: { front: '#123456', back: '#654321' },
          edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#0000ff' },
          light: { ...DEFAULT_PAPER_STYLE.light, enabled: false },
        },
      },
      paperExport: { ...DEFAULT_PAPER_EXPORT_SETTINGS, background: '#abcdef' },
    });
    const files = fileServiceMock();

    const done = await useWorkspaceStore
      .getState()
      .exportOristudioCpFoldedFigure('svg', 'spatial-1', files);

    expect(done).toBe(true);
    expect(files.saveTextFile).toHaveBeenCalledTimes(1);
    const { contents, suggestedName } = files.saveTextFile.mock.calls[0]![0];
    expect(suggestedName).toMatch(/^Crane.*\.svg$/);
    // The painter's page, in points, not the projector's 1024 px document.
    expect(contents).toMatch(/<svg[^>]* width="[\d.]+pt"/);
    expect(contents).not.toContain('aria-label="Folded figure"');
    expect(contents).toContain('fill="#123456"');
    expect(contents).toContain('stroke="#0000ff"');
    expect(contents).toContain('fill="#abcdef"');
    expect(paperExported()).toEqual([{ surface: 'folded-3d', format: 'svg', hidden_faces: 'kept' }]);
    expect(useWorkspaceStore.getState().projectMessage).toBe(`Exported ${suggestedName}`);
  });

  it('lays the figure’s own pins over the export style', async () => {
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [
        spatial({
          appearance: {
            'paper.front': '#ff00ff',
            light: { ...DEFAULT_PAPER_STYLE.light, enabled: false },
          },
        }),
      ],
    });
    const files = fileServiceMock();

    await useWorkspaceStore.getState().exportOristudioCpFoldedFigure('svg', 'spatial-1', files);

    expect(files.saveTextFile.mock.calls[0]![0].contents).toContain('fill="#ff00ff"');
  });

  it('rasterises the PNG at the page’s density and says the hidden faces were dropped', async () => {
    useSettingsStore.setState({
      paperExport: { ...DEFAULT_PAPER_EXPORT_SETTINGS, pngDpi: 144, keepHiddenFaces: false },
    });
    const files = fileServiceMock();

    const done = await useWorkspaceStore
      .getState()
      .exportOristudioCpFoldedFigure('png', 'spatial-1', files);

    expect(done).toBe(true);
    expect(files.saveBinaryFile).toHaveBeenCalledTimes(1);
    expect(files.saveBinaryFile.mock.calls[0]![0].suggestedName).toMatch(/\.png$/);
    expect(svgToPng).toHaveBeenCalledTimes(1);
    const [svg, width, height] = svgToPng.mock.calls[0]!;
    // 144 dpi is 2 px per pt: the raster is exactly twice the page in points.
    const [, widthPt] = /width="([\d.]+)pt"/.exec(svg)!;
    const [, heightPt] = /height="([\d.]+)pt"/.exec(svg)!;
    expect(width).toBe(Math.round(Number(widthPt) * 2));
    expect(height).toBe(Math.round(Number(heightPt) * 2));
    expect(paperExported()).toEqual([
      { surface: 'folded-3d', format: 'png', hidden_faces: 'dropped' },
    ]);
  });

  it('sizes the page from the figure’s on-screen box at the mounted canvas', async () => {
    // D3: the default sheet size is the on-screen size, read from the live
    // user-space affine the canvas publishes. A canvas at 200% doubles the
    // box, so the artwork on the page is twice as wide; the margin stays.
    const files = fileServiceMock();
    const artworkWidthPt = async (): Promise<number> => {
      await useWorkspaceStore.getState().exportOristudioCpFoldedFigure('svg', 'spatial-1', files);
      const svg = files.saveTextFile.mock.calls.at(-1)![0].contents as string;
      const [, widthPt] = /width="([\d.]+)pt"/.exec(svg)!;
      // The default 5 mm padding is the margin whatever the pens, well past
      // any stroke's room.
      const page = paperPageOf(useSettingsStore.getState().paperExport);
      return Number(widthPt) - 2 * pageMarginPt(DEFAULT_PAPER_STYLE, page);
    };

    const atUnit = await artworkWidthPt();
    // Folded figures are drawn in user space; the model affine is set apart
    // so reading the wrong one shows.
    cpOverlayViewStore.set({
      model: { origin: [40, 40], ex: [3, 0], ey: [0, 3] },
      user: { origin: [40, 40], ex: [2, 0], ey: [0, 2] },
    });
    const atDouble = await artworkWidthPt();

    expect(atUnit).toBeGreaterThan(0);
    // To the precision the page writes its width at.
    expect(atDouble / atUnit).toBeCloseTo(2, 3);
  });

  it('reports nothing exported when the save dialog is dismissed', async () => {
    const files = fileServiceMock();
    files.saveTextFile.mockResolvedValueOnce(null);

    const done = await useWorkspaceStore
      .getState()
      .exportOristudioCpFoldedFigure('svg', 'spatial-1', files);

    expect(done).toBe(false);
    expect(paperExported()).toEqual([]);
  });
});

describe('exporting a 3D folded figure without a kernel', () => {
  it('serializes the stored picture, as the canvas draws it, and fires no paper event', async () => {
    // Reopened from a file: no handle, so no render model — the projector's
    // stored snapshot is the picture (R7, until Phase 7).
    useWorkspaceStore.setState({ oristudioCpFoldedFigures: [spatial({ handle: null })] });
    const files = fileServiceMock();

    const done = await useWorkspaceStore
      .getState()
      .exportOristudioCpFoldedFigure('svg', 'spatial-1', files);

    expect(done).toBe(true);
    const { contents } = files.saveTextFile.mock.calls[0]![0];
    expect(contents).toContain('aria-label="Folded figure"');
    expect(contents).not.toMatch(/width="[\d.]+pt"/);
    expect(paperExported()).toEqual([]);
  });

  it('takes the same path when the handle has no render model behind it', async () => {
    resetFolded3dRenderModels();
    const files = fileServiceMock();

    await useWorkspaceStore.getState().exportOristudioCpFoldedFigure('svg', 'spatial-1', files);

    expect(files.saveTextFile.mock.calls[0]![0].contents).toContain('aria-label="Folded figure"');
    expect(paperExported()).toEqual([]);
  });

  it('refuses a figure with no picture at all', async () => {
    useWorkspaceStore.setState({
      oristudioCpFoldedFigures: [spatial({ handle: null, renderSnapshot: null })],
    });
    const files = fileServiceMock();

    const done = await useWorkspaceStore
      .getState()
      .exportOristudioCpFoldedFigure('svg', 'spatial-1', files);

    expect(done).toBe(false);
    expect(files.saveTextFile).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().error?.code).toBe('invalid_operation');
  });
});
