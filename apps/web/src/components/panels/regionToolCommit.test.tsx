import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '../../store/workspaceStore';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { cpActionByOperation } from '../../lib/oristudioCpActions';
import { isSuppressionRegionAnnotation } from '../../cp-workspace/annotations/annotation';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import type { CreasePatternWebglCanvasProps } from '../../cp-workspace/CreasePatternWebglCanvas';
import { TooltipProvider } from '../ui/Tooltip';
import { CreasePatternPanel } from './CreasePatternPanel';

/**
 * The Suppression Region rail tool, through the panel.
 *
 * This tool is the one CP tool whose commit never reaches the kernel — what it
 * produces is a `CanvasAnnotation`. Two panel lines carry that, and both fail
 * quietly if deleted:
 *
 * - the **commit** early return. Without it the commit falls through to
 *   `executeOristudioCpCommand` with an operation id the kernel has never heard
 *   of, and no region is ever created.
 * - the **preview** early return. Without it every pointer move of the drag asks
 *   the kernel to preview that same unknown operation — and
 *   `previewOristudioCpCommand` catches the refusal into `oristudioCpError`
 *   rather than throwing, so the tool keeps drawing its box while raising an
 *   error banner. Nothing throws, nothing else in the suite notices.
 *
 * The canvas is stubbed rather than mounted: jsdom has no WebGL, so the real one
 * renders `CpRendererUnavailable` and its pointer pipeline never runs. What is
 * under test is the panel's two handlers, and the stub hands them over exactly
 * as the tool engine would call them.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// A created region mounts its chip, and `FloatingToolbar` attaches one of these.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const canvasProbe: { props: CreasePatternWebglCanvasProps | null } = { props: null };

vi.mock('../../cp-workspace/CreasePatternWebglCanvas', () => ({
  CreasePatternWebglCanvas: (props: CreasePatternWebglCanvasProps) => {
    canvasProbe.props = props;
    return <div data-testid="canvas-stub" />;
  },
}));

const DOCUMENT = {
  handle: 4,
  loadSerial: 1,
  document: createStarterOristudioCpDocument(),
  geometry: null,
  summary: null,
  source: { format: 'cp', filename: 'Untitled.cp', path: null },
} as unknown as OristudioCpDocumentState;

/**
 * The four corners `dragBoxTool` commits for a drag from (0.1, 0.2) to
 * (0.7, 0.5) under an unrotated view, in `viewAlignedBoxCorners` order.
 */
const CORNERS = [
  { x: 0.1, y: 0.2 },
  { x: 0.1, y: 0.5 },
  { x: 0.7, y: 0.5 },
  { x: 0.7, y: 0.2 },
];

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let executeCalls: string[] = [];
let previewCalls: string[] = [];

async function mount(operationId: 'CheckSuppressionRegionCreate' | null): Promise<void> {
  executeCalls = [];
  previewCalls = [];
  canvasProbe.props = null;
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: DOCUMENT,
    oristudioCpAnnotations: [],
    oristudioCpSelection: emptyOristudioCpSelection(),
    oristudioCpActiveToolId: operationId ? cpActionByOperation(operationId)?.id : undefined,
    executeOristudioCpCommand: vi.fn(async (id: string) => {
      executeCalls.push(id);
      return true;
    }),
    previewOristudioCpCommand: vi.fn(async (id: string) => {
      previewCalls.push(id);
      return null;
    }),
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <TooltipProvider>
        <CreasePatternPanel />
      </TooltipProvider>
    )
  );
  // The panel settles asynchronously (provisioning, camera, diagnostics). Flush
  // that here rather than letting it land after the test and warn.
  await act(async () => {});
}

function regions() {
  return useWorkspaceStore.getState().oristudioCpAnnotations.filter(isSuppressionRegionAnnotation);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('the suppression-region tool commits web-side', () => {
  it('turns a drag-box commit into a region and never asks the kernel', async () => {
    await mount('CheckSuppressionRegionCreate');
    expect(canvasProbe.props).not.toBeNull();
    act(() => canvasProbe.props?.onToolCommit?.({ points: CORNERS }));

    const created = regions();
    expect(created).toHaveLength(1);
    expect(created[0].center.x).toBeCloseTo(0.4, 12);
    expect(created[0].center.y).toBeCloseTo(0.35, 12);
    expect(created[0].width).toBeCloseTo(0.6, 12);
    expect(created[0].height).toBeCloseTo(0.3, 12);
    // The tool is the *only* CP tool whose commit is not a kernel operation.
    expect(executeCalls).toEqual([]);
  });

  it('records the region as one undoable step', async () => {
    await mount('CheckSuppressionRegionCreate');
    const before = useWorkspaceStore.getState().oristudioCpHistoryPast.length;
    act(() => canvasProbe.props?.onToolCommit?.({ points: CORNERS }));
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast.length).toBe(before + 1);
  });

  it('does not preview through the kernel while the box is being dragged', async () => {
    await mount('CheckSuppressionRegionCreate');
    act(() => canvasProbe.props?.onToolPreviewInput?.([{ x: 0.3, y: 0.3 }], []));
    // An unrecognised operation does not throw here — it lands in
    // `oristudioCpError` and raises a banner on every pointer move.
    expect(previewCalls).toEqual([]);
    expect(useWorkspaceStore.getState().oristudioCpError).toBeNull();
  });

  it('creates nothing from a zero-area drag', async () => {
    await mount('CheckSuppressionRegionCreate');
    // `dragBoxTool` only rejects a zero-*length* gesture, so a perfectly
    // horizontal drag still commits and the panel has to drop it.
    act(() =>
      canvasProbe.props?.onToolCommit?.({
        points: [
          { x: 0.1, y: 0.4 },
          { x: 0.1, y: 0.4 },
          { x: 0.7, y: 0.4 },
          { x: 0.7, y: 0.4 },
        ],
      })
    );
    expect(regions()).toHaveLength(0);
  });

  it('creates nothing when the tool is not armed', async () => {
    await mount(null);
    act(() => canvasProbe.props?.onToolCommit?.({ points: CORNERS }));
    expect(regions()).toHaveLength(0);
  });
});
