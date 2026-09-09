import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '../../components/ui/Tooltip';
import { cpActionByOperation } from '../../lib/oristudioCpActions';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { RegionRepairToolMenu } from './RegionRepairToolMenu';

/**
 * The solve chip's repair-tool menu: which tools it offers, that each is drawn
 * with the glyph its rail button carries, and that the armed one is ticked.
 *
 * The glyph is the point of the assertion. It is what ties a row here to the
 * rail button for the same tool, and it lives in the leading slot rather than
 * sharing it with the tick — sharing hides the glyph on exactly the tool that is
 * armed, which is the row someone is most likely to be looking at.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

let container: HTMLDivElement;
let root: Root;

function open(): void {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <TooltipProvider>
        <RegionRepairToolMenu />
      </TooltipProvider>
    )
  );
  const trigger = document.querySelector('button');
  act(() => trigger?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })));
}

/** Menu content portals to `body`, so read the rows from there. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.context-menu__item')];
}

beforeEach(() => {
  useWorkspaceStore.setState({ oristudioCpActiveToolId: null });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('the solve chip repair-tool menu', () => {
  it('offers pin and move, in the order the repair loop uses them', () => {
    open();
    expect(rows().map((row) => row.textContent)).toEqual(['Pin Vertex', 'Move Vertex']);
  });

  it('draws each tool with a glyph, armed or not', () => {
    useWorkspaceStore.setState({
      oristudioCpActiveToolId: cpActionByOperation('VertexMove')?.id ?? null,
    });
    open();
    for (const row of rows()) {
      expect(
        row.querySelector('.context-menu__icon svg'),
        `${row.textContent ?? ''} has no glyph`
      ).not.toBeNull();
    }
  });

  it('ticks the armed tool and only that one', () => {
    useWorkspaceStore.setState({
      oristudioCpActiveToolId: cpActionByOperation('VertexPin')?.id ?? null,
    });
    open();
    const checked = rows().filter((row) => row.getAttribute('data-state') === 'checked');
    expect(checked.map((row) => row.textContent)).toEqual(['Pin Vertex']);
  });

  it('arms the tool through the store request channel', () => {
    // The same channel the menu bar and the command palette use, so a tool
    // reached from here is armed exactly as a rail click would arm it.
    open();
    act(() => rows()[0]?.click());
    expect(useWorkspaceStore.getState().oristudioCpActionRequest?.operationId).toBe('VertexPin');
  });
});
