import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  FIGURE,
  IMAGE,
  REGION,
  TEXT,
  WINDOW,
} from '../../cp-workspace/canvasObjects/canvasObjectKinds.fixtures';
import { annotationGesture } from '../../cp-workspace/annotations/annotationGesture';
import { textDocSummary } from '../../cp-workspace/annotations/textDocTransforms';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { CpPropertiesPanel } from './CpPropertiesPanel';

/**
 * The pane through the store: seed a selection of each kind and read what
 * the sheet shows, then edit through a row and read the store back. The
 * catalogs and the renderer have their own tests; this is the composition —
 * resolver, registry, sheet — mounted the way the dock mounts it.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();

/** An open document, which is what an overlay history entry is recorded against. */
const DOCUMENT = {
  handle: 4,
  loadSerial: 1,
  document: createStarterOristudioCpDocument(),
  geometry: null,
  summary: null,
  source: { format: 'cp', filename: 'Untitled.cp', path: null },
} as unknown as OristudioCpDocumentState;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function mount(patch: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState({
    oristudioCpDocument: DOCUMENT,
    oristudioCpAnnotations: [IMAGE, TEXT, REGION],
    oristudioCpFoldedFigures: [FIGURE],
    oristudioCpInlineSimulations: [WINDOW],
    ...patch,
  });
  act(() => root?.render(<CpPropertiesPanel />));
}

const text = (selector: string) => host?.querySelector(selector)?.textContent ?? null;
const labels = () =>
  [...(host?.querySelectorAll('.control-row__label') ?? [])].map((label) => label.textContent);

function setRange(input: HTMLInputElement, value: string, event: 'input' | 'change') {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    if (event === 'input') setter?.call(input, value);
    input.dispatchEvent(new Event(event, { bubbles: true }));
  });
}

beforeEach(() => {
  useWorkspaceStore.setState(initialState, true);
  annotationGesture.abortAll();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  annotationGesture.abortAll();
  useWorkspaceStore.setState(initialState, true);
});

