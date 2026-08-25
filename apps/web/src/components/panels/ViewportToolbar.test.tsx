import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Plus } from 'lucide-react';
import { TooltipProvider } from '../ui/Tooltip';
import {
  isViewportInteractiveTarget,
  ViewportToolbar,
  viewportLayerItems,
  viewportSymmetryItems,
  type ViewportToolbarGroupSpec,
} from './ViewportToolbar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Radix positions its portalled menu with floating-ui, which measures. None of
 * that exists in jsdom, and none of it is what these tests are about — the
 * subject is which controls end up where, and what the menu says they are.
 * Widths are only meaningful on a device (see the coarse-pointer block in
 * `theme.css`), so nothing here asserts one.
 */
function stubLayoutApis() {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('DOMRect', class {});
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

let coarse = false;

function stubPointer(initial: boolean) {
  coarse = initial;
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      get matches() {
        return query.includes('pointer: coarse') ? coarse : false;
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const camera = {
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  fitToView: vi.fn(),
  setZoomLevel: vi.fn(),
  togglePanTool: vi.fn(),
  rotateView: vi.fn(),
  setViewRotation: vi.fn(),
  resetViewRotation: vi.fn(),
  onLayerChange: vi.fn(),
  onToggleSymmetry: vi.fn(),
  onInsertImage: vi.fn(),
};

/** The crease-pattern surface's declaration, which is the widest of the four. */
function cpGroups(): ViewportToolbarGroupSpec[] {
  return [
    {
      id: 'image',
      items: [
        {
          kind: 'action',
          id: 'insert-image',
          label: 'Insert image...',
          icon: <Plus size={14} />,
          onSelect: camera.onInsertImage,
        },
      ],
    },
    {
      id: 'symmetry',
      items: viewportSymmetryItems({
        enabled: false,
        label: 'Symmetry',
        title: 'Mirror draw',
        onToggle: camera.onToggleSymmetry,
      }),
    },
    {
      id: 'layers',
      items: viewportLayerItems({
        title: 'Layers',
        options: [{ key: 'labels' as const, icon: null, label: 'Labels' }],
        visible: { labels: true },
        onChange: camera.onLayerChange,
      }),
    },
  ];
}

function render(props: { panToolActive?: boolean; viewRotation?: number } = {}) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <TooltipProvider>
        <ViewportToolbar
          ariaLabel="Viewport controls"
          zoomPercent={100}
          zoomIn={camera.zoomIn}
          zoomOut={camera.zoomOut}
          fitToView={camera.fitToView}
          setZoomLevel={camera.setZoomLevel}
          panToolActive={props.panToolActive ?? false}
          togglePanTool={camera.togglePanTool}
          viewRotation={props.viewRotation ?? 0}
          rotateView={camera.rotateView}
          setViewRotation={camera.setViewRotation}
          resetViewRotation={camera.resetViewRotation}
          groups={cpGroups()}
        />
      </TooltipProvider>
    )
  );
}

const toolbar = () => container?.querySelector<HTMLElement>('.viewport-toolbar');
const overflowTrigger = () =>
  container?.querySelector<HTMLButtonElement>('button[aria-label="More view controls"]');

/** Accessible names of the bar's own buttons, ignoring the portalled menu. */
function inlineLabels(): string[] {
  return [...(toolbar()?.querySelectorAll('button') ?? [])].map(
    (button) => button.getAttribute('aria-label') ?? button.textContent ?? ''
  );
}

function menuItems(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[role="menu"] [role^="menuitem"]')];
}

function press(element: Element | null | undefined) {
  act(() => {
    element?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 }));
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach(() => {
  stubLayoutApis();
  stubPointer(false);
  for (const fn of Object.values(camera)) fn.mockClear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('isViewportInteractiveTarget', () => {
  it('claims controls that own their keystrokes', () => {
    const host = document.createElement('div');
    host.innerHTML =
      '<button></button><input /><textarea></textarea><select></select><div contenteditable="true"></div>';
    document.body.append(host);
    for (const el of host.children) expect(isViewportInteractiveTarget(el)).toBe(true);
  });

  it('claims anything inside an open menu, wherever it is portalled', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div role="menu"><span id="row">Pan</span></div>';
    document.body.append(host);
    expect(isViewportInteractiveTarget(host.querySelector('#row'))).toBe(true);
  });

  it('leaves plain viewport chrome alone', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="canvas"></div>';
    document.body.append(host);
    expect(isViewportInteractiveTarget(host.firstElementChild)).toBe(false);
    expect(isViewportInteractiveTarget(null)).toBe(false);
  });
});

