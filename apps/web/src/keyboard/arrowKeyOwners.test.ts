import { describe, expect, it } from 'vitest';
import { focusOwnsArrowKeys, OWN_ARROWS_ATTRIBUTE } from './arrowKeyOwners';

describe('focusOwnsArrowKeys', () => {
  function inside(markup: string, selector: string) {
    const host = document.createElement('div');
    host.innerHTML = markup;
    document.body.append(host);
    const element = host.querySelector(selector);
    const owns = focusOwnsArrowKeys(element);
    host.remove();
    return owns;
  }

  it('leaves the arrows to tab strips, radio groups and sliders, in a toolbar too', () => {
    expect(inside('<div role="tablist"><button id="x">Steps</button></div>', '#x')).toBe(true);
    expect(inside('<div role="radiogroup"><button id="x">A</button></div>', '#x')).toBe(true);
    expect(inside('<span role="slider" id="x"></span>', '#x')).toBe(true);
    expect(inside('<div role="toolbar"><span role="slider" id="x"></span></div>', '#x')).toBe(true);
  });

  it('leaves them to a list marked as moving with them, such as the Diagram’s pattern picker', () => {
    expect(
      inside(`<div role="listbox" ${OWN_ARROWS_ATTRIBUTE}><button role="option" id="x"></button></div>`, '#x')
    ).toBe(true);
  });

  it('takes them from a plain button, in a toolbar or not, a step card, or nothing', () => {
    expect(inside('<button id="x">Add step</button>', '#x')).toBe(false);
    // The pose toolbar's Rotate: the next step must still be a key away.
    expect(inside('<div role="toolbar"><button id="x">Rotate</button></div>', '#x')).toBe(false);
    expect(inside('<div role="listbox"><div role="option" id="x"></div></div>', '#x')).toBe(false);
    expect(focusOwnsArrowKeys(null)).toBe(false);
  });
});
