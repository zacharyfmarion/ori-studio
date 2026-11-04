// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDocument } from '../../engine/types';
import { DEFAULT_CREASE_EXPORT_OPTIONS, type CreaseExportOptions } from '../../lib/creaseExport';
import type { ImportedCreasePatternDocument } from '../../lib/creasePatternImport';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_EXPORT_STYLE_SLOT } from '../../lib/paperExportSettings';
import { readJson, STORAGE_KEYS, storageKey } from '../../lib/storage';
import type { FileService } from '../../platform/fileService';
import { useSettingsStore } from '../settingsStore';
import { useWorkspaceStore } from './store';

const runtime = vi.hoisted(() => ({ track: vi.fn() }));
const share = vi.hoisted(() => ({ createCpShare: vi.fn() }));
const sheets = vi.hoisted(() => ({ ensureCpSheetArtifacts: vi.fn() }));
const dialogs = vi.hoisted(() => ({ requestCreasePatternExportOptions: vi.fn() }));

vi.mock('../../analytics/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../analytics/runtime')>();
  return { ...actual, track: runtime.track };
});

// The painters are not under test, and a PNG needs a canvas jsdom does not have.
vi.mock('../../lib/creaseExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/creaseExport')>();
  return {
    ...actual,
    serializeCreasePatternSvg: vi.fn(() => '<svg/>'),
    renderCreasePatternPng: vi.fn(async () => new Uint8Array([1, 2, 3])),
  };
});

vi.mock('../../cp-workspace/share/cpShareService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cp-workspace/share/cpShareService')>();
  return { ...actual, createCpShare: share.createCpShare };
});

vi.mock('../../cp-workspace/sheets/cpSheetArtifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cp-workspace/sheets/cpSheetArtifacts')>();
  return { ...actual, ensureCpSheetArtifacts: sheets.ensureCpSheetArtifacts };
});

vi.mock('../commandDialogStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../commandDialogStore')>();
  return { ...actual, requestCreasePatternExportOptions: dialogs.requestCreasePatternExportOptions };
});

const FOLD = {
  vertices_coords: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  edges_vertices: [
    [0, 1],
    [1, 2],
    [2, 0],
  ],
  edges_assignment: ['B', 'B', 'B'],
  edges_foldAngle: [0, 0, 0],
  faces_vertices: [[0, 1, 2]],
} as unknown as FoldDocument;

const FOLDED_FIGURE_KEY = storageKey(STORAGE_KEYS.creasePatternFoldedFigure);
const WITH_DIAGRAM_FIGURE: CreaseExportOptions = {
  ...DEFAULT_CREASE_EXPORT_OPTIONS,
  includeFoldedFigure: true,
  foldedFigureStyle: 'builtin:diagram',
};

const initialWorkspaceState = useWorkspaceStore.getInitialState();
const initialSettingsState = useSettingsStore.getInitialState();

function fileService(saved: boolean) {
  return {
    saveTextFile: vi.fn(async () => (saved ? { name: 'pattern.svg', path: null } : null)),
    saveBinaryFile: vi.fn(async () => (saved ? { name: 'pattern.png', path: null } : null)),
  } as unknown as FileService;
}

function tracked(event: string): unknown[] {
  return runtime.track.mock.calls.filter(([name]) => name === event).map(([, properties]) => properties);
}

beforeEach(() => {
  localStorage.clear();
  runtime.track.mockClear();
  useSettingsStore.setState(initialSettingsState, true);
  useWorkspaceStore.setState({
    status: 'ready',
    importedCreasePattern: { fold: FOLD } as unknown as ImportedCreasePatternDocument,
    foldArtifacts: { fold: FOLD },
  });
});

afterEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialWorkspaceState, true);
});

