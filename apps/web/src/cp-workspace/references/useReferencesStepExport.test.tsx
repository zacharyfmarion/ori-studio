import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_PAGE } from '../../lib/paper/paperPage';
import { useSettingsStore } from '../../store/settingsStore';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { useReferencesStepExport, type ReferencesStepExportInput } from './useReferencesStepExport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tracked: { event: string; properties?: Record<string, unknown> }[] = [];
vi.mock('../../analytics', () => ({
  ANALYTICS_EVENTS: new Proxy({}, { get: (_t, key) => String(key) }),
  track: (event: string, properties?: Record<string, unknown>) => {
    tracked.push(properties ? { event, properties } : { event });
  },
}));

const { referencesStepExportPage, saveReferencesStep, toast } = vi.hoisted(() => ({
  referencesStepExportPage: vi.fn(() => ({ svg: '<svg/>', widthPt: 10, heightPt: 10 })),
  saveReferencesStep: vi.fn(async (): Promise<string | null> => 'Crane-step-3.svg'),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('./referencesStepExport', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./referencesStepExport')>()),
  referencesStepExportPage,
  saveReferencesStep,
}));
vi.mock('sonner', () => ({ toast }));
vi.mock('../../store/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ workspaceTitle: 'Crane' }) },
}));

const DIAGRAM: StepDiagramModel = {
  sheet: { width: 400, height: 400, centre: [200, 200], axes: { x: [1, 0], y: [0, -1] } },
  primitives: [{ kind: 'line', from: [0, 200], to: [400, 200], style: 'mountain' }],
};
const CAMERA = { view: { origin: [0, 0] as const, ex: [2, 0] as const, ey: [0, 2] as const } };

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const exported: { current: ((format: 'svg' | 'png') => Promise<boolean>) | null } = { current: null };

function Probe({ input }: { input: ReferencesStepExportInput }): null {
  const exportStep = useReferencesStepExport(input);
  useEffect(() => {
    exported.current = exportStep;
  }, [exportStep]);
  return null;
}

function mount(overrides: Partial<ReferencesStepExportInput> = {}) {
  const input: ReferencesStepExportInput = {
    diagram: DIAGRAM,
    camera: CAMERA,
    mirrored: false,
    lineWidth: 1,
    subject: { kind: 'step', step: 2 },
    ...overrides,
  };
  act(() => root?.render(<Probe input={input} />));
  if (!exported.current) throw new Error('hook not mounted');
  return exported.current;
}

beforeEach(() => {
  tracked.length = 0;
  referencesStepExportPage.mockClear();
  saveReferencesStep.mockClear();
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

describe('useReferencesStepExport', () => {
  it('paints the shown diagram at the view’s sheet size on the export style and page, and saves it by the card', async () => {
    const exportStep = mount();
    await act(async () => {
      await expect(exportStep('svg')).resolves.toBe(true);
    });
    expect(referencesStepExportPage).toHaveBeenCalledWith(DIAGRAM, {
      style: initialSettings.paperStyle.display,
      page: DEFAULT_PAPER_PAGE,
      mirrored: false,
      // 400 model units through a camera at 2 CSS px per unit.
      sheetCssPx: 800,
      lineWidth: 1,
    });
    expect(saveReferencesStep).toHaveBeenCalledWith({
      page: { svg: '<svg/>', widthPt: 10, heightPt: 10 },
      format: 'svg',
      pngDpi: initialSettings.paperExport.pngDpi,
      name: 'Crane step 3',
    });
    expect(toast.success).toHaveBeenCalled();
  });

  it('paints with the export style once it is set apart, and the reader’s side', async () => {
    useSettingsStore.getState().setExportPaperStyleFollowsDisplay(false);
    useSettingsStore.getState().setPaperStyleField('export', 'paper.front', '#123456');
    useSettingsStore.getState().setPaperStyleField('display', 'paper.front', '#654321');
    const exportStep = mount({ mirrored: true, subject: { kind: 'reference', candidate: 0, step: 1 } });
    await act(async () => {
      await exportStep('png');
    });
    const [, options] = referencesStepExportPage.mock.calls[0] as unknown as [
      StepDiagramModel,
      { style: { paper: { front: string } }; mirrored: boolean },
    ];
    expect(options.style.paper.front).toBe('#123456');
    expect(options.mirrored).toBe(true);
    expect(saveReferencesStep).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'png', name: 'Crane reference 1 step 2' })
    );
  });

  it('carries the page and the density from the export settings', async () => {
    useSettingsStore.getState().setPaperExportField('keepHiddenFaces', false);
    useSettingsStore.getState().setPaperExportField('pngDpi', 300);
    const exportStep = mount();
    await act(async () => {
      await exportStep('png');
    });
    expect(referencesStepExportPage).toHaveBeenCalledWith(
      DIAGRAM,
      expect.objectContaining({ page: { ...DEFAULT_PAPER_PAGE, keepHiddenFaces: false } })
    );
    expect(saveReferencesStep).toHaveBeenCalledWith(expect.objectContaining({ pngDpi: 300 }));
  });

  it('counts a saved export as the references surface, by format and hidden faces', async () => {
    useSettingsStore.getState().setPaperExportField('keepHiddenFaces', false);
    const exportStep = mount();
    await act(async () => {
      await exportStep('png');
    });
    expect(tracked).toEqual([
      {
        event: 'paperExported',
        properties: { surface: 'references', format: 'png', hidden_faces: 'dropped' },
      },
    ]);
  });

  it('refuses politely with no diagram, and paints nothing', async () => {
    const exportStep = mount({ diagram: null });
    await act(async () => {
      await expect(exportStep('svg')).resolves.toBe(false);
    });
    expect(referencesStepExportPage).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalled();
    expect(tracked).toEqual([]);
  });

  it('says nothing for a dismissed dialog, and counts nothing', async () => {
    saveReferencesStep.mockResolvedValueOnce(null);
    const exportStep = mount();
    await act(async () => {
      await expect(exportStep('svg')).resolves.toBe(false);
    });
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(tracked).toEqual([]);
  });

  it('reports a save that failed', async () => {
    saveReferencesStep.mockRejectedValueOnce(new Error('disk full'));
    const exportStep = mount();
    await act(async () => {
      await expect(exportStep('svg')).resolves.toBe(false);
    });
    expect(toast.error).toHaveBeenCalledWith(
      'Could not export this step',
      expect.objectContaining({ description: 'disk full' })
    );
  });
});
