import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '../store/layoutStore';
import { useBpLongPressInspector } from './useBpLongPressInspector';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialLayoutState = useLayoutStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function pointerEvent(
  type: string,
  init: MouseEventInit & { pointerId?: number; pointerType?: string } = {},
): PointerEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, ...init }) as PointerEvent;
  Object.defineProperty(event, 'pointerId', { configurable: true, value: init.pointerId ?? 1 });
  Object.defineProperty(event, 'pointerType', {
    configurable: true,
    value: init.pointerType ?? 'touch',
  });
  return event;
}

function renderHarness(activatePanel = vi.fn()) {
  useLayoutStore.setState({ ...initialLayoutState, activatePanel }, true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);

  function Harness() {
    const scheduleLongPressInspector = useBpLongPressInspector();
    return (
      <button type="button" onPointerDown={(event) => scheduleLongPressInspector(event)}>
        target
      </button>
    );
  }

  act(() => {
    root?.render(<Harness />);
  });
  return activatePanel;
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  root = null;
  container?.remove();
  container = null;
  vi.useRealTimers();
  useLayoutStore.setState(initialLayoutState, true);
});

describe('useBpLongPressInspector', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('activates the inspector after a touch long press', () => {
    const activatePanel = renderHarness();
    const target = container?.querySelector('button');

    act(() => {
      target?.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
      vi.advanceTimersByTime(519);
    });
    expect(activatePanel).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(activatePanel).toHaveBeenCalledWith('inspector');
  });

  it('cancels when the pointer moves beyond the touch threshold', () => {
    const activatePanel = renderHarness();
    const target = container?.querySelector('button');

    act(() => {
      target?.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
      window.dispatchEvent(pointerEvent('pointermove', { clientX: 28, clientY: 10 }));
      vi.advanceTimersByTime(600);
    });

    expect(activatePanel).not.toHaveBeenCalled();
  });

  it('cancels when the pointer is released before the long press completes', () => {
    const activatePanel = renderHarness();
    const target = container?.querySelector('button');

    act(() => {
      target?.dispatchEvent(pointerEvent('pointerdown', { clientX: 10, clientY: 10 }));
      window.dispatchEvent(pointerEvent('pointerup', { clientX: 10, clientY: 10 }));
      vi.advanceTimersByTime(600);
    });

    expect(activatePanel).not.toHaveBeenCalled();
  });
});
