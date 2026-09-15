import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { resolveSelectedCanvasObject, type CanvasObjectTarget } from './canvasObjectKinds';
import { FIGURE, IMAGE, TEXT, WINDOW, selectionFields } from './canvasObjectKinds.fixtures';
import { useSelectedCanvasObject } from './useSelectedCanvasObject';

/**
 * The store hook a dock panel outside the crease-pattern panel binds the
 * selection through: it must agree with the pure resolver on every selection,
 * and must not re-render for a drag of some *other* object.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSelectedCanvasObject', () => {
  let root: Root;
  let host: HTMLDivElement;
  let renders = 0;
  let target: CanvasObjectTarget | null = null;
  const initialState = useWorkspaceStore.getInitialState();

  function Probe() {
    renders += 1;
    target = useSelectedCanvasObject();
    return null;
  }

  beforeEach(() => {
    useWorkspaceStore.setState(initialState, true);
    useWorkspaceStore.setState(selectionFields());
    renders = 0;
    target = null;
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useWorkspaceStore.setState(initialState, true);
  });

  it('agrees with the pure resolver on every kind of selection', () => {
    for (const patch of [
      { oristudioCpSelectedAnnotationId: IMAGE.id },
      { oristudioCpSelectedAnnotationId: TEXT.id },
      { oristudioCpActiveFoldedFigureId: FIGURE.id },
      { oristudioCpFocusedInlineSimulationId: WINDOW.id },
      { oristudioCpSelectedAnnotationId: 'gone' },
    ] as const) {
      act(() => useWorkspaceStore.setState(selectionFields(patch)));
      expect(target).toEqual(resolveSelectedCanvasObject(useWorkspaceStore.getState()));
    }
    act(() => useWorkspaceStore.setState(selectionFields()));
    expect(target).toBeNull();
  });

  it('does not re-render for a drag of another object', () => {
    act(() => useWorkspaceStore.setState({ oristudioCpSelectedAnnotationId: IMAGE.id }));
    const before = renders;
    // A placement drag replaces the whole array but keeps the selected entry.
    act(() =>
      useWorkspaceStore.setState({
        oristudioCpAnnotations: useWorkspaceStore
          .getState()
          .oristudioCpAnnotations.map((annotation) =>
            annotation.id === TEXT.id ? { ...annotation, rotation: 0.5 } : annotation
          ),
      })
    );
    expect(renders).toBe(before);
    expect(target).toMatchObject({ kind: 'image', id: IMAGE.id });
  });

  it('re-renders when the selected object itself changes', () => {
    act(() => useWorkspaceStore.setState({ oristudioCpSelectedAnnotationId: IMAGE.id }));
    const before = renders;
    act(() =>
      useWorkspaceStore.setState({
        oristudioCpAnnotations: useWorkspaceStore
          .getState()
          .oristudioCpAnnotations.map((annotation) =>
            annotation.id === IMAGE.id ? { ...annotation, opacity: 0.5 } : annotation
          ),
      })
    );
    expect(renders).toBeGreaterThan(before);
    expect(target).toMatchObject({ kind: 'image', annotation: { opacity: 0.5 } });
  });
});
