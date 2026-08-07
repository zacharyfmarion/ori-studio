import { describe, expect, it } from 'vitest';
import {
  TREE_CHROME_ATTR,
  applyTreeChromeScale,
  collectTreeChromeTargets,
  treeChromeDash,
} from './sceneDom';

/**
 * The counter-scaling contract: every size on the canvas is declared in screen
 * pixels and rewritten for the camera, so a zoom step changes how thick the
 * drawing is without re-rendering it.
 *
 * The interesting part is that a mark's sizes have to move *together*. A stroke
 * width that scales beside a dash pattern that does not is how the mirror-draw
 * preview turned into a row of squares.
 */
function scene(markup: string): SVGElement {
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.innerHTML = markup;
  return host;
}

const at = (scale: number) => (px: number) => px / scale;

describe('counter-scaled chrome', () => {
  it('scales a dash pattern with the camera', () => {
    const root = scene(
      `<line ${TREE_CHROME_ATTR.dash}="6 6" ${TREE_CHROME_ATTR.stroke}="3" />`
    );
    const targets = collectTreeChromeTargets(root);
    applyTreeChromeScale(targets, at(0.25));

    const line = root.querySelector('line');
    expect(line?.style.strokeDasharray).toBe('24 24');
    expect(line?.style.strokeWidth).toBe('12');
  });

  it('holds a dash in proportion to its stroke at every zoom', () => {
    // The regression itself. `stroke-dasharray` is in user units, so a pattern
    // left in the stylesheet stays put while the width around it grows on
    // zoom-out; past roughly 1:2 the dashes are wider than they are long.
    const root = scene(
      `<line ${TREE_CHROME_ATTR.dash}="6 6" ${TREE_CHROME_ATTR.stroke}="3" />`
    );
    const targets = collectTreeChromeTargets(root);
    const line = root.querySelector('line');

    for (const scale of [2, 1, 0.35, 0.05]) {
      applyTreeChromeScale(targets, at(scale));
      const dash = Number.parseFloat(line?.style.strokeDasharray ?? '');
      const width = Number.parseFloat(line?.style.strokeWidth ?? '');
      expect(dash / width).toBeCloseTo(2, 9);
    }
  });

  it('draws the same pattern the rescaler would write', () => {
    // A zoom does not re-render, so the render and the rescaler each set this
    // string independently. They have to agree, or the first zoom step after a
    // draw would visibly change a line nothing asked to change.
    const chromePx = at(0.4);
    const root = scene(`<line ${TREE_CHROME_ATTR.dash}="2 6" />`);
    applyTreeChromeScale(collectTreeChromeTargets(root), chromePx);

    expect(root.querySelector('line')?.style.strokeDasharray).toBe(
      treeChromeDash([2, 6], chromePx)
    );
  });

  it('collects a mark that carries only a dash', () => {
    // The selector is a union of the size attributes; a dash-only mark used to
    // fall outside it and would silently stop scaling.
    const root = scene(`<line ${TREE_CHROME_ATTR.dash}="4 4" />`);
    const targets = collectTreeChromeTargets(root);
    expect(targets).toHaveLength(1);
    expect(targets[0].dashPx).toEqual([4, 4]);
    expect(targets[0].strokePx).toBeNull();
  });

  it('ignores a malformed dash rather than writing NaN into the style', () => {
    const root = scene(`<line ${TREE_CHROME_ATTR.dash}="6 wide" />`);
    const targets = collectTreeChromeTargets(root);
    expect(targets[0].dashPx).toBeNull();

    applyTreeChromeScale(targets, at(0.5));
    expect(root.querySelector('line')?.style.strokeDasharray).toBe('');
  });
});
