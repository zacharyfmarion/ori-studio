import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReferencesStepWayChoice } from '../../diagram/references/useReferencesStepWays';
import { stepDiagramPicture } from '../../diagram/document/diagramSteps.fixtures';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramWayChooser, DiagramWayRow } from './DiagramWayChooser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<TooltipProvider>{node}</TooltipProvider>));
  return host;
}

function ready(current = 0) {
  const choose = vi.fn();
  const choice: ReferencesStepWayChoice = {
    status: 'ready',
    ways: ['a', 'b', 'c'].map((name) => ({ signature: name, picture: stepDiagramPicture(), sentence: `Fold ${name}.` })),
    current,
    choose,
  };
  return { choice, choose };
}

const buttons = (within: HTMLElement) => [...within.querySelectorAll<HTMLButtonElement>('button[aria-pressed]')];

describe('DiagramWayChooser', () => {
  it('offers each way by its number, the one shown pressed, and folds the one pressed', () => {
    const { choice, choose } = ready(1);
    const view = render(<DiagramWayChooser choice={choice} readOnly={false} />);
    const ways = buttons(view);
    expect(ways.map((button) => button.textContent)).toEqual(['1', '2', '3']);
    expect(ways.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(ways[0]!.title).toBe('Way 1 of 3: the planner’s pick');
    act(() => ways[2]!.click());
    expect(choose).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('chooses nothing in a read-only diagram, and shows nothing while the plan is read', () => {
    const { choice, choose } = ready();
    const view = render(<DiagramWayChooser choice={choice} readOnly />);
    act(() => buttons(view)[1]!.click());
    expect(choose).not.toHaveBeenCalled();
    act(() => root!.render(<TooltipProvider><DiagramWayChooser choice={{ status: 'loading' }} readOnly={false} /></TooltipProvider>));
    expect(buttons(view)).toHaveLength(0);
  });

  it('stays, refused and still focusable, when the step’s plan is gone', () => {
    const view = render(<DiagramWayChooser choice={{ status: 'unavailable' }} readOnly={false} />);
    const [way] = buttons(view);
    expect(way?.disabled).toBe(false);
    expect(way?.getAttribute('aria-disabled')).toBe('true');
  });
});

describe('DiagramWayRow', () => {
  it('is the Step pane’s row of the same ways, and says when they are gone', () => {
    const { choice, choose } = ready();
    const view = render(<DiagramWayRow choice={choice} readOnly={false} />);
    act(() => buttons(view)[1]!.click());
    expect(choose).toHaveBeenCalledExactlyOnceWith(1);
    act(() => root!.render(<TooltipProvider><DiagramWayRow choice={{ status: 'unavailable' }} readOnly={false} /></TooltipProvider>));
    expect(buttons(view)).toHaveLength(0);
    expect(view.textContent).toContain('Unavailable');
  });
});
