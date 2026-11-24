import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { DEFAULT_FOLDED_3D_CAMERA } from '../../cp-workspace/folded/folded3dCamera';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { ensureCpSheetIndex } from '../../cp-workspace/sheets/cpSheetIndex';
import { cpDocument, TWO_SQUARES, twoSquaresIndex, type FixtureLine } from '../../diagram/capture/capture.fixtures';
import { chooseStepCreases, creasesFingerprint, drawnLinesFingerprint } from '../../diagram/capture/captureCreases';
import { linkStatus } from '../../diagram/capture/linkStatus';
import { forgetOpenedLines } from '../../diagram/capture/openedLines';
import type {
  DiagramCpRender,
  DiagramCpScope,
  DiagramCpSource,
  DiagramDocument,
  DiagramStep,
} from '../../diagram/document/diagramDocument';
import { cpStep } from '../../diagram/document/diagramSteps.fixtures';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { installOpenedLinesSync } from './openedLinesSync';
import type { WorkspaceState } from './types';

vi.mock('../../cp-workspace/sheets/cpSheetIndex', () => ({
  ensureCpSheetIndex: vi.fn(),
  peekCpSheetIndex: vi.fn(() => null),
}));

type Slice = Pick<WorkspaceState, 'oristudioCpDocument' | 'diagram'>;

const sheets = twoSquaresIndex();
const [left] = sheetRegions(sheets);
const regionScope: DiagramCpScope = { kind: 'segment', region: regionReferenceFor(left!) };
const FOLDED: DiagramCpRender = { mode: 'folded-3d', side: 'front', camera: DEFAULT_FOLDED_3D_CAMERA };

/** The left square's aux line moved: an aux edit. */
const auxMoved = () => cpDocument(TWO_SQUARES.map((line, i): FixtureLine => (i === 9 ? [0, 60, 50, 60, 'Cyan3'] : line)));

/** A folded step of the left square, captured from {@link cpDocument} — by a build before links kept their drawn lines unless `tracked`. */
function foldedStep(id: string, tracked = false): DiagramStep & { source: DiagramCpSource } {
  const base = cpStep(id, FOLDED);
  const choice = chooseStepCreases(cpDocument(), regionScope, sheets);
  if (base.source?.kind !== 'cp' || choice.status !== 'found') throw new Error('the left square should be found');
  const drawnFingerprint = drawnLinesFingerprint(choice.creases, FOLDED);
  const source: DiagramCpSource = {
    ...base.source,
    scope: regionScope,
    render: FOLDED,
    fingerprint: creasesFingerprint(choice.creases, FOLDED),
    ...(tracked && drawnFingerprint ? { drawnFingerprint } : {}),
  };
  return { ...base, source };
}

function pattern(document: OristudioCpDocumentSnapshot, loadSerial: number): Slice['oristudioCpDocument'] {
  return { document, loadSerial } as unknown as Slice['oristudioCpDocument'];
}

function diagram(...steps: DiagramStep[]): DiagramDocument {
  return { steps } as unknown as DiagramDocument;
}

/** Let the sheet index the sync asked for land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

let store: StoreApi<Slice>;
let uninstall: () => void;

beforeEach(() => {
  vi.mocked(ensureCpSheetIndex).mockReset();
  vi.mocked(ensureCpSheetIndex).mockImplementation(async () => sheets);
  store = createStore<Slice>(() => ({ oristudioCpDocument: null, diagram: null }));
  uninstall = installOpenedLinesSync(store);
});

afterEach(() => {
  uninstall();
  forgetOpenedLines();
});

describe('installOpenedLinesSync', () => {
  // An `.osf` installs its pattern, then its diagram: the lines are taken once
  // both are there, and an aux line drawn after that reads stale.
  it('takes the lines a pattern opened with once its diagram is there, so an aux edit since reads stale', async () => {
    const step = foldedStep('step-old');
    store.setState({ oristudioCpDocument: pattern(cpDocument(), 1) });
    expect(ensureCpSheetIndex).not.toHaveBeenCalled();
    store.setState({ diagram: diagram(step) });
    expect(ensureCpSheetIndex).toHaveBeenCalledTimes(1);
    await settle();
    expect(linkStatus(step.source, cpDocument(), sheets)).toBe('current');
    expect(linkStatus(step.source, auxMoved(), sheets)).toBe('stale');
  });

  it('takes them when the diagram is there before the pattern loads', async () => {
    const step = foldedStep('step-old');
    store.setState({ diagram: diagram(step) });
    store.setState({ oristudioCpDocument: pattern(cpDocument(), 1) });
    await settle();
    expect(linkStatus(step.source, auxMoved(), sheets)).toBe('stale');
  });

  // An index built for edited lines would make the edit the baseline.
  it('takes nothing when the lines change before the index lands', async () => {
    const step = foldedStep('step-old');
    store.setState({ oristudioCpDocument: pattern(cpDocument(), 1), diagram: diagram(step) });
    store.setState({ oristudioCpDocument: pattern(auxMoved(), 1) });
    await settle();
    expect(linkStatus(step.source, auxMoved(), sheets)).toBe('current');
  });

  it('keeps them through a new snapshot of the same lines, and drops them when another pattern loads', async () => {
    const step = foldedStep('step-old');
    store.setState({ oristudioCpDocument: pattern(cpDocument(), 1), diagram: diagram(step) });
    await settle();
    store.setState({ oristudioCpDocument: pattern(cpDocument(), 1) });
    expect(linkStatus(step.source, auxMoved(), sheets)).toBe('stale');
    store.setState({ oristudioCpDocument: pattern(cpDocument(), 2), diagram: null });
    expect(linkStatus(step.source, auxMoved(), sheets)).toBe('current');
  });

  it('takes nothing when the lines change before the diagram arrives', async () => {
    const step = foldedStep('step-old');
    store.setState({ oristudioCpDocument: pattern(cpDocument(), 1) });
    store.setState({ oristudioCpDocument: pattern(auxMoved(), 1) });
    store.setState({ diagram: diagram(step) });
    await settle();
    expect(ensureCpSheetIndex).not.toHaveBeenCalled();
    expect(linkStatus(step.source, auxMoved(), sheets)).toBe('current');
  });

  // It hears every change to the store, so a pattern it cannot read — a
  // test's partial one — must cost a baseline, never the update that called it.
  it('never throws into an update, even for a pattern it cannot read', async () => {
    const partial = {} as unknown as OristudioCpDocumentSnapshot;
    expect(() => store.setState({ oristudioCpDocument: pattern(partial, 1), diagram: diagram(foldedStep('step-old')) })).not.toThrow();
    expect(() => store.setState({ oristudioCpDocument: pattern({} as unknown as OristudioCpDocumentSnapshot, 1) })).not.toThrow();
    await settle();
    expect(ensureCpSheetIndex).not.toHaveBeenCalled();
  });

  it('builds no index for a pattern without aux lines, or a diagram whose folded steps keep their drawn lines', async () => {
    const bare = cpDocument(TWO_SQUARES.filter((_, i) => i !== 9));
    store.setState({ oristudioCpDocument: pattern(bare, 1), diagram: diagram(foldedStep('step-old')) });
    store.setState({ oristudioCpDocument: pattern(cpDocument(), 2), diagram: diagram(foldedStep('step-new', true)) });
    await settle();
    expect(ensureCpSheetIndex).not.toHaveBeenCalled();
  });
});
