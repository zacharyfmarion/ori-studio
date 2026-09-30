import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TFunction } from 'i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_EXPORT_SETTINGS } from '../../lib/paperExportSettings';
import { exportPaperStyle } from '../../lib/paperStyleSettings';
import { paperExportSceneInput } from '../../paperExport/paperExportSession';
import { usePaperExportUiStore } from '../../store/paperExportUiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { plannerSequenceWithGridFixture } from './__fixtures__/plannerSequence';
import type { PrecreaseSequence } from './precreaseSequence';
import type { ExtractedStep } from './referenceFinder/extractor';
import type { RawSolution } from './referenceFinder/solution';
import type { StepDiagramModel } from './referenceFinderDiagramToPrimitives';
import { flatPlanSteps } from './referencesBreakdown';
import { referencesExportSteps, type ReferencesStepsSource } from './referencesExportSteps';
import { decodePlanModel, planModelPoints } from './referencesPlanGeometry';
import type { ReferencesResults } from './referencesResults';
import { referencesViewSteps } from './referencesSequenceView';
import {
  referencesSequenceSubject,
  referencesStepScene,
  referencesStepSheetCssPx,
} from './referencesStepExport';
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

/** The planner's unit frame scaled and flipped, as `rfToModelMany` maps it. */
function mapToModel(points: Float64Array): Float64Array {
  const out = new Float64Array(points.length);
  for (let i = 0; i < points.length; i += 2) {
    out[i] = points[i]! * 400 - 200;
    out[i + 1] = 200 - points[i + 1]! * 400;
  }
  return out;
}

/**
 * The grid plan with its last fold made from the back. Its cards: step 1,
 * step 2, a turn-over, step 3, a turn-over, the finished pattern.
 */
function sequenceReading() {
  const fixture = plannerSequenceWithGridFixture();
  const sequence: PrecreaseSequence = {
    ...fixture,
    steps: fixture.steps.map((step, index) => (index === 2 ? { ...step, side: 'back' as const } : step)),
  };
  const variants = [
    { sequence, model: decodePlanModel(sequence, mapToModel(planModelPoints(sequence))) },
  ];
  const viewSteps = referencesViewSteps(variants, flatPlanSteps([sequence]));
  return {
    viewSteps,
    at: (activeStep: number): ReferencesStepsSource => ({
      kind: 'sequence',
      variants,
      viewSteps,
      sheetAux: null,
      activeStep,
    }),
  };
}

/** A Find answer of ten folds, each with ReferenceFinder's picture of it. */
function findSource(activeStep: number): ReferencesStepsSource {
  const steps: ExtractedStep[] = Array.from({ length: 10 }, (_, index) => ({
    axiom: 1,
    inputs: [],
    label: String.fromCharCode(65 + index),
    pinch: false,
    diagramIndex: index,
  }));
  const diagrams = steps.map((_, index) => [
    { type: 3, width: 1, height: 1 },
    { type: 1, from: [0, (index + 1) / 11], to: [1, (index + 1) / 11], style: 3 },
  ]);
  const results: ReferencesResults = {
    revision: 'r1',
    target: {
      kind: 'crease',
      component: 0,
      lineId: 1,
      a: { x: 0, y: 0 },
      b: { x: 0, y: 100 },
      cpLineIds: [1],
      rf: [
        [0, 0],
        [0, 1],
      ],
    },
    frame: { origin: [0, 100], x_axis: [1, 0], y_axis: [0, -1], width: 100, height: 100 },
    originals: { lines: {}, marks: {} },
    candidates: [
      {
        solution: {
          exact: true,
          err: 0,
          rank: 2,
          foldCount: steps.length,
          steps,
          freeDiagonals: [],
          target: { kind: 'line', line: { a: [0, 0], b: [0, 1] } },
        },
        raw: { diagrams } as unknown as RawSolution,
        modelSteps: steps.map(() => ({})),
      },
    ],
    durationMs: 1,
  };
  return { kind: 'find', results, candidate: 0, activeStep };
}

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
    mirrored: false,
    lineWidth: 1,
    subject: { kind: 'step', step: 2 },
    source: { kind: 'none' },
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

  it('rebuilds the scene for a new style, ground or sheet size, and only repaints for the rest', () => {
    mount().exportStep();
    const target = request()!.target;
    const style = exportPaperStyle(useSettingsStore.getState().paperStyle);
    const base = paperExportSceneInput(target, style, {
      ...DEFAULT_PAPER_EXPORT_SETTINGS,
      sheet: { mm: 41 },
    });
    const key = target.sceneKey(base);
    expect(target.sceneKey({ ...base, markHidden: true })).toBe(key);
    expect(target.sceneKey({ ...base, background: '#000000' })).not.toBe(key);
    expect(
      target.sceneKey({ ...base, style: { ...style, arrows: { ...style.arrows, color: '#ff0000' } } })
    ).not.toBe(key);
    // Drawn at the page's scale, so its marks keep their size on any sheet.
    expect(target.sceneKey({ ...base, sheet: { mm: 120 } })).not.toBe(key);
  });
});

