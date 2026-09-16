import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '../../store/workspaceStore';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { cpActionByOperation } from '../../lib/oristudioCpActions';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import type { CreasePatternWebglCanvasProps } from '../../cp-workspace/CreasePatternWebglCanvas';
import { TooltipProvider } from '../ui/Tooltip';
import { CreasePatternPanel } from './CreasePatternPanel';

/**
 * The Pin Vertex rail tool, through the panel.
 *
 * The second CP tool whose commit never reaches the kernel — what it produces is
 * a pinned position in the store. Two panel lines carry that, and both fail
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

/** The vertex position `pickVertexTool` commits — resolved by the surface. */
const VERTEX = { x: 0.25, y: 0.75 };

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let executeCalls: string[] = [];
let previewCalls: string[] = [];

async function mount(operationId: 'VertexPin' | null): Promise<void> {
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

function pins() {
  return useWorkspaceStore.getState().oristudioCpPinnedVertices;
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

describe('the Pin Vertex tool commits web-side', () => {
  it('turns a press on a vertex into a pin and never asks the kernel', async () => {
    await mount('VertexPin');
    expect(canvasProbe.props).not.toBeNull();
    act(() => canvasProbe.props?.onToolCommit?.({ points: [VERTEX] }));

    expect(pins()).toEqual([VERTEX]);
    // A pin is not a kernel operation: the kernel is *told* about pins, on the
    // payload of the transform being constrained, but has no `VertexPin` to run.
    expect(executeCalls).toEqual([]);
  });

  it('toggles the pin off when the same vertex is pressed again', async () => {
    await mount('VertexPin');
    act(() => canvasProbe.props?.onToolCommit?.({ points: [VERTEX] }));
    act(() => canvasProbe.props?.onToolCommit?.({ points: [VERTEX] }));
    expect(pins()).toEqual([]);
  });

  it('records no history entry, because a pin is not an edit', async () => {
    // An undo after pinning should walk back the last crease edit, not the
    // marker — see `pins/vertexPins.ts`.
    await mount('VertexPin');
    const before = useWorkspaceStore.getState().oristudioCpHistoryPast.length;
    act(() => canvasProbe.props?.onToolCommit?.({ points: [VERTEX] }));
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast.length).toBe(before);
  });

  it('does not preview through the kernel while the pointer moves over vertices', async () => {
    await mount('VertexPin');
    act(() => canvasProbe.props?.onToolPreviewInput?.([{ x: 0.3, y: 0.3 }], []));
    // An unrecognised operation does not throw here — it lands in
    // `oristudioCpError` and raises a banner on every pointer move.
    expect(previewCalls).toEqual([]);
    expect(useWorkspaceStore.getState().oristudioCpError).toBeNull();
  });

  it('pins nothing from an empty commit', async () => {
    await mount('VertexPin');
    act(() => canvasProbe.props?.onToolCommit?.({ points: [] }));
    expect(pins()).toEqual([]);
  });
});
