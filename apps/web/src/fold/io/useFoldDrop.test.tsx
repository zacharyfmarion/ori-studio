import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFoldImportUiStore } from './foldImportUiStore';
import { useFoldDrop } from './useFoldDrop';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
/** What reached the app's own target, above the Fold panel. */
const workspace = { enter: vi.fn(), drop: vi.fn() };

function Panel() {
  const { dropTargetProps, isDragActive } = useFoldDrop();
  return (
    <div onDragEnter={workspace.enter} onDrop={workspace.drop}>
      <div data-testid="target" data-active={isDragActive || undefined} {...dropTargetProps} />
    </div>
  );
}

/** A drag event carrying `files`, as a browser sends one. */
function drag(type: string, files: File[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const items = files.map((file) => ({ kind: 'file', type: file.type }));
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: ['Files'], items, files, dropEffect: 'none' },
  });
  return event;
}

const target = () => host.querySelector<HTMLElement>('[data-testid="target"]')!;

beforeEach(() => {
  workspace.enter.mockClear();
  workspace.drop.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Panel />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  act(() => useFoldImportUiStore.getState().close());
});

describe('the Fold workspace’s drop policy', () => {
  it('claims a file drag, so the app’s target shows no overlay over Fold', () => {
    const cp = new File(['1 0 0 1 1'], 'crane.cp');
    act(() => {
      target().dispatchEvent(drag('dragenter', [cp]));
    });
    expect(target().dataset.active).toBe('true');
    expect(workspace.enter).not.toHaveBeenCalled();
  });

  it('imports a dropped crease pattern as a step, through the import dialog', async () => {
    const cp = new File(['1 0 0 1 1'], 'crane.cp');
    await act(async () => {
      target().dispatchEvent(drag('drop', [new File(['{}'], 'notes.txt'), cp]));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(workspace.drop).not.toHaveBeenCalled();
    const opening = useFoldImportUiStore.getState().opening;
    expect(opening).toMatchObject({ mode: 'step', request: null });
    // The queue keeps the crease patterns, each read when its turn comes.
    expect(opening?.files.map((file) => file.name)).toEqual(['notes.txt', 'crane.cp']);
    expect(Array.from((await opening?.files[1]?.read(64)) ?? [])).toEqual(Array.from(new TextEncoder().encode('1 0 0 1 1')));
    expect(target().dataset.active).toBeUndefined();
  });

  it('opens Import CP once on several crease patterns dropped together', async () => {
    const files = ['10.cp', '9.cp', '8.fold'].map((name) => new File(['1 0 0 1 1'], name));
    const opened = vi.fn();
    const unsubscribe = useFoldImportUiStore.subscribe((state, before) => {
      if (state.opening !== before.opening && state.opening) opened(state.opening);
    });
    act(() => {
      target().dispatchEvent(drag('drop', files));
    });
    unsubscribe();
    expect(opened).toHaveBeenCalledOnce();
    expect(useFoldImportUiStore.getState().opening?.files.map((file) => file.name)).toEqual(['10.cp', '9.cp', '8.fold']);
    expect(workspace.drop).not.toHaveBeenCalled();
  });

  it('leaves a drop with no crease pattern to the workspace, which opens it', () => {
    act(() => {
      target().dispatchEvent(drag('drop', [new File(['{}'], 'project.osf')]));
    });
    expect(workspace.drop).toHaveBeenCalledOnce();
    expect(useFoldImportUiStore.getState().opening).toBeNull();
  });
});
