import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CpTextEditor } from './CpTextEditor';
import { createTextAnnotation } from './annotations/textAnnotation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => {
    root?.unmount();
  });
  root = null;
  container?.remove();
  container = null;
});

function renderEditor(onExit: (reason: 'blur' | 'escape') => void): HTMLElement {
  const box = createTextAnnotation({ center: { x: 0, y: 0 } });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <CpTextEditor
        doc={box.doc}
        box={box}
        container={null}
        onChange={() => {}}
        onExit={onExit}
        onDelete={() => {}}
      />,
    );
  });
  const content = container.querySelector<HTMLElement>('.cp-text-editor__content');
  if (!content) throw new Error('editor did not render');
  return content;
}

describe('CpTextEditor', () => {
  it('reports Escape as a keyboard exit', () => {
    const onExit = vi.fn();
    const content = renderEditor(onExit);

    act(() => {
      content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    // Not 'blur': `@lexical/rich-text` answers Escape by blurring the editor, so
    // without our own KEY_ESCAPE_COMMAND handler this arrives as a click-away.
    expect(onExit).toHaveBeenCalledWith('escape');
  });

  it('keeps editing when focus moves into the text toolbar', () => {
    const onExit = vi.fn();
    const content = renderEditor(onExit);
    const toolbar = document.createElement('div');
    toolbar.setAttribute('data-cp-text-toolbar', '');
    document.body.appendChild(toolbar);
    const button = toolbar.appendChild(document.createElement('button'));

    act(() => {
      content.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: button }));
    });

    expect(onExit).not.toHaveBeenCalled();
    toolbar.remove();
  });

  it('reports a click outside as a blur exit', () => {
    const onExit = vi.fn();
    const content = renderEditor(onExit);

    act(() => {
      content.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    });

    expect(onExit).toHaveBeenCalledWith('blur');
  });
});
