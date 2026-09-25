import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaperScene } from '../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE, effectivePaperStyle } from '../lib/paper/paperStyle';
import { exportPaperStyle } from '../lib/paperStyleSettings';
import { usePaperExportUiStore } from '../store/paperExportUiStore';
import { useSettingsStore } from '../store/settingsStore';
import type { SimulatorExportSceneOptions } from './simulatorSession';
import { useSimulatorExport, type SimulatorExportOptions } from './useSimulatorExport';
import type { SimulatorExportSnapshot } from './useSimulatorRuntime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));
vi.mock('../store/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ workspaceTitle: 'Crane' }) },
}));

const SCENE: PaperScene = {
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  sheet: 10,
  items: [
    { kind: 'face', face: 0, side: 'front', rings: [[[0, 0], [10, 0], [10, 10]]], shade: 1, hidden: false },
  ],
};

const EMPTY = 'This simulation has nothing to export yet';

/** A frame the worker froze, answering one scene. */
function frozenFrame() {
  return {
    scene: vi.fn(async (_options: SimulatorExportSceneOptions): Promise<PaperScene | null> => SCENE),
    release: vi.fn(),
  };
}

type BeginExport = () => Promise<SimulatorExportSnapshot | null>;

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const exported: { current: (() => Promise<void>) | null } = { current: null };

function Probe({ beginExport, options }: { beginExport: BeginExport; options: SimulatorExportOptions }): null {
  const exportView = useSimulatorExport(beginExport, options);
  useEffect(() => {
    exported.current = exportView;
  }, [exportView]);
  return null;
}

function mount(beginExport: BeginExport, options: SimulatorExportOptions = { surface: 'simulator' }) {
  act(() => root?.render(<Probe beginExport={beginExport} options={options} />));
  if (!exported.current) throw new Error('hook not mounted');
  return exported.current;
}

async function run(exportView: () => Promise<void>) {
  await act(async () => {
    await exportView();
  });
}

const request = () => usePaperExportUiStore.getState().request;

beforeEach(() => {
  toast.success.mockClear();
  toast.error.mockClear();
  useSettingsStore.setState(initialSettings, true);
  usePaperExportUiStore.setState({ request: null });
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
  usePaperExportUiStore.setState({ request: null });
  useSettingsStore.setState(initialSettings, true);
});

describe('useSimulatorExport', () => {
  it('opens the export dialog on the frozen view, named for the project, on the remembered format', async () => {
    await run(mount(async () => frozenFrame()));
    const opened = request();
    expect(opened?.format).toBeNull();
    expect(opened?.scope).toBe('this');
    expect(opened?.target).toMatchObject({
      surface: 'simulator',
      title: 'Export view',
      fileStem: 'Crane',
      pages: null,
      buriesFaces: true,
      pins: null,
    });
    expect(opened?.target.exportStyle).toEqual(exportPaperStyle(useSettingsStore.getState().paperStyle));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('takes the export style once it is set apart, with the object’s pins on top', async () => {
    useSettingsStore.getState().setExportPaperStyleFollowsDisplay(false);
    useSettingsStore.getState().setPaperStyleField('export', 'paper.front', '#123456');
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#654321');
    const overrides = { 'paper.back': '#abcdef' } as const;
    await run(mount(async () => frozenFrame(), { surface: 'inline-simulation', overrides }));
    const target = request()!.target;
    expect(target.surface).toBe('inline-simulation');
    expect(target.pins).toEqual(overrides);
    expect(target.exportStyle).toEqual(
      effectivePaperStyle(useSettingsStore.getState().paperStyle.export!, overrides)
    );
    expect(target.exportStyle.paper).toEqual({ front: '#123456', back: '#abcdef' });
  });

  it('says there is nothing to export, and opens nothing, when the worker has no frame', async () => {
    await run(mount(async () => null));
    expect(request()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(EMPTY);
  });

  it('treats a worker that rejects as an empty view', async () => {
    await run(
      mount(async () => {
        throw new Error('context lost');
      })
    );
    expect(request()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith(EMPTY);
  });

  it('hands focus back to what held it when the verb ran, not what holds it once the frame is frozen', async () => {
    const opener = document.createElement('button');
    const elsewhere = document.createElement('button');
    document.body.append(opener, elsewhere);
    let freeze: (snapshot: SimulatorExportSnapshot) => void = () => undefined;
    const exportView = mount(() => new Promise((resolve) => (freeze = resolve)));
    opener.focus();
    await act(async () => {
      const exporting = exportView();
      elsewhere.focus();
      freeze(frozenFrame());
      await exporting;
    });
    expect(request()?.returnFocus).toBe(opener);
    opener.remove();
    elsewhere.remove();
  });

  it('builds the dialog’s scenes from the frozen frame, and lets it go when the dialog closes', async () => {
    const frame = frozenFrame();
    await run(mount(async () => frame));
    const target = request()!.target;
    const style = { ...DEFAULT_PAPER_STYLE, light: { ...DEFAULT_PAPER_STYLE.light, azimuth: 30 } };
    await expect(
      target.buildScene({ page: 0, style, markHidden: true, background: null })
    ).resolves.toBe(SCENE);
    expect(frame.scene).toHaveBeenCalledWith({ style, markHidden: true });
    expect(frame.release).not.toHaveBeenCalled();
    usePaperExportUiStore.getState().close();
    expect(frame.release).toHaveBeenCalledTimes(1);
  });
});
