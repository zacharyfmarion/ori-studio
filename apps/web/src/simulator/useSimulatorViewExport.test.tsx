import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_PAGE } from '../lib/paper/paperPage';
import { DEFAULT_PAPER_STYLE, effectivePaperStyle } from '../lib/paper/paperStyle';
import type { PaperSvgResult } from '../lib/paper/paperSvg';
import { useSettingsStore } from '../store/settingsStore';
import type { SimulatorExportRequest } from './useSimulatorRuntime';
import { useSimulatorViewExport, type SimulatorViewExportOptions } from './useSimulatorViewExport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties?: Record<string, unknown>) => {
    tracked.push(properties ? { event, properties } : { event });
  },
}));

const { saveSimulatorView, toast } = vi.hoisted(() => ({
  saveSimulatorView: vi.fn(async (): Promise<string | null> => 'crane.svg'),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('./simulatorViewExport', () => ({ saveSimulatorView }));
vi.mock('sonner', () => ({ toast }));
vi.mock('../store/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ workspaceTitle: 'crane' }) },
}));

const PAINTED: PaperSvgResult = { svg: '<svg/>', widthPt: 10, heightPt: 10 };

/** A worker stand-in that answers a painted page and records what it was asked to paint. */
const painter = () => vi.fn(async (_request: SimulatorExportRequest) => PAINTED);

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const exported: { current: ((format: 'svg' | 'png') => Promise<boolean>) | null } = { current: null };

function Probe({
  exportSvg,
  options,
}: {
  exportSvg: Parameters<typeof useSimulatorViewExport>[0];
  options: SimulatorViewExportOptions;
}): null {
  const exportView = useSimulatorViewExport(exportSvg, options);
  useEffect(() => {
    exported.current = exportView;
  }, [exportView]);
  return null;
}

function mount(
  exportSvg: Parameters<typeof useSimulatorViewExport>[0],
  options: SimulatorViewExportOptions = { surface: 'simulator' }
) {
  act(() => root?.render(<Probe exportSvg={exportSvg} options={options} />));
  if (!exported.current) throw new Error('hook not mounted');
  return exported.current;
}

beforeEach(() => {
  tracked.length = 0;
  saveSimulatorView.mockClear();
  toast.success.mockClear();
  toast.error.mockClear();
  useSettingsStore.setState(initialSettings, true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  exported.current = null;
  useSettingsStore.setState(initialSettings, true);
});

describe('useSimulatorViewExport', () => {
  it('hands the worker the display style and the export page while export follows display', async () => {
    const exportSvg = painter();
    const exportView = mount(exportSvg);
    await act(async () => {
      await expect(exportView('svg')).resolves.toBe(true);
    });
    expect(exportSvg).toHaveBeenCalledWith({ style: DEFAULT_PAPER_STYLE, page: DEFAULT_PAPER_PAGE });
    expect(saveSimulatorView).toHaveBeenCalledWith({
      page: PAINTED,
      format: 'svg',
      pngDpi: initialSettings.paperExport.pngDpi,
      name: 'crane',
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('paints with the export style once it is set apart, with the object’s overrides on top', async () => {
    useSettingsStore.getState().setExportPaperStyleFollowsDisplay(false);
    useSettingsStore.getState().setPaperStyleField('export', 'paper.front', '#123456');
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#654321');
    const overrides = { 'paper.back': '#abcdef' } as const;
    const exportSvg = painter();
    const exportView = mount(exportSvg, { surface: 'inline-simulation', overrides });
    await act(async () => {
      await exportView('png');
    });
    const { style } = exportSvg.mock.calls[0]![0];
    expect(style).toEqual(
      effectivePaperStyle(useSettingsStore.getState().paperStyle.export!, overrides)
    );
    expect(style.paper.front).toBe('#123456');
    expect(style.paper.back).toBe('#abcdef');
  });

  it('carries the page and the density from the export settings', async () => {
    useSettingsStore.getState().setPaperExportField('keepHiddenFaces', false);
    useSettingsStore.getState().setPaperExportField('pngDpi', 300);
    const exportSvg = painter();
    const exportView = mount(exportSvg);
    await act(async () => {
      await exportView('png');
    });
    expect(exportSvg.mock.calls[0]![0]).toMatchObject({
      page: { ...DEFAULT_PAPER_PAGE, keepHiddenFaces: false },
    });
    expect(saveSimulatorView).toHaveBeenCalledWith(expect.objectContaining({ pngDpi: 300 }));
  });

  it('counts a saved export by surface, format and whether hidden faces were kept', async () => {
    useSettingsStore.getState().setPaperExportField('keepHiddenFaces', false);
    const exportView = mount(async () => PAINTED, { surface: 'inline-simulation' });
    await act(async () => {
      await exportView('png');
    });
    expect(tracked).toEqual([
      {
        event: 'paperExported',
        properties: { surface: 'inline-simulation', format: 'png', hidden_faces: 'dropped' },
      },
    ]);
  });

  it('says so and counts nothing when there is nothing to draw or the save is dismissed', async () => {
    const exportView = mount(async () => null);
    await act(async () => {
      await expect(exportView('svg')).resolves.toBe(false);
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(saveSimulatorView).not.toHaveBeenCalled();

    saveSimulatorView.mockResolvedValueOnce(null);
    const dismissed = mount(async () => PAINTED);
    await act(async () => {
      await expect(dismissed('svg')).resolves.toBe(false);
    });
    expect(tracked).toEqual([]);
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('treats a worker that rejects as an empty view', async () => {
    const exportView = mount(async () => {
      throw new Error('context lost');
    });
    await act(async () => {
      await expect(exportView('svg')).resolves.toBe(false);
    });
    expect(toast.error).toHaveBeenCalledTimes(1);
  });
});