describe('useReferencesStepExport, on every step', () => {
  it('opens the dialog on all steps, a page for each card the strip has', () => {
    const { viewSteps, at } = sequenceReading();
    mount({ subject: referencesSequenceSubject(viewSteps, 3), mirrored: true, source: at(3) }).exportAllSteps();
    const opened = request();
    expect(opened?.scope).toBe('all');
    expect(opened?.format).toBeNull();
    const pages = opened?.target.pages;
    expect(pages?.list).toEqual([
      { label: 'Step 1', fileStem: '1 step 1' },
      { label: 'Step 2', fileStem: '2 step 2' },
      { label: 'Turn over', fileStem: '3 turn over after step 2' },
      { label: 'Step 3', fileStem: '4 step 3' },
      { label: 'Turn over', fileStem: '5 turn over after step 3' },
    ]);
    expect(pages?.current).toBe(3);
    expect(pages?.title).toBe('Export all steps');
    expect(pages?.zipStem).toBe('Crane steps');
    // The page on show names the dialog and its one-file export.
    expect(opened?.target.title).toBe('Export step 3');
    expect(opened?.target.fileStem).toBe('Crane step 3');
  });

  it('zero-pads the entries to the count, and names a candidate’s archive for it', () => {
    mount({ subject: { kind: 'reference', candidate: 0, step: 9 }, source: findSource(9) }).exportAllSteps();
    const pages = request()?.target.pages;
    expect(pages?.list).toHaveLength(10);
    expect(pages?.list[0]).toEqual({ label: 'Step 1', fileStem: '01 step 1' });
    expect(pages?.list[9]).toEqual({ label: 'Step 10', fileStem: '10 step 10' });
    expect(pages?.current).toBe(9);
    expect(pages?.zipStem).toBe('Crane reference 1 steps');
  });

  it('draws the page on show as the big view draws it, and every other page as the strip reads it', async () => {
    const { viewSteps, at } = sequenceReading();
    const source = at(3);
    const captured = referencesExportSteps(source).steps;
    expect(captured[3]!.diagram).not.toEqual(DIAGRAM);
    mount({ subject: referencesSequenceSubject(viewSteps, 3), mirrored: true, source }).exportAllSteps();
    const target = request()!.target;
    const style = exportPaperStyle(useSettingsStore.getState().paperStyle);
    const options = {
      style,
      sheetCssPx: referencesStepSheetCssPx(DEFAULT_PAPER_EXPORT_SETTINGS.sheet),
      lineWidth: 1,
      showAux: useSettingsStore.getState().referencesShowAuxCreases,
      background: DEFAULT_PAPER_EXPORT_SETTINGS.background,
    };
    const scene = (page: number) =>
      target.buildScene(paperExportSceneInput(target, style, DEFAULT_PAPER_EXPORT_SETTINGS, page));
    expect(await scene(3)).toEqual(referencesStepScene(DIAGRAM, { ...options, mirrored: true }));
    expect(await scene(3)).not.toEqual(
      referencesStepScene(captured[3]!.diagram, { ...options, mirrored: true })
    );
    expect(await scene(0)).toEqual(
      referencesStepScene(captured[0]!.diagram, { ...options, mirrored: false })
    );
    expect(await scene(4)).toEqual(
      referencesStepScene(captured[4]!.diagram, { ...options, mirrored: true })
    );
    expect(await scene(5)).toBeNull();
  });

  it('keys each page’s scene apart', () => {
    const { viewSteps, at } = sequenceReading();
    mount({ subject: referencesSequenceSubject(viewSteps, 0), source: at(0) }).exportAllSteps();
    const target = request()!.target;
    const style = exportPaperStyle(useSettingsStore.getState().paperStyle);
    const key = (page: number) =>
      target.sceneKey(paperExportSceneInput(target, style, DEFAULT_PAPER_EXPORT_SETTINGS, page));
    expect(key(1)).not.toBe(key(0));
  });

  it('opens Export step on this step, with every page there to switch to', () => {
    const { viewSteps, at } = sequenceReading();
    mount({ subject: referencesSequenceSubject(viewSteps, 1), source: at(1) }).exportStep();
    const opened = request();
    expect(opened?.scope).toBe('this');
    expect(opened?.target.pages?.list).toHaveLength(5);
    expect(opened?.target.pages?.current).toBe(1);
    expect(opened?.target.fileStem).toBe('Crane step 2');
  });

  it('exports the shown step alone when the strip has nothing to read', () => {
    mount({ source: { kind: 'none' } }).exportStep();
    const opened = request();
    expect(opened?.scope).toBe('this');
    expect(opened?.target.pages?.list).toEqual([{ label: 'Step 3', fileStem: '1 step 3' }]);
    expect(opened?.target.pages?.current).toBe(0);
    expect(opened?.target.fileStem).toBe('Crane step 3');
  });

  it('says there are no steps, and opens nothing, when the strip has none', () => {
    mount({ source: { kind: 'none' } }).exportAllSteps();
    expect(request()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('There are no steps to export yet');
    toast.error.mockClear();
    mount({ diagram: null, source: { kind: 'none' } }).exportAllSteps();
    expect(request()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('There are no steps to export yet');
  });

  it('exports every step from the finished card, which has no step of its own to export', () => {
    const { viewSteps, at } = sequenceReading();
    const verbs = mount({
      diagram: null,
      subject: referencesSequenceSubject(viewSteps, 5),
      source: at(5),
    });
    verbs.exportStep();
    expect(request()).toBeNull();
    expect(toast.error).toHaveBeenCalledWith('There is no step to export yet');
    verbs.exportAllSteps();
    const opened = request();
    expect(opened?.scope).toBe('all');
    expect(opened?.target.pages?.list).toHaveLength(5);
    // The nearest card before it with a page: the closing turn-over.
    expect(opened?.target.pages?.current).toBe(4);
    expect(opened?.target.pages?.zipStem).toBe('Crane steps');
  });

  it('keeps the strip’s own page when the card on show is not the one it reads', async () => {
    const { viewSteps, at } = sequenceReading();
    const source = at(3);
    const captured = referencesExportSteps(source).steps;
    const verbs = mount({ subject: referencesSequenceSubject(viewSteps, 0), source });
    verbs.exportAllSteps();
    const target = request()!.target;
    const style = exportPaperStyle(useSettingsStore.getState().paperStyle);
    const input = paperExportSceneInput(target, style, DEFAULT_PAPER_EXPORT_SETTINGS, 3);
    expect(await target.buildScene(input)).toEqual(
      referencesStepScene(captured[3]!.diagram, {
        style,
        mirrored: captured[3]!.mirrored,
        sheetCssPx: referencesStepSheetCssPx(DEFAULT_PAPER_EXPORT_SETTINGS.sheet),
        lineWidth: 1,
        showAux: useSettingsStore.getState().referencesShowAuxCreases,
        background: DEFAULT_PAPER_EXPORT_SETTINGS.background,
      })
    );
    verbs.exportStep();
    expect(request()!.target.pages?.list.map((page) => page.label)).toEqual(['Step 1']);
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
