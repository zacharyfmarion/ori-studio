import { afterEach, describe, expect, it } from 'vitest';
import { isViewportInteractiveTarget } from './ViewportToolbar';

function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('isViewportInteractiveTarget', () => {
  it('claims controls that own their keystrokes', () => {
    const host = mount(
      '<button></button><input /><textarea></textarea><select></select><div contenteditable="true"></div>'
    );
    for (const el of host.children) expect(isViewportInteractiveTarget(el)).toBe(true);
  });

  it('leaves plain viewport chrome alone', () => {
    const host = mount('<div class="canvas"></div>');
    expect(isViewportInteractiveTarget(host.firstElementChild)).toBe(false);
    expect(isViewportInteractiveTarget(null)).toBe(false);
  });
});
