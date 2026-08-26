import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkspaceStore } from '../../store/workspaceStore';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { cpActionByOperation } from '../../lib/oristudioCpActions';
import type {
  OristudioCpCommandPayload,
  OristudioCpDocumentState,
} from '../../engine/oristudioCpTypes';
import type { OristudioCpOperationId } from '../../lib/oristudioCpCommands';
import { TooltipProvider } from '../ui/Tooltip';
import { CreasePatternPanel } from './CreasePatternPanel';

/**
 * The selection reaches propagation's scope — through the panel, not around it.
 *
 * Everything either side of this seam is covered elsewhere: `usePropagationDraft`
 * has its own tests for what it sends and holds, and the kernel has its own for
 * what a scope means. What has no other cover is the *connection* — one prop
 * carrying the selection into the hook, and one button routing to `begin(null)`.
 * Both are single lines that can be deleted with every hook test still green,
 * and the feature would then be silently unreachable: the tool would keep
 * working by click, so nothing would look broken.
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

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let previewCalls: { operationId: OristudioCpOperationId; payload: OristudioCpCommandPayload }[] = [];

function mountWithSelection(lines: number[]): void {
  previewCalls = [];
  useWorkspaceStore.setState({
    activePanelId: 'crease-pattern',
    oristudioCpDocument: DOCUMENT,
    oristudioCpFoldRuns: {},
    oristudioCpSelection: { ...emptyOristudioCpSelection(), lines },
    oristudioCpActiveToolId: cpActionByOperation('PropagateFoldAngles')?.id,
    previewOristudioCpCommand: vi.fn(async (operationId, payload) => {
      previewCalls.push({ operationId, payload });
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
}

function applyButton(): HTMLButtonElement | null {
  return document.querySelector<HTMLButtonElement>('.cp-context-panel__apply');
}

// The hint window the button lives in refuses to render against a 0x0 rect —
// deliberately, so it never parks itself in the corner of the screen — and every
// rect is 0x0 in jsdom. Give the layout a size so the window has somewhere to be.
const measure = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  vi.clearAllMocks();
  Element.prototype.getBoundingClientRect = function rect(this: Element): DOMRect {
    return { x: 0, y: 0, top: 0, left: 0, right: 800, bottom: 600, width: 800, height: 600, toJSON: () => ({}) } as DOMRect;
  };
});

afterEach(() => {
  Element.prototype.getBoundingClientRect = measure;
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('propagation’s Apply button', () => {

  it('previews the selection as the scope, with no seed', () => {
    mountWithSelection([2, 5]);
    const button = applyButton();
    expect(button).not.toBeNull();
    expect(button?.disabled).toBe(false);

    act(() => button?.click());

    expect(previewCalls).toHaveLength(1);
    expect(previewCalls[0].operationId).toBe('PropagateFoldAngles');
    // The selection, one-based and unchanged. There is no click to send: the
    // scope is stated by what is selected.
    expect(previewCalls[0].payload.line_ids).toEqual([2, 5]);
    expect(previewCalls[0].payload.points).toBeUndefined();
  });

  it('is offered but refused with nothing selected', () => {
    // The click route still works, so the button must not become a second way
    // to ask for a scope the kernel declines.
    mountWithSelection([]);

    expect(applyButton()?.disabled).toBe(true);
  });
});
