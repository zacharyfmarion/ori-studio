import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectSelection } from '../../store/workspaceStore/designTabs';
import { installAppKeyboardListener } from '../../lib/appKeyboard';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import type { OristudioCpFoldRun } from '../../store/workspaceStore/types';
import { TooltipProvider } from '../ui/Tooltip';
import { CreasePatternPanel } from './CreasePatternPanel';

/**
 * Escape stops a running fold — through the whole path a keypress really takes.
 *
 * Deliberately not a test of `cancelActiveCpInput` in isolation. Escape is the
 * most overloaded key in the app: `viewport.cancel` claims it, the crease-pattern
 * surface answers `true` for it unconditionally, and viewport scope resolves
 * before every other. A rung added anywhere else in that ladder is *permanently
 * dead* and no conflict check reports it — so the only test worth writing mounts
 * the real panel, installs the real document listener, and dispatches a real
 * key.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DOCUMENT = {
  handle: 4,
  loadSerial: 1,
  document: createStarterOristudioCpDocument(),
  geometry: null,
  summary: null,
  source: { format: 'cp', filename: 'Untitled.cp', path: null },
} as unknown as OristudioCpDocumentState;

function run(patch: Partial<OristudioCpFoldRun> = {}): OristudioCpFoldRun {
  return {
    runId: 9,
    kind: 'fold',
    startedAt: Date.now(),
    cancellable: true,
    stopping: false,
    ...patch,
  };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let uninstall: (() => void) | null = null;

function pressEscape(): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    );
  });
}

beforeEach(() => {
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: DOCUMENT,
    oristudioCpFoldRuns: {},
    oristudioCpSelection: { ...emptyOristudioCpSelection(), lines: [1, 2] },
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
  uninstall = installAppKeyboardListener({
    getActiveEditingContext: () => 'crease-pattern',
    getSelection: () => selectSelection(useWorkspaceStore.getState()),
    handleMenuAction: () => undefined,
    selectNone: () => undefined,
  });
});

afterEach(() => {
  uninstall?.();
  uninstall = null;
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('Escape while a fold is running', () => {
  it('stops the fold', () => {
    useWorkspaceStore.setState({ oristudioCpFoldRuns: { 9: run() } });

    pressEscape();

    // The run says a stop was written for it, which is the observable half of
    // `cancelFoldRun` — the other half is the shared slot, and that is
    // `foldCancellation.test.ts`'s.
    expect(useWorkspaceStore.getState().oristudioCpFoldRuns[9]?.stopping).toBe(true);
    // The rung is above the selection rung, and stops there: one Escape does one
    // thing. Losing the selection as well would take the creases the user is
    // about to fold again.
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([1, 2]);
  });

  it('stops it even when the panel is showing nothing editable', () => {
    // Why the rung sits *above* `if (!editableCp) return;` and nothing else in
    // that ladder does. A fold takes minutes, and the document under it can stop
    // being the editable one in that time; below the guard this rung would be
    // silently dead exactly then.
    act(() => {
      useWorkspaceStore.setState({
        oristudioCpDocument: null,
        oristudioCpFoldRuns: { 9: run() },
      });
    });

    pressEscape();

    expect(useWorkspaceStore.getState().oristudioCpFoldRuns[9]?.stopping).toBe(true);
  });

  it('falls through to the rest of the ladder when no fold is running', () => {
    pressEscape();

    // Nothing to stop, so Escape means what it has always meant here.
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);
  });

  it('falls through when the running fold cannot be stopped', () => {
    // The un-isolated browser again: there is no Stop on screen, so Escape must
    // not silently behave as though there were.
    useWorkspaceStore.setState({ oristudioCpFoldRuns: { 9: run({ cancellable: false }) } });

    pressEscape();

    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);
  });
});