describe('saving a crease pattern as an image', () => {
  it('remembers the folded figure’s style and reports it by kind, for an SVG', async () => {
    await expect(useWorkspaceStore.getState().exportSvg(fileService(true), WITH_DIAGRAM_FIGURE)).resolves.toBe(
      true
    );
    expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe('builtin:diagram');
    expect(readJson(FOLDED_FIGURE_KEY, null)).toEqual({ style: 'builtin:diagram' });
    // The figure beside a pattern is remembered apart from the paper exports' options (X12).
    expect(localStorage.getItem(storageKey(STORAGE_KEYS.paperExport))).toBeNull();
    expect(tracked('crease pattern exported')).toEqual([{ format: 'svg', folded_figure: 'diagram', folded_figure_layer_order: 'default', folded_figure_spread: 'none' }]);
  });

  it('does the same for a PNG', async () => {
    await expect(useWorkspaceStore.getState().exportPng(fileService(true), WITH_DIAGRAM_FIGURE)).resolves.toBe(
      true
    );
    expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe('builtin:diagram');
    expect(tracked('crease pattern exported')).toEqual([{ format: 'png', folded_figure: 'diagram', folded_figure_layer_order: 'default', folded_figure_spread: 'none' }]);
  });

  it('names a saved preset custom, from the presets Settings holds', async () => {
    useSettingsStore.setState({
      paperStyle: {
        ...initialSettingsState.paperStyle,
        presets: [{ version: 1, name: 'Mine', style: DEFAULT_PAPER_STYLE }],
      },
    });
    await useWorkspaceStore
      .getState()
      .exportSvg(fileService(true), { ...WITH_DIAGRAM_FIGURE, foldedFigureStyle: 'user:Mine' });
    expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe('user:Mine');
    expect(tracked('crease pattern exported')).toEqual([{ format: 'svg', folded_figure: 'custom', folded_figure_layer_order: 'default', folded_figure_spread: 'none' }]);
  });

  it('reports no figure as none, and leaves the remembered style alone', async () => {
    useSettingsStore.getState().rememberCreasePatternFoldedFigure({ style: 'builtin:default', spread: null });
    const withoutFigure = { ...WITH_DIAGRAM_FIGURE, includeFoldedFigure: false };
    await expect(useWorkspaceStore.getState().exportSvg(fileService(true), withoutFigure)).resolves.toBe(true);
    expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe('builtin:default');
    expect(readJson(FOLDED_FIGURE_KEY, null)).toEqual({ style: 'builtin:default' });
    expect(tracked('crease pattern exported')).toEqual([{ format: 'svg', folded_figure: 'none', folded_figure_layer_order: 'default', folded_figure_spread: 'none' }]);
  });

  it('neither remembers nor reports a save the user dismissed', async () => {
    const dismissed = fileService(false);
    await expect(useWorkspaceStore.getState().exportSvg(dismissed, WITH_DIAGRAM_FIGURE)).resolves.toBe(false);
    await expect(useWorkspaceStore.getState().exportPng(dismissed, WITH_DIAGRAM_FIGURE)).resolves.toBe(false);
    expect(dismissed.saveTextFile).toHaveBeenCalledTimes(1);
    expect(dismissed.saveBinaryFile).toHaveBeenCalledTimes(1);
    expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe(PAPER_EXPORT_STYLE_SLOT);
    expect(localStorage.getItem(FOLDED_FIGURE_KEY)).toBeNull();
    expect(tracked('crease pattern exported')).toEqual([]);
  });
});

