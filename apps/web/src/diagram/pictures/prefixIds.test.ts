import { describe, expect, it } from 'vitest';
import { prefixIds } from './prefixIds';

describe('prefixIds', () => {
  it('renames ids and every reference to them, in tags only', () => {
    const markup =
      '<g id="a"><use href="#a"/><use xlink:href="#b"/><rect fill="url(#g)" style="fill:url(\'#g\')"/>' +
      '<text>id="a" url(#g)</text></g>';
    expect(prefixIds(markup, 'c2-')).toBe(
      '<g id="c2-a"><use href="#c2-a"/><use xlink:href="#c2-b"/><rect fill="url(#c2-g)" style="fill:url(\'#c2-g\')"/>' +
        '<text>id="a" url(#g)</text></g>'
    );
  });
});
