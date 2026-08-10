import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useHelpStore } from '../store/helpStore';
import { HelpModal } from './HelpModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialHelpState = useHelpStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderModal() {
  useHelpStore.getState().openAbout();

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<HelpModal />);
  });
  return container;
}

beforeEach(() => {
  useHelpStore.setState(initialHelpState, true);
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

describe('HelpModal', () => {
  it('renders the about dialog with acknowledgements', () => {
    const rendered = renderModal();

    expect(rendered.querySelector('[role="dialog"]')).not.toBeNull();
    expect(rendered.textContent).toContain('About Ori Studio');
    expect(rendered.textContent).toContain('Robert J. Lang and TreeMaker 5.0.1');
    expect(rendered.textContent).toContain('Mu-Tsun Tsai and Box Pleating Studio');
    expect(rendered.textContent).toContain('Brandon Wong and ExplOri 22.5');
    expect(rendered.textContent).toContain('Oriedita');
    expect(rendered.textContent).toContain('Amanda Ghassaei and Origami Simulator');
    expect(rendered.textContent).not.toContain('treemaker-rs');
    expect(rendered.textContent).not.toContain('GPL-2.0-or-later');
    expect(rendered.textContent).not.toContain('http://127.0.0.1:5275/');

    const links = Array.from(rendered.querySelectorAll('.about-modal__ack')).map((link) => ({
      href: link.getAttribute('href'),
      target: link.getAttribute('target'),
    }));
    expect(links).toEqual([
      { href: 'https://langorigami.com/article/treemaker/', target: '_blank' },
      { href: 'https://github.com/bp-studio/box-pleating-studio', target: '_blank' },
      { href: 'https://225.designorigami.net/', target: '_blank' },
      { href: 'https://github.com/oriedita/oriedita', target: '_blank' },
      { href: 'https://github.com/amandaghassaei/OrigamiSimulator', target: '_blank' },
    ]);
  });

  it('closes on Escape', () => {
    renderModal();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useHelpStore.getState().activeModal).toBeNull();
  });
});
