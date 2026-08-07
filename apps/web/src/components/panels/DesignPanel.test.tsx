import { patchTreemakerDesign, selectProject, selectSelection, singleDesignTab, singleTreemakerDesignTab } from '../../store/workspaceStore/designTabs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESIGN_PAPER_RECT } from '../../lib/designViewport';
import { handleShortcutRuntimeKeyDown } from '../../keyboard/shortcutRuntime';
import { createEmptyProject, createSampleProject, type TreeProject } from '../../lib/sampleProject';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DesignPanel } from './DesignPanel';

const transformMocks = vi.hoisted(() => ({
  centerView: vi.fn(),
  setTransform: vi.fn(),
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
}));

vi.mock('react-zoom-pan-pinch', async () => {
  const React = await import('react');
  type MockTransformWrapperProps = {
    children: React.ReactNode;
    onInit?: (ref: unknown) => void;
    onTransformed?: (ref: unknown, state: { scale: number }) => void;
  };
  const api = {
    centerView: transformMocks.centerView,
    setTransform: transformMocks.setTransform,
    zoomIn: transformMocks.zoomIn,
    zoomOut: transformMocks.zoomOut,
  };

  return {
    TransformWrapper: React.forwardRef<unknown, MockTransformWrapperProps>(
      function MockTransformWrapper({ children, onInit, onTransformed }, ref) {
        const didInitRef = React.useRef(false);
        React.useImperativeHandle(ref, () => api, []);
        React.useEffect(() => {
          if (didInitRef.current) return;
          didInitRef.current = true;
          onInit?.(api);
          onTransformed?.(api, { scale: 1 });
        }, [onInit, onTransformed]);
        return React.createElement('div', { 'data-testid': 'transform-wrapper' }, children);
      }
    ),
    TransformComponent: ({ children }: { children: React.ReactNode }) =>
      React.createElement('div', { 'data-testid': 'transform-component' }, children),
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});

function renderPanel(
  project: TreeProject = createSampleProject(),
  state: Partial<ReturnType<typeof useWorkspaceStore.getState>> = {}
) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      // These exercise the Circle-packed design pane. A fresh store has picked no
      // method, which is the method chooser — so say which pane is under test.
      ...singleTreemakerDesignTab({ project }),
      engineReady: true,
      ...state,
    },
    true
  );

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <DesignPanel />
      </TooltipProvider>
    );
  });

  const body = container.querySelector<HTMLElement>('.design-panel__body');
  if (!body) throw new Error('Design panel body did not render');
  Object.defineProperty(body, 'clientWidth', { configurable: true, value: 900 });
  Object.defineProperty(body, 'clientHeight', { configurable: true, value: 720 });
  transformMocks.centerView.mockClear();
  transformMocks.setTransform.mockClear();
}

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  transformMocks.centerView.mockClear();
  transformMocks.setTransform.mockClear();
  transformMocks.zoomIn.mockClear();
  transformMocks.zoomOut.mockClear();
  vi.unstubAllGlobals();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

function renderDesignPanel(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      // These exercise the Circle-packed design pane. A fresh store has picked no
      // method, which is the method chooser — so say which pane is under test.
      ...singleDesignTab('treemaker'),
      ...state,
    },
    true
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <MemoryRouter>
        <TooltipProvider>
          <DesignPanel />
        </TooltipProvider>
      </MemoryRouter>
    );
  });
}

