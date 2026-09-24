import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../../lib/paperExportSettings';
import { exportPaperStyle } from '../../lib/paperStyleSettings';
import { paperExportSceneInput } from '../../paperExport/paperExportSession';
import { usePaperExportUiStore } from '../../store/paperExportUiStore';
import { useSettingsStore } from '../../store/settingsStore';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import {
  referencesStepExportTitle,
  useReferencesStepExport,
  type ReferencesStepExportInput,
  type ReferencesStepExportVerbs,
} from './useReferencesStepExport';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { toast } = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('sonner', () => ({ toast }));
vi.mock('../../store/workspaceStore', () => ({
  useWorkspaceStore: { getState: () => ({ workspaceTitle: 'Crane' }) },
}));

const t = ((_key: string, fallback: string, options?: Record<string, unknown>) =>
  fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name]))) as unknown as TFunction;

const DIAGRAM: StepDiagramModel = {
  sheet: { width: 400, height: 400, centre: [200, 200], axes: { x: [1, 0], y: [0, -1] } },
  primitives: [{ kind: 'line', from: [0, 200], to: [400, 200], style: 'mountain' }],
};
const CAMERA = { view: { origin: [0, 0] as const, ex: [2, 0] as const, ey: [0, 2] as const } };

const initialSettings = useSettingsStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const exported: { current: ReferencesStepExportVerbs | null } = { current: null };

function Probe({ input }: { input: ReferencesStepExportInput }): null {
  const verbs = useReferencesStepExport(input);
  useEffect(() => {
    exported.current = verbs;
  }, [verbs]);
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

describe('useReferencesStepExport', () => {
  it('opens the export dialog on the step, named for the card, on the verb’s format', () => {
    mount().exportStepPng();
    const opened = request();
    expect(opened?.format).toBe('png');
    expect(opened?.target.surface).toBe('references');
    expect(opened?.target.title).toBe('Export step 3');
    expect(opened?.target.fileStem).toBe('Crane step 3');
    expect(opened?.target.buriesFaces).toBe(false);
    expect(opened?.target.pins).toBeNull();
  });

  it('opens on the remembered format for Export step, and on its own for the SVG and PNG verbs', () => {
    const verbs = mount();
    verbs.exportStep();
    expect(request()?.format).toBeNull();
    verbs.exportStepSvg();
    expect(request()?.format).toBe('svg');
    verbs.exportStepPng();
    expect(request()?.format).toBe('png');
  });

  it('hands focus back to what held it when the verb ran', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    mount().exportStep();
    expect(request()?.returnFocus).toBe(opener);
    opener.remove();
  });

  it('says there is nothing to export, and opens nothing, when no step is showing', () => {
    mount({ diagram: null }).exportStepSvg();
    expect(request()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('There is no step to export yet');
  });

  it('rebuilds the scene for a new style or ground, and only repaints for the rest', () => {
    mount().exportStep();
    const target = request()!.target;
    const style = exportPaperStyle(useSettingsStore.getState().paperStyle);
    const base = paperExportSceneInput(target, style, DEFAULT_PAPER_EXPORT_SETTINGS);
    const key = target.sceneKey(base);
    expect(target.sceneKey({ ...base, markHidden: true })).toBe(key);
    expect(target.sceneKey({ ...base, background: '#000000' })).not.toBe(key);
    expect(
      target.sceneKey({ ...base, style: { ...style, arrows: { ...style.arrows, color: '#ff0000' } } })
    ).not.toBe(key);
  });
});

describe('referencesStepExportTitle', () => {
  it('names a fold, a turn-over and a candidate’s step as the strip does', () => {
    expect(referencesStepExportTitle(t, { kind: 'step', step: 0 })).toBe('Export step 1');
    expect(referencesStepExportTitle(t, { kind: 'turn-over', after: 2 })).toBe('Export turn-over');
    expect(referencesStepExportTitle(t, { kind: 'reference', candidate: 1, step: 3 })).toBe(
      'Export reference 2, step 4'
    );
  });
});
