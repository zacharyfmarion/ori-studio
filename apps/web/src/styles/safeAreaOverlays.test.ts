/**
 * A full-screen overlay may never lose its safe-area inset.
 *
 * The three modal backdrops are `position: fixed; inset: 0`, so they sit outside
 * `.app-layout`'s safe-area padding and have to inset themselves. That inset is
 * written once, in the shared `.settings-modal, .simple-modal, .help-modal` rule,
 * as `max(var(--modal-gutter), var(--safe-*))` per edge — and the gutter is the
 * only part any override is meant to change.
 *
 * The bug this exists to stop, which shipped: `@media (max-width: 620px)` set
 * `padding: var(--space-2)` on `.settings-modal`. A shorthand replaces all four
 * edges, so the insets went with it, and on a phone the dialog stretched to the
 * whole viewport with an 8px gutter. The phone layout also moves the close
 * button to the document's own `top: 0` — which, in a standalone PWA on a
 * 16 Pro Max, is ~62pt under the status bar. There was no way to close Settings.
 * `.help-modal` had the identical override at 680px, so the About dialog was one
 * screenshot away from the same report.
 *
 * Safari could never reproduce it: in portrait the browser chrome sits above the
 * page, so `safe-area-inset-top` is 0 and the missing `max()` costs nothing. It
 * only appears once the app is installed, which is the least likely place for
 * anyone to be debugging CSS.
 *
 * So this checks the shape rather than the instance: no rule anywhere may
 * declare `padding` on one of these selectors. Setting `--modal-gutter` still
 * works and is what a narrow-width block should do.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest's root is `apps/web`. Resolved from there rather than from
// `import.meta.url`, which is not a file: URL once Vite has transformed this.
const THEME_CSS = resolve(process.cwd(), 'src/styles/theme.css');

/** The overlays that are `position: fixed; inset: 0` over the whole viewport. */
const OVERLAY_SELECTORS = ['.settings-modal', '.simple-modal', '.help-modal'];

/**
 * Declaration blocks whose selector list names one of the overlays *itself* —
 * not one of its descendants. `.settings-modal__document` is a different box
 * with its own padding and is none of this test's business, which is why the
 * match has to end at a boundary rather than at a prefix.
 */
function overlayBlocks(css: string): { selector: string; body: string }[] {
  const blocks: { selector: string; body: string }[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
    const selector = (match[1] ?? '').trim();
    const body = match[2] ?? '';
    const names = selector.split(',').map((one) => one.trim());
    const targetsOverlay = names.some((one) =>
      OVERLAY_SELECTORS.some((overlay) => one === overlay || one.startsWith(`${overlay}:`))
    );
    if (targetsOverlay) blocks.push({ selector, body });
  }
  return blocks;
}

describe('full-screen overlays and the safe area', () => {
  it('never re-declares padding on an overlay backdrop', () => {
    const source = readFileSync(THEME_CSS, 'utf8');
    // Guard against passing vacuously on a wrong path or an empty read.
    expect(source.length, 'theme.css looks empty; check THEME_CSS').toBeGreaterThan(10_000);
    const css = source.replace(/\/\*[\s\S]*?\*\//gu, '');

    const blocks = overlayBlocks(css);
    // The shared rule alone would be one block; the per-overlay base rules and
    // the two narrow-width overrides bring it to at least four. A parser change
    // that stopped matching would otherwise make this test pass over nothing.
    expect(blocks.length, 'no overlay rules matched; the block parser has drifted').toBeGreaterThan(
      3
    );

    // A `padding` is allowed only if it carries the insets itself, which in
    // practice is the one shared rule. Written as "must mention `--safe-`"
    // rather than "must be the shared rule", so splitting or moving that rule
    // stays legal and dropping the insets never does.
    const offenders = blocks
      .filter(({ body }) => {
        const declaration = /(?:^|;)\s*padding\s*:([^;]*)/u.exec(body);
        return declaration !== null && !declaration[1]?.includes('--safe-');
      })
      .map(({ selector }) => selector);

    expect(
      offenders,
      'a `padding` here replaces all four edges and takes the safe-area insets with ' +
        'it, which puts the dialog under the status bar in a standalone PWA — set ' +
        '`--modal-gutter` instead'
    ).toEqual([]);
  });

  it('insets every edge of every overlay against the safe area', () => {
    const css = readFileSync(THEME_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '');
    const shared = overlayBlocks(css).find(({ body }) => body.includes('--modal-gutter:'));

    expect(shared, 'no rule defines --modal-gutter for the overlays').toBeDefined();
    // All four, not just the top: a phone in landscape has left and right insets
    // and nothing else pads these boxes.
    for (const edge of ['--safe-top', '--safe-right', '--safe-bottom', '--safe-left']) {
      expect(shared?.body, `the overlay inset does not mention ${edge}`).toContain(edge);
    }
  });
});
