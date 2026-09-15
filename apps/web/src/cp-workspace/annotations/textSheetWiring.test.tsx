import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { CpPropertiesPanel } from '../../components/panels/CpPropertiesPanel';
import { CpTextAnnotationLayer } from '../CpTextAnnotationLayer';
import { cpOverlayViewStore } from '../cpOverlayViewStore';
import { endOpenCanvasSessions } from '../canvasObjects/canvasSessions';
import { annotationGesture } from './annotationGesture';
import { createTextAnnotation, textDocFromPlainText } from './textAnnotation';
import {
  beginTextEditSession,
  endTextEditSession,
  resetTextEditSessionForTests,
  textEditSession,
} from './textEditSession';

/**
 * The text sheet's two write paths, wired: the live editor beside the pane
 * the way the canvas mounts them. Idle, a box-level change is one entry
 * through the layer's bracket; while the box is being edited, the same change
 * writes inside the session, leaves it open, and lands in its one 'Edit text'
 * entry on exit. An undo from the menu bar mid-session commits the session
 * first, so the step undoes it.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

const DOCUMENT = {
  handle: 4,
  loadSerial: 1,
  document: createStarterOristudioCpDocument(),
  geometry: null,
  summary: null,
  source: { format: 'cp', filename: 'Untitled.cp', path: null },
} as unknown as OristudioCpDocumentState;

const VIEW = { origin: [0, 0] as const, ex: [1, 0] as const, ey: [0, 1] as const };
const initialState = useWorkspaceStore.getInitialState();

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** The canvas's text layer and the pane, reading the same store. */
function Surfaces({ editingId }: { editingId: string | null }) {
  const annotations = useWorkspaceStore((state) => state.oristudioCpAnnotations);
  const updateAnnotation = useWorkspaceStore((state) => state.updateAnnotation);
  return (
    <>
      <CpTextAnnotationLayer
        annotations={annotations}
        editingTextId={editingId}
        toolbarContainer={null}
        onChangeText={(id, doc, plainText) => updateAnnotation(id, { doc, plainText })}
        onExitEdit={(reason) => endTextEditSession(reason)}
        onDelete={() => endTextEditSession('delete')}
        onSyncHeight={() => {}}
      />
      <CpPropertiesPanel />
    </>
  );
}

function mount(editingId: string | null) {
  act(() => root?.render(<Surfaces editingId={editingId} />));
}

const opacitySlider = () =>
  [...(host?.querySelectorAll<HTMLInputElement>('.cp-properties-panel input[type="range"]') ?? [])].find(
    (input) => input.getAttribute('aria-label') === 'Opacity'
  );

/** A pointer drag of the range thumb: `input` per move, one `change` on release. */
function dragSlider(input: HTMLInputElement, value: number): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, String(value));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const history = () => useWorkspaceStore.getState().oristudioCpHistoryPast;
const storedText = (id: string) => {
  const annotation = useWorkspaceStore
    .getState()
    .oristudioCpAnnotations.find((candidate) => candidate.id === id);
  if (!annotation || annotation.kind !== 'text') throw new Error('no text box');
  return annotation;
};

const BOX = createTextAnnotation({
  id: 'text-1',
  center: { x: 0, y: 0 },
  doc: textDocFromPlainText('hello'),
});

beforeEach(() => {
  resetTextEditSessionForTests();
  annotationGesture.abortAll();
  cpOverlayViewStore.set({ model: VIEW, user: VIEW });
  useWorkspaceStore.setState(
    {
      ...initialState,
      // `activeEditingContext` is derived from the active panel; `undo`
      // routes on it.
      activePanelId: 'crease-pattern',
      oristudioCpDocument: DOCUMENT,
      oristudioCpAnnotations: [BOX],
      oristudioCpSelectedAnnotationId: BOX.id,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
    },
    true
  );
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  resetTextEditSessionForTests();
  annotationGesture.abortAll();
  useWorkspaceStore.setState(initialState, true);
});

describe('the text sheet', () => {
  it('fades an idle box through the layer’s bracket, as one entry', async () => {
    mount(null);
    const slider = opacitySlider();
    expect(slider).toBeDefined();
    expect(slider?.disabled).toBe(false);

    await act(async () => dragSlider(slider!, 0.4));

    expect(storedText(BOX.id).opacity).toBeCloseTo(0.4);
    expect(history()).toHaveLength(1);
    expect(history()[0]?.label).toBe('Adjust opacity');
    expect(annotationGesture.openOwner()).toBeNull();
  });

  it('fades a box under edit inside the session, with the row live', async () => {
    act(() => {
      beginTextEditSession(BOX.id, false);
    });
    mount(BOX.id);
    // The session holds the layer's bracket. The row must not sit disabled
    // for the whole edit: it writes inside the session's entry instead.
    expect(annotationGesture.openOwner()).toBe('text-session');
    const slider = opacitySlider();
    expect(slider?.disabled).toBe(false);

    await act(async () => dragSlider(slider!, 0.25));

    expect(storedText(BOX.id).opacity).toBeCloseTo(0.25);
    expect(textEditSession()?.id).toBe(BOX.id);
    expect(annotationGesture.openOwner()).toBe('text-session');
    expect(history()).toHaveLength(0);

    await act(async () => endTextEditSession('blur'));
    expect(history()).toHaveLength(1);
    expect(history()[0]?.label).toBe('Edit text');
    // Undoing that one entry restores the opacity with the text.
    await act(async () => useWorkspaceStore.getState().undo());
    expect(storedText(BOX.id).opacity).toBe(1);
  });

  it('commits the session at the undo chokepoint, so the step undoes it', async () => {
    act(() => {
      beginTextEditSession(BOX.id, false);
    });
    mount(BOX.id);
    await act(async () => dragSlider(opacitySlider()!, 0.5));
    expect(history()).toHaveLength(0);

    await act(async () => endOpenCanvasSessions('history'));
    expect(textEditSession()).toBeNull();
    expect(history()).toHaveLength(1);
    expect(history()[0]?.label).toBe('Edit text');
  });
});
