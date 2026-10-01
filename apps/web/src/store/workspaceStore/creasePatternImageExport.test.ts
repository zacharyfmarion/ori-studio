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
const segmentation = vi.hoisted(() => ({ ensureCpSegmentationArtifacts: vi.fn() }));
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

vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>();
  return { ...actual, ensureCpSegmentationArtifacts: segmentation.ensureCpSegmentationArtifacts };
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
    expect(tracked('crease pattern exported')).toEqual([{ format: 'svg', folded_figure: 'diagram' }]);
  });

  it('does the same for a PNG', async () => {
    await expect(useWorkspaceStore.getState().exportPng(fileService(true), WITH_DIAGRAM_FIGURE)).resolves.toBe(
      true
    );
    expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe('builtin:diagram');
    expect(tracked('crease pattern exported')).toEqual([{ format: 'png', folded_figure: 'diagram' }]);
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
    expect(tracked('crease pattern exported')).toEqual([{ format: 'svg', folded_figure: 'custom' }]);
  });

  it('reports no figure as none, and leaves the remembered style alone', async () => {
    useSettingsStore.getState().rememberCreasePatternFoldedFigureStyle('builtin:default');
    const withoutFigure = { ...WITH_DIAGRAM_FIGURE, includeFoldedFigure: false };
    await expect(useWorkspaceStore.getState().exportSvg(fileService(true), withoutFigure)).resolves.toBe(true);
    expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe('builtin:default');
    expect(readJson(FOLDED_FIGURE_KEY, null)).toEqual({ style: 'builtin:default' });
    expect(tracked('crease pattern exported')).toEqual([{ format: 'svg', folded_figure: 'none' }]);
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
    segmentation.ensureCpSegmentationArtifacts.mockResolvedValue({ fold: FOLD });
    dialogs.requestCreasePatternExportOptions.mockResolvedValue({
      options: { ...WITH_DIAGRAM_FIGURE, segmentId: 0 },
      content: { foldedFigure: null, grid: null },
    });
  });

  it.each(['svg', 'png'] as const)(
    'remembers and reports the figure’s style for a %s, as the whole-pattern export does',
    async (format) => {
      await expect(
        useWorkspaceStore.getState().exportOristudioCpSegment(format, 0, fileService(true))
      ).resolves.toBe(true);
      expect(useSettingsStore.getState().creasePatternFoldedFigureStyle).toBe('builtin:diagram');
      expect(tracked('crease pattern exported')).toEqual([{ format, folded_figure: 'diagram' }]);
    }
  );

  it.each(['svg', 'png'] as const)(
    'neither remembers nor reports a %s save the user dismissed',
    async (format) => {
      const dismissed = fileService(false);
      await expect(useWorkspaceStore.getState().exportOristudioCpSegment(format, 0, dismissed)).resolves.toBe(
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
      expect.objectContaining({ had_title: true, folded_figure: 'diagram' }),
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
