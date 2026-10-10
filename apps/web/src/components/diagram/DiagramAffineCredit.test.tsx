import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { isShortcutBarrierTarget } from '../../keyboard/shortcutDispatcher';
import '../../i18n';
import { DiagramAffineCredit } from './DiagramAffineCredit';

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
  host.remove();
});

it('opens a real DEFOX link and owns Escape without dispatching a workspace shortcut', async () => {
  await act(async () => root.render(<DiagramAffineCredit />));
  const trigger = host.querySelector<HTMLButtonElement>('button')!;
  trigger.focus();
  await act(async () => trigger.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  const link = dialog.querySelector<HTMLAnchorElement>('a')!;
  expect(link.textContent).toBe('Visit DEFOX');
  expect(link.href).toBe('https://kei-morisue.github.io/step-folder/');
  expect(link.target).toBe('_blank');
  expect(isShortcutBarrierTarget(link)).toBe(true);
  await act(async () => {
    link.focus();
    link.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
