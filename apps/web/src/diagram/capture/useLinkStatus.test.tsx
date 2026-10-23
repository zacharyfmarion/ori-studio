import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sequenceOf, step, valleyAt } from '../../fold/document/foldSequence.fixtures';
import type { FoldSequenceDocument } from '../../fold/document/foldSequenceDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramStep } from '../document/diagramDocument';
import { foldStepStep } from '../document/diagramSteps.fixtures';

/**
 * Whether the Diagram holds the Fold session for its links (plan D17): the
 * session starts the engine and replays, so it is held only for a link the
 * replay can tell. The context hook is stubbed to record what it is asked.
 */
const asked = vi.hoisted(() => ({ wants: [] as boolean[] }));
vi.mock('../fold/useFoldLinkContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../fold/useFoldLinkContext')>()),
  useFoldLinkContext: (wants: boolean) => {
    asked.wants.push(wants);
    return { sequences: useWorkspaceStore.getState().foldSequences, replay: null };
  },
}));

const { useDiagramLinkStatuses } = await import('./useLinkStatus');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SHOWN = sequenceOf([step('fstep-1', null, valleyAt(0.5)), step('fstep-2', 'fstep-1', valleyAt(0.25))]);
const OTHER = sequenceOf(SHOWN.steps, undefined, 'fold-other');

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** Each step's status, as the cards show it. */
function Probe({ steps }: { steps: readonly DiagramStep[] }) {
  const statuses = useDiagramLinkStatuses(steps);
  return (
    <>
      {steps.map((step) => (
        <output key={step.id} data-step-id={step.id} data-status={statuses.get(step.id)} />
      ))}
    </>
  );
}

const statusOf = (stepId: string) => host?.querySelector<HTMLElement>(`[data-step-id="${stepId}"]`)?.dataset.status;

function render(steps: readonly DiagramStep[], sequences: readonly FoldSequenceDocument[]) {
  useWorkspaceStore.setState({ foldSequences: sequences.map((document) => ({ document })) as never });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Probe steps={steps} />));
  return asked.wants.at(-1);
}

beforeEach(() => {
  asked.wants = [];
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

const linked = (sequence: string, stepId = 'fstep-2') => [foldStepStep('s1', { sequence, step: stepId })];

describe('the Diagram’s hold on the Fold session (D17)', () => {
  it('holds it for a link to a step of the sequence Fold shows', () => {
    expect(render(linked(SHOWN.id), [SHOWN, OTHER])).toBe(true);
  });

  it.each([
    ['its sequence is gone', linked('fold-gone'), [SHOWN], 'missing'],
    ['its step is gone', linked(SHOWN.id, 'fstep-gone'), [SHOWN], 'missing'],
    ['its sequence is not the one Fold shows', linked(OTHER.id), [SHOWN, OTHER], 'unknown'],
    ['the project has no sequence', linked(SHOWN.id), [], 'missing'],
  ])('does not hold it when %s, and still tells the link', (_label, steps, sequences, status) => {
    expect(render(steps, sequences)).toBe(false);
    expect(statusOf('s1')).toBe(status);
  });
});
