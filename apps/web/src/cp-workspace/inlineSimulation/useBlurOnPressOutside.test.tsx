import { act, useRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBlurOnPressOutside } from './useBlurOnPressOutside';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/**
 * The panel, plus the two surfaces a focused window owns from outside it. The
 * portaled ones are siblings of the panel here, exactly as they are in the app.
 */
function Harness({ active, onBlur }: { active: boolean; onBlur: () => void }): ReactNode {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useBlurOnPressOutside({ active, panelRef, onBlur });
  return (
    <>
      <div ref={panelRef} data-testid="panel">
        <canvas data-testid="canvas" />
      </div>
      {/* The inspector and its portalled menu both carry the companion
          attribute (FloatingToolbar sets it on its root) — see
          canvasCompanionSurface.ts. */}
      <div className="cp-inline-simulation-inspector" data-cp-companion="">
        <input data-testid="scrub" />
      </div>
      <div data-cp-companion="">
        <button data-testid="menu-item" />
      </div>
      {/* The Properties pane: another dock panel, marked the same way. */}
      <section className="cp-properties-panel" data-cp-companion="">
        <input data-testid="pane-row" />
      </section>
      <div data-testid="other-panel" />
    </>
  );
}

function press(testid: string) {
  const target = host?.querySelector(`[data-testid="${testid}"]`);
  expect(target, testid).not.toBeNull();
  act(() => {
    target?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
}

function render(active: boolean, onBlur: () => void) {
  act(() => {
    root?.render(<Harness active={active} onBlur={onBlur} />);
  });
}

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useBlurOnPressOutside', () => {
  it('blurs on a press outside the panel', () => {
    const onBlur = vi.fn();
    render(true, onBlur);
    press('other-panel');
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('leaves presses on the crease-pattern surface to the canvas', () => {
    // The canvas knows whether the press hit a crease, empty paper, or the
    // window's own resize handles; blurring from out here would fight it.
    const onBlur = vi.fn();
    render(true, onBlur);
    press('canvas');
    expect(onBlur).not.toHaveBeenCalled();
  });

  it('does not blur on the window’s own portaled controls', () => {
    const onBlur = vi.fn();
    render(true, onBlur);
    press('scrub');
    press('menu-item');
    expect(onBlur).not.toHaveBeenCalled();
  });

  it('keeps the window focused through a press in the Properties pane', () => {
    // The pane edits the focused window's settings; blurring on the press
    // that reaches for a row would empty the pane under the pointer.
    const onBlur = vi.fn();
    render(true, onBlur);
    press('pane-row');
    expect(onBlur).not.toHaveBeenCalled();
  });

  it('listens for nothing while no window is focused', () => {
    const onBlur = vi.fn();
    render(false, onBlur);
    press('other-panel');
    expect(onBlur).not.toHaveBeenCalled();
  });
});
