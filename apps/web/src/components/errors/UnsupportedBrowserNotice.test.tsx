import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UnsupportedBrowserNotice } from './UnsupportedBrowserNotice';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('UnsupportedBrowserNotice', () => {
  it('names the missing capability and what to do about it, as an alert', () => {
    act(() => root.render(<UnsupportedBrowserNotice />));

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain('can’t run in this browser');
    expect(alert?.textContent).toContain('module Web Workers');
    expect(alert?.textContent).toContain('Update to a current version');
  });
});
