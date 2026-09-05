import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The crop pane has to fit its cell in **both** axes.
 *
 * This is the shape of a bug that shipped. `CpDetectCropEditor` sets the pane's
 * `aspect-ratio` inline from the source image, and the stylesheet sized the pane
 * from its width alone — `width: 100%`, height left to the ratio. For a portrait
 * photo (a phone screenshot of a crease pattern, 1080x2400) that asks for a pane
 * ~1193px tall inside a ~565px cell. `.cp-detect-modal__surface` is
 * `overflow: hidden` and never scrolls, so the bottom of the image was simply cut
 * off below the modal, taking the `bottom_left` and `bottom_right` handles with
 * it: the crop could not be drawn at all.
 *
 * jsdom does no layout — and the modal's own tests stub `getBoundingClientRect`
 * to a fixed 100x100 — so rendering cannot catch this. What is checkable is the
 * rule the layout depends on: **the pane must be free to take its size from
 * either axis.** Two things have to hold together, and each is useless alone:
 *
 *  - the editor declares the image's ratio on the pane, and
 *  - the pane's size is capped in both axes and forced in neither, with both
 *    axes non-stretch (a stretched axis is definite and beats the ratio, which
 *    is how the width came to be the only input).
 */

const here = dirname(new URL(import.meta.url).pathname);
// Comments come out first: this stylesheet's prose carries both `;` and `:`
// ("A corner drag is the only gesture here; ...", "`overflow: hidden`"), which
// a declaration split reads as declarations of its own.
const css = readFileSync(join(here, 'CpDetectImportModal.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const editor = readFileSync(join(here, 'CpDetectCropEditor.tsx'), 'utf8');

const PANE = 'cp-detect-modal__image-wrap';

/**
 * The declarations that reach `.<className>`, as the cascade leaves them: every
 * rule naming the class, in source order, last one winning. All the rules here
 * are a single class selector, so source order is the whole story.
 */
function effectiveStyle(className: string): Map<string, string> {
  const style = new Map<string, string>();
  const rule = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rule.exec(css)) !== null) {
    const selector = match[1];
    if (!selector.split(',').some((part) => part.trim().split(/[\s>+~]/).pop() === `.${className}`)) {
      continue;
    }
    for (const declaration of match[2].split(';')) {
      const colon = declaration.indexOf(':');
      if (colon === -1) continue;
      style.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
  }
  return style;
}

describe('the CP-detect crop pane', () => {
  const style = effectiveStyle(PANE);

  it('is capped in both axes, so a tall image cannot outgrow the modal', () => {
    // Guard the guard: a renamed class would empty this map and every
    // expectation below would pass vacuously.
    expect(style.size, `no rules found for .${PANE}; was it renamed?`).toBeGreaterThan(0);

    expect(style.get('max-width')).toBe('100%');
    expect(style.get('max-height')).toBe('100%');
  });

  it('forces neither axis, so the ratio picks whichever cap binds', () => {
    // `width: 100%` is what the shared rule above it sets, and what made the
    // width the only input to the pane's height.
    expect(style.get('width')).toBe('auto');
    expect(style.get('height')).toBe('auto');
  });

  it('stretches in neither axis, since a stretched axis outranks the ratio', () => {
    for (const property of ['align-self', 'justify-self', 'place-self']) {
      expect(style.get(property) ?? 'unset').not.toBe('stretch');
    }
    // And it must actually opt out of stretch rather than rely on the initial
    // value: a grid item's `normal` behaves as `start` only while it has a
    // preferred ratio, which is a property of the inline style, not this rule.
    expect(style.has('align-self') || style.has('place-self')).toBe(true);
    expect(style.has('justify-self') || style.has('place-self')).toBe(true);
  });

  it('is given the source image ratio by the editor', () => {
    // Without this the caps above would fit a 1:1 box, not the image.
    expect(editor).toMatch(/aspectRatio:\s*`\$\{source\.image\.width\}\s*\/\s*\$\{source\.image\.height\}`/);
    expect(editor).toContain(`className="${PANE}"`);
  });
});