describe('ViewportToolbar on a fine pointer', () => {
  it('renders every control on the bar, and no overflow trigger', () => {
    render();
    expect(inlineLabels()).toEqual([
      'Zoom Out',
      '100%',
      'Zoom In',
      'Fit',
      'Pan',
      'Rotate view left',
      'Rotate view right',
      'Insert image...',
      'Symmetry',
      'Layers',
    ]);
    expect(overflowTrigger()).toBeFalsy();
  });

  it('keeps the editable rotation readout, and leaves the reset off the bar', () => {
    render({ viewRotation: Math.PI / 8 });
    const field = toolbar()?.querySelector<HTMLInputElement>('.viewport-toolbar__rotation-input');
    expect(field?.value).toBe('22.5°');
    expect(inlineLabels()).not.toContain('Reset view rotation');
  });

  /**
   * On `pointerdown`, not `mousedown`: the crease-pattern canvas cancels
   * `pointerdown` on nearly every press, and a canceled one suppresses the
   * compatibility mouse events a touch would otherwise produce — so a bar
   * popover listening for `mousedown` could not be put away by tapping the
   * paper.
   */
  it('dismisses the zoom presets on a press outside the readout', () => {
    render();
    press(toolbar()?.querySelector('.viewport-toolbar__zoom-button'));
    expect(toolbar()?.querySelector('.viewport-toolbar__dropdown')).toBeTruthy();
    act(() => {
      document.body.dispatchEvent(
        new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 })
      );
    });
    expect(toolbar()?.querySelector('.viewport-toolbar__dropdown')).toBeFalsy();
  });

  it('draws a hairline between groups and never at an end', () => {
    render();
    const kinds = [...(toolbar()?.children ?? [])].map((child) =>
      child.classList.contains('viewport-toolbar__separator') ? '|' : 'group'
    );
    expect(kinds[0]).toBe('group');
    expect(kinds[kinds.length - 1]).toBe('group');
    expect(kinds.join(' ')).not.toContain('| |');
  });
});

describe('ViewportToolbar on a coarse pointer', () => {
  beforeEach(() => stubPointer(true));

  it('leaves only the controls no gesture replaces on the bar', () => {
    render();
    expect(inlineLabels()).toEqual([
      'Zoom Out',
      '100%',
      'Zoom In',
      'Fit',
      'More view controls',
    ]);
    expect(toolbar()?.querySelector('.viewport-toolbar__rotation-input')).toBeFalsy();
  });

  it('offers everything it took away, as menu items', () => {
    render();
    press(overflowTrigger());
    expect(menuItems().map((item) => item.textContent)).toEqual([
      'Pan',
      'Rotate view left',
      'Rotate view right',
      'Reset view rotation',
      'Insert image...',
      'Symmetry',
      'Labels',
    ]);
  });

  it('gives a mode a checkbox role and a verb a plain one', () => {
    render();
    press(overflowTrigger());
    const roles = Object.fromEntries(
      menuItems().map((item) => [item.textContent, item.getAttribute('role')])
    );
    expect(roles['Pan']).toBe('menuitemcheckbox');
    expect(roles['Labels']).toBe('menuitemcheckbox');
    expect(roles['Rotate view left']).toBe('menuitem');
    expect(roles['Insert image...']).toBe('menuitem');
  });

  it('runs the action the menu item stands for', () => {
    render();
    press(overflowTrigger());
    const insert = menuItems().find((item) => item.textContent === 'Insert image...');
    press(insert);
    expect(camera.onInsertImage).toHaveBeenCalledTimes(1);
  });

  it('closes the menu once an item has run', () => {
    render();
    press(overflowTrigger());
    expect(menuItems().length).toBeGreaterThan(0);
    press(menuItems().find((item) => item.textContent === 'Insert image...'));
    expect(menuItems()).toEqual([]);
  });

  /**
   * A verb is done when it has run; a mode is one of a run of them. The packing
   * pane puts twelve layer toggles in here, and a menu that closed on each would
   * cost twelve reopenings to set three.
   */
  it('stays open while a mode is toggled', () => {
    render();
    press(overflowTrigger());
    press(menuItems().find((item) => item.textContent === 'Labels'));
    expect(camera.onLayerChange).toHaveBeenCalledTimes(1);
    expect(menuItems().map((item) => item.textContent)).toContain('Labels');
  });

  it('disables the rotation reset only while the view is square', () => {
    render({ viewRotation: 0 });
    press(overflowTrigger());
    const reset = () => menuItems().find((item) => item.textContent === 'Reset view rotation');
    expect(reset()?.getAttribute('data-disabled')).not.toBeNull();

    act(() => root?.unmount());
    container?.remove();
    render({ viewRotation: Math.PI / 8 });
    press(overflowTrigger());
    expect(reset()?.getAttribute('data-disabled')).toBeNull();
  });

  /**
   * The one real risk in collapsing controls: the pan tool changes what a drag
   * on the canvas does and nothing else on screen says so, so a mode that is on
   * must never be invisible.
   */
  it('marks the trigger while a hidden mode is on, and checks the item', () => {
    render({ panToolActive: false });
    expect(overflowTrigger()?.dataset.active).toBeUndefined();

    act(() => root?.unmount());
    container?.remove();
    render({ panToolActive: true });
    expect(overflowTrigger()?.dataset.active).toBe('true');
    press(overflowTrigger());
    const pan = menuItems().find((item) => item.textContent === 'Pan');
    expect(pan?.getAttribute('aria-checked')).toBe('true');
  });

  it('follows the pointer changing under a live app', () => {
    stubPointer(false);
    render();
    expect(overflowTrigger()).toBeFalsy();
    expect(inlineLabels()).toContain('Pan');
  });
});
