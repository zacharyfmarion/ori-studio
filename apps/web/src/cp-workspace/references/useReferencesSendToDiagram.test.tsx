import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagram, createStep, insertSteps } from '../../diagram/document/diagramDocument';
import { referencesPlan } from '../../diagram/document/referencesSteps.fixtures';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { Diagram } from './referenceFinder/solution';
import type { SheetAnalysis } from './sheetFrames';
import {
  useReferencesSendToDiagram,
  type ReferencesSendToDiagram,
  type ReferencesSendToDiagramInput,
} from './useReferencesSendToDiagram';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const pipeline = vi.hoisted(() => ({ sendReferencesToDiagram: vi.fn(async () => ({ status: 'sent' })) }));
vi.mock('../../diagram/capture/sendReferencesSteps', () => pipeline);
const toasts = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn() }));
vi.mock('sonner', () => ({ toast: toasts }));

const FRAMES = {
  components: [
    { id: 2, outline: [[0, 0], [1, 0], [1, 1], [0, 1]] },
    { id: 5, outline: [[2, 0], [3, 0], [3, 1], [2, 1]] },
  ],
} as unknown as SheetAnalysis;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: ReferencesSendToDiagram | null = null;

function Probe(input: ReferencesSendToDiagramInput) {
  const result = useReferencesSendToDiagram(input);
  useEffect(() => {
    latest = result;
  });
  return null;
}

function mount(patch: Partial<ReferencesSendToDiagramInput> = {}) {
  const plan = referencesPlan();
  const input: ReferencesSendToDiagramInput = {
    strip: plan.strip,
    viewSteps: plan.viewSteps,
    variants: plan.variants,
    activeStep: 1,
    mode: 'sequence',
    frames: FRAMES,
    sheetId: 5,
    settings: { precreaseGrid: true, gridWhereNeeded: true, allowDanglingFolds: true, mergeSymmetricSteps: true },
    stale: false,
    ...patch,
  };
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() => root!.render(<Probe {...input} />));
  return input;
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  latest = null;
});

describe('useReferencesSendToDiagram', () => {
  it('sends the card on show with the sheet the strip is for', async () => {
    const input = mount();
    expect(latest!.state).toEqual({ canSend: true, canSendAll: true, waitingStep: null });
    await act(async () => latest!.actions.sendToDiagram());
    await vi.waitFor(() => expect(pipeline.sendReferencesToDiagram).toHaveBeenCalledOnce());
    expect(pipeline.sendReferencesToDiagram).toHaveBeenCalledWith(
      expect.objectContaining({
        outline: FRAMES.components[1]!.outline,
        mode: 'sequence',
        settings: input.settings,
        via: 'one',
        cards: [expect.objectContaining({ sentence: input.strip[1]!.sentence })],
      })
    );
  });

  it('sends every card but the ending', async () => {
    const input = mount();
    await act(async () => latest!.actions.sendAllToDiagram());
    await vi.waitFor(() => expect(pipeline.sendReferencesToDiagram).toHaveBeenCalledOnce());
    const [send] = pipeline.sendReferencesToDiagram.mock.calls[0] as unknown as [{ cards: unknown[]; via: string }];
    expect(send.via).toBe('all');
    expect(send.cards).toHaveLength(input.strip.filter((row) => row.kind !== 'done').length);
  });

  it('holds both verbs, saying why, for a stale answer or a read-only diagram', () => {
    mount({ stale: true });
    expect(latest!.state).toMatchObject({ canSend: false, canSendAll: false, hint: expect.stringContaining('recompute') });
    useWorkspaceStore.setState({ diagramReadOnly: true });
    mount();
    expect(latest!.state).toMatchObject({ canSend: false, hint: expect.stringContaining('read-only') });
  });

  it('cannot send without a sheet to link to', () => {
    mount({ sheetId: 9 });
    expect(latest!.state).toMatchObject({ canSend: false, canSendAll: false });
  });

  it('names the step From References… waits for', () => {
    const diagram = insertSteps(createDiagram({ title: 'T' }), [createStep(() => 'step-a'), createStep(() => 'step-b')], 0);
    useWorkspaceStore.setState({ diagram, diagramReferencesTarget: 'step-b' });
    mount();
    expect(latest!.state.waitingStep).toBe(2);
  });

  it('says so and sends nothing when ReferenceFinder’s diagram does not read', async () => {
    const unreadable = [{ type: 9 }] as unknown as Diagram;
    const row = { key: 'rf-1', kind: 'fold' as const, badge: '', number: 1, diagram: unreadable, primitives: null, mirrored: false, sentence: 'Fold.', ways: null };
    mount({ strip: [row], viewSteps: [], variants: [], activeStep: 0, mode: 'find', settings: null });
    await act(async () => latest!.actions.sendToDiagram());
    expect(toasts.error).toHaveBeenCalledWith('This step’s picture couldn’t be read, so nothing was sent.');
    expect(pipeline.sendReferencesToDiagram).not.toHaveBeenCalled();
  });
});
