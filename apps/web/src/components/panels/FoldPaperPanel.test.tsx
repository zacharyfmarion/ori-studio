import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { valleyAt } from '../../fold/document/foldSequence.fixtures';
import { useFoldImportUiStore } from '../../fold/io/foldImportUiStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { FoldPaperPanel } from './FoldPaperPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

const state = () => useWorkspaceStore.getState();
const paper = () => state().foldSequences[0]?.document.paper;

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root.render(
      <TooltipProvider>
        <FoldPaperPanel />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useFoldImportUiStore.getState().close();
});

/** A segmented control's option, by its group and its name, as `FoldPaperPane.test.tsx` finds them. */
const segment = (group: string, name: string) =>
  host.querySelector<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button[aria-label="${name}"]`) ??
  [...host.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button`)].find(
    (element) => element.textContent?.trim() === name
  );
const pressed = (group: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button`)]
    .filter((element) => element.getAttribute('aria-pressed') === 'true')
    .map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim());
const button = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('button')].find((element) => element.textContent?.trim() === name);
/** The Shape row's text, as `FoldPaperPane.test.tsx` reads it. */
const shapeShown = () =>
  [...host.querySelectorAll('*')]
    .find((element) => element.textContent?.trim().startsWith('Shape') && element.children.length >= 2)
    ?.textContent?.replace(/^Shape/, '')
    .trim() ?? null;

describe('the Fold Paper pane', () => {
  it('shows the square a project with no sequence starts from, front up', () => {
    expect(shapeShown()).toBe('Square');
    expect(pressed('Start')).toEqual(['Front up']);
  });

  it('turns the sheet over as one undo step, keeping the steps', () => {
    act(() => {
      state().commitFoldStep({ parent: null, op: valleyAt(0.5) });
    });
    act(() => segment('Start', 'Back up')?.click());
    expect(paper()?.startSide).toBe('back');
    expect(state().foldSequences[0]?.document.steps).toHaveLength(1);
    expect(pressed('Start')).toEqual(['Back up']);
  });

  it('says a new sheet starts over, and opens Import CP’s dialog in its sheet mode, changing nothing yet', () => {
    act(() => {
      state().commitFoldStep({ parent: null, op: valleyAt(0.5) });
    });
    expect(host.textContent).toContain('A new starting sheet starts over');
    act(() => button('Import starting sheet…')?.click());
    expect(useFoldImportUiStore.getState().opening).toMatchObject({ mode: 'sheet', request: null });
    expect(paper()?.shape).toEqual({ kind: 'square' });
    expect(state().foldSequences[0]?.document.steps).toHaveLength(1);
  });
});