describe('saving one pattern of a crease pattern as an image', () => {
  beforeEach(() => {
    sheets.ensureCpSheetArtifacts.mockResolvedValue({ fold: FOLD });
    dialogs.requestCreasePatternExportOptions.mockResolvedValue({
      options: { ...WITH_DIAGRAM_FIGURE, segmentId: 0 },
      content: { foldedFigure: null, grid: null },
    });
  });

  it.each(['svg', 'png'] as const)(
    'remembers and reports the figure’s style for a %s, as the whole-pattern export does',
    async (format) => {
      await expect(
        useWorkspaceStore.getState().exportOristudioCpSheet(format, 0, fileService(true))
      ).resolves.toBe(true);
      expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe('builtin:diagram');
      expect(tracked('crease pattern exported')).toEqual([{ format, folded_figure: 'diagram', folded_figure_layer_order: 'default', folded_figure_spread: 'none' }]);
    }
  );

  it('says when the figure the dialog drew is in a layer order chosen for it', async () => {
    dialogs.requestCreasePatternExportOptions.mockResolvedValue({
      options: { ...WITH_DIAGRAM_FIGURE, segmentId: 0 },
      content: { foldedFigure: { schema_version: 1, fixture: null, pass: null, primitives: [] }, grid: null, foldedFigureLayerOrder: 'chosen' },
    });
    await useWorkspaceStore.getState().exportOristudioCpSheet('svg', 0, fileService(true));
    expect(tracked('crease pattern exported')).toEqual([
      { format: 'svg', folded_figure: 'diagram', folded_figure_layer_order: 'chosen', folded_figure_spread: 'none' },
    ]);
  });

  it('remembers the figure’s spread setting, and reports the spread the file has, and how it is written', async () => {
    const spread = { kind: 'connected', version: 1, amount: 0.5, reveal: [0.8, 0.6] } as const;
    const flat = { minX: 0, minY: 0, maxX: 1, maxY: 1 };
    dialogs.requestCreasePatternExportOptions.mockResolvedValue({
      options: {
        ...WITH_DIAGRAM_FIGURE,
        segmentId: 0,
        foldedFigure: { ...WITH_DIAGRAM_FIGURE.foldedFigure, spread: { ...spread, reveal: [0.8, 0.6] } },
      },
      content: {
        foldedFigure: { schema_version: 1, fixture: null, pass: null, primitives: [] },
        grid: null,
        foldedFigureSpread: {
          kind: 'raster',
          spread: 'connected',
          href: 'data:image/png;base64,iVBORw0KGgo=',
          frame: [0, 0, 1, 1],
          bounds: flat,
          scale: 1,
          flat,
        },
      },
    });
    await useWorkspaceStore.getState().exportOristudioCpSheet('svg', 0, fileService(true));
    expect(readJson(FOLDED_FIGURE_KEY, null)).toEqual({ style: 'builtin:diagram', spread });
    expect(useSettingsStore.getState().creasePatternFoldedFigureSpread).toEqual(spread);
    expect(tracked('crease pattern exported')).toEqual([
      {
        format: 'svg',
        folded_figure: 'diagram',
        folded_figure_layer_order: 'default',
        folded_figure_spread: 'connected',
        spread_render: 'raster',
      },
    ]);
  });

  it('reports no spread when the setting was on but nothing in the file is spread', async () => {
    dialogs.requestCreasePatternExportOptions.mockResolvedValue({
      options: {
        ...WITH_DIAGRAM_FIGURE,
        segmentId: 0,
        foldedFigure: { ...WITH_DIAGRAM_FIGURE.foldedFigure, spread: { kind: 'depth', amount: 0.05, toward: 'down' } },
      },
      content: { foldedFigure: { schema_version: 1, fixture: null, pass: null, primitives: [] }, grid: null },
    });
    await useWorkspaceStore.getState().exportOristudioCpSheet('svg', 0, fileService(true));
    expect(tracked('crease pattern exported')).toEqual([
      expect.objectContaining({ folded_figure_spread: 'none' }),
    ]);
    expect((tracked('crease pattern exported')[0] as Record<string, unknown>).spread_render).toBeUndefined();
  });

  it('reports the default order when no figure was drawn, whatever the dialog held', async () => {
    dialogs.requestCreasePatternExportOptions.mockResolvedValue({
      options: { ...WITH_DIAGRAM_FIGURE, segmentId: 0 },
      content: { foldedFigure: null, grid: null, foldedFigureLayerOrder: 'chosen' },
    });
    await useWorkspaceStore.getState().exportOristudioCpSheet('svg', 0, fileService(true));
    expect(tracked('crease pattern exported')).toEqual([
      { format: 'svg', folded_figure: 'diagram', folded_figure_layer_order: 'default', folded_figure_spread: 'none' },
    ]);
  });

  it.each(['svg', 'png'] as const)(
    'neither remembers nor reports a %s save the user dismissed',
    async (format) => {
      const dismissed = fileService(false);
      await expect(useWorkspaceStore.getState().exportOristudioCpSheet(format, 0, dismissed)).resolves.toBe(
        false
      );
      expect(localStorage.getItem(FOLDED_FIGURE_KEY)).toBeNull();
      expect(tracked('crease pattern exported')).toEqual([]);
    }
  );
});

