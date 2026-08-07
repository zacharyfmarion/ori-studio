import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const controllerMocks = vi.hoisted(() => ({
  handleFileDrop: vi.fn(async () => null),
}));

vi.mock('../commands/fileDropController', () => ({
  handleFileDrop: controllerMocks.handleFileDrop,
}));

import { useFileDropTarget } from './useFileDropTarget';
import type { DropTargetPolicy } from '../lib/fileDrop';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function Host({ policy }: { policy: DropTargetPolicy }) {
  const { dropTargetProps, isDragActive } = useFileDropTarget({ policy });
  return (
    <div data-testid="target" data-active={isDragActive || undefined} {...dropTargetProps}>
      <div data-testid="child">child</div>
    </div>
  );
}

function render(policy: DropTargetPolicy = 'open-or-import') {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<Host policy={policy} />);
  });
  return container;
}

function element(testId: string): HTMLElement {
  const found = container?.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
  expect(found).toBeTruthy();
  return found as HTMLElement;
}

function isActive(): boolean {
  return element('target').dataset.active === 'true';
}

interface FakeTransfer {
  types: string[];
  items?: { kind: string; type: string }[];
  files?: File[];
}

/**
 * jsdom has no real DataTransfer, so drag events are dispatched natively with a
 * stand-in attached. React reads the same properties off the synthetic event.
 */
function fire(target: HTMLElement, type: string, transfer: FakeTransfer): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      types: transfer.types,
      items: transfer.items ?? [],
      files: transfer.files ?? [],
      dropEffect: 'none',
    },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

const documentDrag: FakeTransfer = {
  types: ['Files'],
  items: [{ kind: 'file', type: '' }],
};
const imageDrag: FakeTransfer = {
  types: ['Files'],
  items: [{ kind: 'file', type: 'image/png' }],
};
const inPageDrag: FakeTransfer = {
  types: ['application/vnd.dockview.tab'],
  items: [{ kind: 'string', type: 'application/vnd.dockview.tab' }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('useFileDropTarget', () => {
  it('activates for a document drag', () => {
    render();
    fire(element('target'), 'dragenter', documentDrag);
    expect(isActive()).toBe(true);
  });

  // The crease-pattern viewport handles images; claiming them here would put an
  // overlay over a surface that is about to accept the drop silently.
  it('ignores an image-only drag', () => {
    render();
    fire(element('target'), 'dragenter', imageDrag);
    expect(isActive()).toBe(false);
  });

  // macOS types `.ori` as Olympus raw, so this is what an Oriedita crease
  // pattern looks like in flight — and standing down for it is what sent the
  // file to an importer that could only fail to decode it.
  it('activates for a document the platform types as camera raw', () => {
    render();
    fire(element('target'), 'dragenter', {
      types: ['Files'],
      items: [{ kind: 'file', type: 'image/x-olympus-orf' }],
    });
    expect(isActive()).toBe(true);
  });

  it('activates for a mixed drag that includes a document', () => {
    render();
    fire(element('target'), 'dragenter', {
      types: ['Files'],
      items: [
        { kind: 'file', type: 'image/png' },
        { kind: 'file', type: '' },
      ],
    });
    expect(isActive()).toBe(true);
  });

  // Dockview's panel drags are in-page and carry no files; treating them as ours
  // would break rearranging.
  it('ignores a drag that carries no files', () => {
    render();
    fire(element('target'), 'dragenter', inPageDrag);
    expect(isActive()).toBe(false);
  });

  it('stays active when the cursor moves onto a child', () => {
    render();
    fire(element('target'), 'dragenter', documentDrag);
    // Entering a child fires leave-then-enter on the way through.
    fire(element('child'), 'dragenter', documentDrag);
    fire(element('target'), 'dragleave', documentDrag);
    expect(isActive()).toBe(true);
  });

  it('deactivates once the drag has fully left', () => {
    render();
    fire(element('target'), 'dragenter', documentDrag);
    fire(element('child'), 'dragenter', documentDrag);
    fire(element('target'), 'dragleave', documentDrag);
    fire(element('target'), 'dragleave', documentDrag);
    expect(isActive()).toBe(false);
  });

  it('hands dropped files to the controller with its policy', () => {
    render('open-only');
    const file = new File(['x'], 'design.cp');

    fire(element('target'), 'dragenter', documentDrag);
    fire(element('target'), 'drop', { ...documentDrag, files: [file] });

    expect(controllerMocks.handleFileDrop).toHaveBeenCalledWith({
      files: [file],
      policy: 'open-only',
    });
    expect(isActive()).toBe(false);
  });

  it('does not call the controller for a drop with no files', () => {
    render();
    fire(element('target'), 'drop', inPageDrag);
    expect(controllerMocks.handleFileDrop).not.toHaveBeenCalled();
  });
});
