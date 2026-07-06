import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useHelpStore, type HelpModalKind } from '../store/helpStore';
import { HelpModal } from './HelpModal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialHelpState = useHelpStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderModal(kind: HelpModalKind) {
  if (kind === 'guide') useHelpStore.getState().openGuide();
  else useHelpStore.getState().openAbout();

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<HelpModal />);
  });
  return container;
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find((element) =>
    element.textContent?.includes(label)
  );
  expect(button).toBeDefined();
  return button as HTMLButtonElement;
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
  it('renders the full documentation guide with generated screenshot references', () => {
    const rendered = renderModal('guide');

    expect(rendered.querySelector('[role="dialog"]')).not.toBeNull();
    expect(rendered.textContent).toContain('Ori Studio Help');
    expect(rendered.textContent).toContain('Start, Open, Save, Export');
    expect(rendered.textContent).toContain('Simulate The Folded Model');

    const screenshots = Array.from(rendered.querySelectorAll('img')).map((image) =>
      image.getAttribute('src')
    );
    expect(screenshots).toContain('/help/design-workspace.png');
    expect(screenshots).toContain('/help/workspace-settings.png');
  });

  it('switches between guide and about dialogs', () => {
    const rendered = renderModal('guide');

    act(() => {
      findButton('About').click();
    });

    expect(useHelpStore.getState().activeModal).toBe('about');
    expect(rendered.textContent).toContain('Robert J. Lang and TreeMaker 5.0.1');
    expect(rendered.textContent).toContain('Jason S. Ku and Flat-Folder');
    expect(rendered.textContent).not.toContain('treemaker-rs');
    expect(rendered.textContent).not.toContain('GPL-2.0-or-later');
    expect(rendered.textContent).not.toContain('http://127.0.0.1:5275/');

    const links = Array.from(rendered.querySelectorAll('.about-modal__ack')).map((link) => ({
      href: link.getAttribute('href'),
      target: link.getAttribute('target'),
    }));
    expect(links).toEqual([
      { href: 'https://langorigami.com/article/treemaker/', target: '_blank' },
      { href: 'https://github.com/origamimagiro/flat-folder', target: '_blank' },
      { href: 'https://github.com/edemaine/fold', target: '_blank' },
    ]);

    act(() => {
      findButton('Help').click();
    });

    expect(useHelpStore.getState().activeModal).toBe('guide');
    expect(rendered.textContent).toContain('Ori Studio Help');
  });

  it('closes on Escape', () => {
    renderModal('about');

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(useHelpStore.getState().activeModal).toBeNull();
  });
});