describe('publishing a crease-pattern share', () => {
  beforeEach(() => {
    share.createCpShare.mockResolvedValue({
      id: 'a3bK9xmQ',
      url: 'https://ori.studio/s/a3bK9xmQ',
      thumbnailUploadToken: 'tok',
    });
    useWorkspaceStore.setState({
      oristudioCpShareDraft: { segmentId: 0, payload: 'T0NTMQEB', fold: FOLD, segments: [], grid: null, url: null },
    });
  });

  it('remembers the card’s folded-figure style and reports it by kind', async () => {
    await expect(
      useWorkspaceStore.getState().publishOristudioCpShare({
        title: 'Bird base',
        author: null,
        renderCard: async () => null,
        foldedFigureStyle: 'builtin:diagram',
      })
    ).resolves.toBe(true);
    expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe('builtin:diagram');
    expect(readJson(FOLDED_FIGURE_KEY, null)).toEqual({ style: 'builtin:diagram' });
    expect(tracked('crease pattern shared')).toEqual([
      expect.objectContaining({ had_title: true, folded_figure: 'diagram', folded_figure_layer_order: 'default' }),
    ]);
  });

  it('remembers the card’s spread with its style, and reports how the card’s figure is spread', async () => {
    const spread = { kind: 'depth', amount: 0.05, toward: 'down' } as const;
    await useWorkspaceStore.getState().publishOristudioCpShare({
      title: 'Bird base',
      author: null,
      renderCard: async () => null,
      foldedFigureStyle: 'builtin:diagram',
      foldedFigureSpread: spread,
      foldedFigureSpreadDrawn: { kind: 'depth', render: 'vector' },
    });
    expect(readJson(FOLDED_FIGURE_KEY, null)).toEqual({ style: 'builtin:diagram', spread });
    expect(tracked('crease pattern shared')).toEqual([
      expect.objectContaining({ folded_figure_spread: 'depth', spread_render: 'vector' }),
    ]);
  });

  it('says when the card’s figure is in a layer order chosen for it', async () => {
    await useWorkspaceStore.getState().publishOristudioCpShare({
      title: 'Bird base',
      author: null,
      renderCard: async () => null,
      foldedFigureStyle: 'builtin:diagram',
      foldedFigureLayerOrder: 'chosen',
    });
    expect(tracked('crease pattern shared')).toEqual([
      expect.objectContaining({ folded_figure: 'diagram', folded_figure_layer_order: 'chosen' }),
    ]);
  });

  it('reports a card without a figure as none, and remembers nothing', async () => {
    await useWorkspaceStore.getState().publishOristudioCpShare({
      title: 'Bird base',
      author: null,
      renderCard: async () => null,
      foldedFigureStyle: null,
    });
    expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe(PAPER_EXPORT_STYLE_SLOT);
    expect(localStorage.getItem(FOLDED_FIGURE_KEY)).toBeNull();
    expect(tracked('crease pattern shared')).toEqual([expect.objectContaining({ folded_figure: 'none' })]);
  });

  it('neither remembers nor reports a share that failed to publish', async () => {
    share.createCpShare.mockRejectedValue(new Error('offline'));
    await expect(
      useWorkspaceStore.getState().publishOristudioCpShare({
        title: 'Bird base',
        author: null,
        renderCard: async () => null,
        foldedFigureStyle: 'builtin:diagram',
      })
    ).resolves.toBe(false);
    expect(localStorage.getItem(FOLDED_FIGURE_KEY)).toBeNull();
    expect(tracked('crease pattern shared')).toEqual([]);
  });
});
