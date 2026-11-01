import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runModalHistory } from '../../keyboard/dialogShortcuts';
import { byRole, queryByRole } from '../../test/roleQueries';
import { MODAL_FULL_SCREEN_QUERY, ModalFrame, type ModalFrameProps } from './ModalFrame';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
});

function render(props: Partial<ModalFrameProps> = {}) {
  const onClose = props.onClose ?? vi.fn();
  act(() =>
    root.render(
      <ModalFrame title="Layer order" onClose={onClose} returnFocus={null} {...props}>
        {props.children ?? <button type="button">Inside</button>}
      </ModalFrame>
    )
  );
  return { onClose };
}

const dialog = () => byRole(document, 'dialog', 'Layer order');
const surface = () => byRole(dialog(), 'document', /.*/);
const press = (element: Element, type: 'mousedown' | 'click') =>
  act(() => element.dispatchEvent(new MouseEvent(type, { bubbles: true })));

describe('a modal frame', () => {
  it('is a modal dialog named by its title, a shortcut barrier with a close button', () => {
    render();
    expect(dialog().getAttribute('aria-modal')).toBe('true');
    expect(dialog().hasAttribute('data-shortcut-barrier')).toBe(true);
    expect(dialog().textContent).toContain('Layer order');
    expect(byRole(dialog(), 'button', 'Close Layer order')).toBeDefined();
  });

  it('takes focus as it opens, and gives it back to the opener as it closes', () => {
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    render({ returnFocus: opener });
    expect(document.activeElement).toBe(surface());
    act(() => root.render(null));
    expect(document.activeElement).toBe(opener);
  });

  it('closes on Escape, the close button and a press on the backdrop, not a press inside', () => {
    const { onClose } = render();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    press(byRole(dialog(), 'button', 'Close Layer order'), 'click');
    expect(onClose).toHaveBeenCalledTimes(2);
    press(byRole(dialog(), 'button', 'Inside'), 'mousedown');
    expect(onClose).toHaveBeenCalledTimes(2);
    press(dialog(), 'mousedown');
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('is a form by default, and says its size and layout for its stylesheet', () => {
    render();
    expect(surface().dataset.size).toBe('form');
    expect(byRole(dialog(), 'button', 'Inside').parentElement?.dataset.layout).toBe('stack');
    render({ size: 'workspace', layout: 'fill' });
    expect(surface().dataset.size).toBe('workspace');
    expect(byRole(dialog(), 'button', 'Inside').parentElement?.dataset.layout).toBe('fill');
  });

  it('shows the detail and the tools in the bar, before the close button', () => {
    render({ detail: 'Kabuto', tools: <button type="button">X-ray</button> });
    const close = byRole(dialog(), 'button', 'Close Layer order');
    const xray = byRole(dialog(), 'button', 'X-ray');
    expect(xray.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(close.parentElement?.textContent).toContain('Kabuto');
  });

  it('puts a lead right after the title, before the detail and the tools', () => {
    render({ lead: <button type="button">Folded</button>, detail: 'Kabuto', tools: <button type="button">X-ray</button> });
    const close = byRole(dialog(), 'button', 'Close Layer order');
    const bar = close.parentElement!;
    expect(bar.textContent?.startsWith('Layer orderFoldedKabutoX-ray')).toBe(true);
    // In rows on a phone: the title's line (title, lead, detail), then the tools; the close button in the bar.
    expect(bar.dataset.rows).toBe('true');
    expect(bar.children[0]!.textContent).toBe('Layer orderFoldedKabuto');
    expect(bar.children[1]!.textContent).toBe('X-ray');
    expect(bar.lastElementChild).toBe(close);
  });

  it('keeps a bar with no lead and no tools as it was: title, detail and close, side by side', () => {
    render({ detail: 'Kabuto' });
    const close = byRole(dialog(), 'button', 'Close Layer order');
    const bar = close.parentElement!;
    expect(bar.dataset.rows).toBeUndefined();
    expect([...bar.children].map((child) => child.textContent)).toEqual(['Layer order', 'Kabuto', '']);
  });

  it('closes on a press on the backdrop unless told not to', () => {
    const { onClose } = render({ closeOnBackdrop: false });
    press(dialog(), 'mousedown');
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    press(byRole(dialog(), 'button', 'Close Layer order'), 'click');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('gives Undo and Redo to its history while it is on top, and lets go as it closes', () => {
    const history = { undo: vi.fn(), redo: vi.fn(), canUndo: () => true, canRedo: () => false };
    render({ history });
    expect(runModalHistory('undo')).toBe(true);
    expect(history.undo).toHaveBeenCalledOnce();
    expect(runModalHistory('redo')).toBe(false);
    act(() => root.render(null));
    expect(runModalHistory('undo')).toBe(false);
    expect(history.undo).toHaveBeenCalledOnce();
  });

  it('is the whole screen at the width its stylesheet says', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/ui/ModalFrame.module.css'), 'utf8');
    expect(css).toContain(`@media ${MODAL_FULL_SCREEN_QUERY} {`);
  });

  it('has a foot only with a note or verbs, the verbs after the note', () => {
    render();
    expect(surface().textContent).not.toContain('Apply');
    render({
      footer: <p>Keeps the order on screen.</p>,
      actions: (
        <>
          <button type="button">Cancel</button>
          <button type="button">Apply</button>
        </>
      ),
    });
    expect(surface().textContent?.endsWith('Keeps the order on screen.CancelApply')).toBe(true);
    expect(queryByRole(dialog(), 'button', 'Apply')).not.toBeNull();
  });

  it('hands a drag anywhere on it, backdrop included, to the dialog', () => {
    const onDragOver = vi.fn();
    const onDrop = vi.fn();
    render({ onDragOver, onDrop });
    act(() => {
      dialog().dispatchEvent(new Event('dragover', { bubbles: true }));
      byRole(dialog(), 'button', 'Inside').dispatchEvent(new Event('drop', { bubbles: true }));
    });
    expect(onDragOver).toHaveBeenCalledOnce();
    expect(onDrop).toHaveBeenCalledOnce();
  });

  it('calls the latest onClose', () => {
    const first = vi.fn();
    const second = vi.fn();
    function Swapping() {
      const [onClose, setOnClose] = useState(() => first);
      return (
        <ModalFrame title="Layer order" onClose={onClose} returnFocus={null}>
          <button type="button" onClick={() => setOnClose(() => second)}>
            Inside
          </button>
        </ModalFrame>
      );
    }
    act(() => root.render(<Swapping />));
    press(byRole(dialog(), 'button', 'Inside'), 'click');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });
});