describe('CpPropertiesPanel', () => {
  it('says what to do with nothing selected, and marks itself a companion surface', () => {
    mount({});
    expect(text('.empty-note')).toBe('Select an object on the canvas to edit its properties.');
    const section = host?.querySelector('.cp-properties-panel');
    expect(section?.hasAttribute('data-cp-companion')).toBe(true);
    expect(section?.getAttribute('tabindex')).toBe('-1');
  });

  it('shows an image sheet with its natural size and edits opacity as one entry', () => {
    mount({ oristudioCpSelectedAnnotationId: IMAGE.id });
    expect(text('.property-sheet__title')).toBe('Image');
    expect(text('.property-sheet__subtitle')).toBe('10 × 10');
    expect(labels()).toEqual(['Opacity', 'Rotation']);

    const slider = host?.querySelector<HTMLInputElement>('input[aria-label="Opacity"]');
    if (!slider) throw new Error('no slider');
    setRange(slider, '0.5', 'input');
    setRange(slider, '0.25', 'input');
    expect(useWorkspaceStore.getState().oristudioCpAnnotations[0]?.opacity).toBe(0.25);
    // Mid-drag: the bracket is open, nothing recorded yet.
    expect(annotationGesture.openOwner()).toBe('pane:opacity');
    const before = useWorkspaceStore.getState().oristudioCpHistoryPast.length;
    setRange(slider, '0.25', 'change');
    expect(annotationGesture.openOwner()).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast.length).toBe(before + 1);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast.at(-1)?.label).toBe('Adjust opacity');
  });

  it('shows a text sheet and aligns an idle box as one entry', async () => {
    mount({ oristudioCpSelectedAnnotationId: TEXT.id });
    expect(text('.property-sheet__title')).toBe('Text');
    expect(labels()).toEqual(['Alignment', 'Text style', 'Text color', 'Size', 'Opacity']);
    const center = [...(host?.querySelectorAll<HTMLButtonElement>('.segmented__option') ?? [])].find(
      (button) => button.getAttribute('aria-label') === 'Align center'
    );
    const before = useWorkspaceStore.getState().oristudioCpHistoryPast.length;
    await act(async () => center?.click());
    const box = useWorkspaceStore
      .getState()
      .oristudioCpAnnotations.find((annotation) => annotation.id === TEXT.id);
    if (!box || box.kind !== 'text') throw new Error('no text box');
    expect(textDocSummary(box.doc).align).toBe('center');
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast.length).toBe(before + 1);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast.at(-1)?.label).toBe(
      'Change text alignment'
    );
  });

  it('shows a region sheet and toggles a suppressed check as one entry', async () => {
    mount({ oristudioCpSelectedAnnotationId: REGION.id });
    expect(text('.property-sheet__title')).toBe('Suppression region');
    expect(labels()).toEqual([
      'Opacity',
      'Kawasaki (angles)',
      'Big-little-big',
      'Maekawa (parity)',
      'Vertex closure',
    ]);
    const switches = [...(host?.querySelectorAll<HTMLButtonElement>('[role="switch"]') ?? [])];
    const maekawa = switches[2];
    const wasOn = maekawa?.getAttribute('aria-checked') === 'true';
    const before = useWorkspaceStore.getState().oristudioCpHistoryPast.length;
    // The verb records after a microtask (`run` awaits the act before it commits).
    await act(async () => maekawa?.click());
    const region = useWorkspaceStore
      .getState()
      .oristudioCpAnnotations.find((annotation) => annotation.id === REGION.id);
    expect(region && 'suppress' in region && region.suppress.includes('maekawa')).toBe(!wasOn);
    expect(useWorkspaceStore.getState().oristudioCpHistoryPast.length).toBe(before + 1);
  });

  it('shows a folded figure sheet with its title and status', () => {
    mount({ oristudioCpActiveFoldedFigureId: FIGURE.id });
    expect(text('.property-sheet__title')).toBe(FIGURE.title);
    expect(text('.property-sheet__subtitle')).toBe('Folding…');
    expect(labels()).toEqual([
      'Render as',
      'Side',
      'Front color',
      'Back color',
      'Line color',
      'Shadow',
      'Scale',
      'Rotation',
    ]);
    // Not ready: the appearance is offered, disabled, with the reason; the
    // placement — where it sits — stays editable.
    expect(host?.querySelector('.control-row')?.getAttribute('title')).toBe(
      'Refold to change how this figure looks'
    );
    const scale = host?.querySelector<HTMLInputElement>('input[aria-label="Scale"]');
    expect(scale?.disabled).toBe(false);
  });

  it('shows the shared simulator settings for a window and writes them app-wide', () => {
    mount({ oristudioCpFocusedInlineSimulationId: WINDOW.id });
    expect(text('.property-sheet__title')).toBe('Simulation window');
    expect(text('.collapsible-section__hint')).toBe(
      'Shared with the Simulate workspace and every window'
    );
    const edges = [...(host?.querySelectorAll<HTMLButtonElement>('[role="switch"]') ?? [])].find(
      (candidate) => candidate.getAttribute('aria-label') === 'Crease lines'
    );
    const before = useWorkspaceStore.getState().simulatorSettings.showEdges;
    act(() => edges?.click());
    expect(useWorkspaceStore.getState().simulatorSettings.showEdges).toBe(!before);
  });

  it('follows the selection from one object to another', () => {
    mount({ oristudioCpSelectedAnnotationId: IMAGE.id });
    expect(text('.property-sheet__title')).toBe('Image');
    act(() =>
      useWorkspaceStore.setState({
        oristudioCpSelectedAnnotationId: null,
        oristudioCpFocusedInlineSimulationId: WINDOW.id,
      })
    );
    expect(text('.property-sheet__title')).toBe('Simulation window');
    act(() => useWorkspaceStore.setState({ oristudioCpFocusedInlineSimulationId: null }));
    expect(host?.querySelector('.empty-note')).not.toBeNull();
  });
});