describe('DesignPanel', () => {
  it('shows the tree-editor loading state while the treemaker engine is not ready', () => {
    renderDesignPanel({ engineReady: false, ...singleDesignTab('treemaker') });

    expect(container?.textContent).toContain('Preparing the tree editor');
    // The tree canvas itself does not render until the engine is ready.
    expect(container?.querySelector('.design-panel__body')).toBeNull();
  });

  it('shows a subtle nudge when the design tree is empty', () => {
    renderPanel(createEmptyProject());

    expect(container?.textContent).toContain('Sketch the tree behind your design');
    expect(container?.textContent).toContain('Use branches for the flaps, limbs, and features');
  });

  it('anchors the empty nudge to the paper inside the zoomable SVG canvas', () => {
    renderPanel(createEmptyProject());

    const emptyState = container?.querySelector<SVGForeignObjectElement>('foreignObject.design-empty-state');

    expect(emptyState).toBeTruthy();
    expect(emptyState?.closest('svg.design-canvas')).toBeTruthy();
    expect(emptyState?.getAttribute('x')).toBe(String(DESIGN_PAPER_RECT.x));
    expect(emptyState?.getAttribute('y')).toBe(String(DESIGN_PAPER_RECT.y));
    expect(emptyState?.getAttribute('width')).toBe(String(DESIGN_PAPER_RECT.width));
    expect(emptyState?.getAttribute('height')).toBe(String(DESIGN_PAPER_RECT.height));
  });

  it('hides the empty nudge once the design has nodes', () => {
    renderPanel();

    expect(container?.textContent).not.toContain('Sketch the tree behind your design');
  });

  it('fits the paper viewport after scale optimization requests a design fit', () => {
    renderPanel();
    const project = selectProject(useWorkspaceStore.getState());

    act(() => {
      const state = useWorkspaceStore.getState();
      // Patch the design in place rather than reseeding a tab: a new tab is a
      // new design id, which remounts the surface and throws away the viewport
      // this is asserting on.
      useWorkspaceStore.setState({
        ...patchTreemakerDesign(state, {
          project: { ...project, scale: 1 },
          viewportFitRequestId: 1,
        }),
        status: 'optimized',
      });
    });

    expect(transformMocks.centerView).not.toHaveBeenCalled();
    expect(transformMocks.setTransform).toHaveBeenCalledTimes(2);
    expect(transformMocks.setTransform).toHaveBeenLastCalledWith(
      expect.any(Number),
      expect.any(Number),
      1,
      0
    );
  });

  it('does not auto-fit the paper viewport without a design fit request', () => {
    renderPanel();
    const project = selectProject(useWorkspaceStore.getState());

    act(() => {
      useWorkspaceStore.setState({
      ...singleTreemakerDesignTab({
        project: { ...project, scale: 1 }
      }),
        status: 'optimized'});
    });

    expect(transformMocks.centerView).not.toHaveBeenCalled();
    expect(transformMocks.setTransform).not.toHaveBeenCalled();
  });

  /** Types into a controlled input past React's value tracker. */
  function setInputValue(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  /** Applies a `setSymmetry` update to the store, the way the engine would. */
  function stubSetSymmetry() {
    return vi.fn(async (update: Parameters<ReturnType<typeof useWorkspaceStore.getState>['setSymmetry']>[0]) => {
      const project = selectProject(useWorkspaceStore.getState());
      useWorkspaceStore.setState({
      ...singleTreemakerDesignTab({
        project: {
          ...project,
          hasSymmetry: update.hasSymmetry ?? project.hasSymmetry,
          paper: {
            ...project.paper,
            symAngle: update.symAngle ?? project.paper.symAngle,
            symLoc: update.symLoc ?? project.paper.symLoc,
          },
        }
      }),});
    });
  }

  // Found by its visible label, not by an `aria-label`: the toggle used to carry
  // one that overrode the visible "Symmetry" text, which is exactly the
  // Label-in-Name failure that was removed.
  const symmetryToggle = () =>
    [...(container?.querySelectorAll<HTMLButtonElement>('.viewport-toolbar__symmetry-button') ?? [])]
      .find((button) => button.textContent?.includes('Symmetry'));
  const symmetryOptionsButton = () =>
    container?.querySelector<HTMLButtonElement>('button[aria-label="Symmetry options"]');

  it('turns design symmetry on and off from a single toolbar toggle', async () => {
    const setSymmetry = stubSetSymmetry();
    renderPanel({ ...createSampleProject(), hasSymmetry: false }, { setSymmetry });

    expect(symmetryToggle()?.getAttribute('aria-pressed')).toBe('false');
    expect(container?.querySelector('.symmetry-line')).toBeNull();

    await act(async () => {
      symmetryToggle()?.click();
      await Promise.resolve();
    });

    expect(setSymmetry).toHaveBeenCalledWith(expect.objectContaining({ hasSymmetry: true }));
    expect(selectProject(useWorkspaceStore.getState()).hasSymmetry).toBe(true);
    expect(symmetryToggle()?.getAttribute('aria-pressed')).toBe('true');
    // One toggle: the axis and its snap lane come with symmetry being on.
    expect(container?.querySelector('.symmetry-line')).not.toBeNull();
    expect(container?.querySelector('.symmetry-snap-lane')).not.toBeNull();

    await act(async () => {
      symmetryToggle()?.click();
      await Promise.resolve();
    });

    expect(setSymmetry).toHaveBeenLastCalledWith({ hasSymmetry: false });
    expect(selectProject(useWorkspaceStore.getState()).hasSymmetry).toBe(false);
    expect(container?.querySelector('.symmetry-line')).toBeNull();
  });

  it('mirrors node edits whenever symmetry is on, with no separate mirror mode', () => {
    const addNodeAt = vi.fn(async () => undefined);
    const addNodeWithSymmetry = vi.fn(async () => undefined);
    renderPanel({ ...createSampleProject(), hasSymmetry: true }, { addNodeAt, addNodeWithSymmetry });

    // The old UI needed a second "Mirror nodes" opt-in before edits reflected.
    expect(container?.textContent).not.toContain('Mirror nodes');

    act(() => {
      container
        ?.querySelector<SVGRectElement>('.paper-hit-area')
        ?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });

    expect(addNodeWithSymmetry).toHaveBeenCalled();
    expect(addNodeAt).not.toHaveBeenCalled();
  });

  it('keeps preset and axis controls behind the symmetry options button', async () => {
    const setSymmetry = stubSetSymmetry();
    renderPanel({ ...createSampleProject(), hasSymmetry: true }, { setSymmetry });

    // Closed: the toolbar shows two buttons and no configuration.
    expect(symmetryOptionsButton()).toBeTruthy();
    expect(container?.querySelector('.symmetry-menu__panel')).toBeNull();

    act(() => {
      symmetryOptionsButton()?.click();
    });

    expect(container?.textContent).toContain('Preset');
    expect(container?.textContent).toContain('Book');
    expect(container?.textContent).toContain('Axis');
    expect(container?.querySelectorAll('.symmetry-menu__field').length).toBe(3);
    // The merged-away toggles are gone from the popover.
    expect(container?.textContent).not.toContain('Enable symmetry');
    expect(container?.textContent).not.toContain('Show axis');

    const angle = container?.querySelector<HTMLInputElement>('input[aria-label="Design symmetry angle"]');
    expect(angle).toBeTruthy();

    await act(async () => {
      setInputValue(angle!, '45');
      // React's onBlur is delegated from focusout; plain blur does not bubble.
      angle!.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      await Promise.resolve();
    });

    expect(setSymmetry).toHaveBeenCalledWith(expect.objectContaining({ symAngle: 45 }));
  });

  it('clears a Select All selection when the user clicks blank paper', () => {
    const addNodeAt = vi.fn(async () => undefined);
    renderPanel(createSampleProject(), { addNodeAt });

    act(() => {
      useWorkspaceStore.getState().selectAll();
    });
    expect(selectSelection(useWorkspaceStore.getState()).kind).toBe('multi');

    const hitArea = container?.querySelector<SVGRectElement>('.paper-hit-area');
    expect(hitArea).toBeTruthy();

    act(() => {
      hitArea?.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    });

    expect(selectSelection(useWorkspaceStore.getState())).toEqual({ kind: 'tree' });
    expect(addNodeAt).not.toHaveBeenCalled();
  });

  /**
   * Delete, through the real dispatcher and the executor this panel registers.
   *
   * This canvas handles the camera and nothing else, but `viewport.delete` is
   * bound in viewport scope, so the executor is asked about every Delete press.
   * It used to fall out of its `switch` and answer `undefined`, which counted as
   * a claim — so Delete did nothing at all here, and nothing caught it because
   * no test pressed the key.
   */
  describe('Delete reaches the tree delete', () => {
    function press(key: string) {
      const menu = vi.fn();
      renderPanel();
      act(() => {
        handleShortcutRuntimeKeyDown(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
          { context: { activeEditingContext: 'treemaker-tree' }, menu }
        );
      });
      return menu;
    }

    it('hands Delete to edit.delete', () => {
      expect(press('Delete')).toHaveBeenCalledWith('edit.delete');
    });

    it('hands Backspace to edit.delete', () => {
      expect(press('Backspace')).toHaveBeenCalledWith('edit.delete');
    });

    it('keeps the camera shortcuts for itself', () => {
      const menu = vi.fn();
      renderPanel();
      act(() => {
        handleShortcutRuntimeKeyDown(
          new KeyboardEvent('keydown', {
            key: '=',
            metaKey: true,
            bubbles: true,
            cancelable: true,
          }),
          { context: { activeEditingContext: 'treemaker-tree' }, menu }
        );
      });
      expect(transformMocks.zoomIn).toHaveBeenCalled();
      expect(menu).not.toHaveBeenCalled();
    });
  });
});
