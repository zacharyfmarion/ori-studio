import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isPhoneSurface } from './mobileSurface';
import { isPhoneLayout, PHONE_MEDIA_QUERY } from './phoneLayout';
import type { MediaHost } from './pointerSurface';

type Device = { pointer: 'coarse' | 'fine'; width: number; height: number };

/**
 * Evaluate {@link PHONE_MEDIA_QUERY} against a device by reading the query's own
 * terms, rather than restating the threshold here.
 *
 * jsdom does not implement `matchMedia` at all, so these tests have to supply the
 * answer — and a stub handed a boolean would only assert what the test told it.
 * The defect this guards against lived in the constant (`max-width: 820px`
 * matching a device that is exactly 820), which a boolean stub cannot see.
 */
function matchesPhoneQuery(device: Device): boolean {
  // A comma-separated media query list is an OR, so each clause is evaluated on
  // its own and any match wins — the same way a browser reads it.
  return PHONE_MEDIA_QUERY.split(',').some((clause) => {
    const pointer = /\(pointer:\s*([a-z]+)\)/.exec(clause);
    const maxWidth = /\(max-width:\s*(\d+(?:\.\d+)?)px\)/.exec(clause);
    const maxHeight = /\(max-height:\s*(\d+(?:\.\d+)?)px\)/.exec(clause);
    if (!pointer || (!maxWidth && !maxHeight)) {
      throw new Error(`unparsed media query clause: ${clause}`);
    }
    if (device.pointer !== pointer[1]) return false;
    // Both bounds are inclusive, which is exactly how the iPad regression
    // happened: a base iPad is *exactly* 820 and the threshold read 820.
    if (maxWidth && device.width > Number(maxWidth[1])) return false;
    if (maxHeight && device.height > Number(maxHeight[1])) return false;
    return true;
  });
}

function host(device: Device): MediaHost {
  return {
    matchMedia: ((query: string) => {
      if (query !== PHONE_MEDIA_QUERY) throw new Error(`unexpected query: ${query}`);
      return { matches: matchesPhoneQuery(device) } as MediaQueryList;
    }) as MediaHost['matchMedia'],
  };
}

describe('the phone layout predicate', () => {
  it('claims phones in both orientations', () => {
    expect(isPhoneLayout(host({ pointer: 'coarse', width: 393, height: 852 }))).toBe(true);
    // 16 Pro Max in landscape. Width alone would call this a desktop and hand it
    // two rails on the 440px it has left.
    expect(isPhoneLayout(host({ pointer: 'coarse', width: 956, height: 440 }))).toBe(true);
    expect(isPhoneLayout(host({ pointer: 'coarse', width: 320, height: 568 }))).toBe(true);
  });

  it('leaves tablets alone in both orientations', () => {
    // A base iPad in portrait is exactly 820, the number that used to lose.
    expect(isPhoneLayout(host({ pointer: 'coarse', width: 820, height: 1180 }))).toBe(false);
    expect(isPhoneLayout(host({ pointer: 'coarse', width: 1180, height: 820 }))).toBe(false);
    // The mini, the smallest short side any iPad has.
    expect(isPhoneLayout(host({ pointer: 'coarse', width: 744, height: 1133 }))).toBe(false);
  });

  it('leaves a narrow mouse window alone', () => {
    // A cursor can hit a 24px target and a fingertip cannot, so narrowness alone
    // is not a reason to collapse the rails.
    expect(isPhoneLayout(host({ pointer: 'fine', width: 500, height: 800 }))).toBe(false);
  });

  it('lays out as a desktop where media queries cannot be answered', () => {
    expect(isPhoneLayout(null)).toBe(false);
  });

  it('reads the live host when none is given', () => {
    const matchMedia = vi.fn(() => ({ matches: true }) as MediaQueryList);
    vi.stubGlobal('matchMedia', matchMedia);

    expect(isPhoneLayout()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(PHONE_MEDIA_QUERY);

    vi.unstubAllGlobals();
  });
});

describe('the layout predicate against the gate', () => {
  it('answers the same as the gate on the web, where the gate applies', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }) as MediaQueryList)
    );

    expect(isPhoneLayout()).toBe(true);
    expect(isPhoneSurface()).toBe(true);

    vi.unstubAllGlobals();
  });

  it('is not the gate, on the runtime the gate exempts', () => {
    // The whole reason this module exists, asserted through behaviour rather
    // than through the exemption's implementation. A Tauri shell is exempt from
    // the gate — it has no address bar and no way back from `/welcome` — so
    // `isPhoneSurface()` is false there whatever the viewport says. A layout
    // asking *that* question would hand a 393px screen the desktop chrome.
    // `isPhoneLayout` runs the media query unconditionally, so it stays right on
    // every runtime.
    const phoneViewport = { matchMedia: () => ({ matches: true }) } as unknown as Window;
    vi.stubGlobal('window', { ...phoneViewport, __TAURI_INTERNALS__: {} });

    expect(isPhoneLayout(phoneViewport)).toBe(true);
    expect(isPhoneSurface()).toBe(false);
  });
});

/**
 * CSS cannot import the constant, so the query string is written out again in
 * two stylesheets. A copy that drifts does not fail — it just quietly stops
 * matching, and the layout it guards half-applies.
 *
 * Reading the stylesheet from disk is what `styles/themeTokens.test.ts` already
 * does, for the same reason: failing here is cheap, and the alternative is
 * finding out through a layout that looks slightly wrong in a way nobody can
 * place.
 */
describe('the stylesheet copies of the query', () => {
  // Vitest's root is `apps/web`. Resolved from there rather than from
  // `import.meta.url`, which is not a file: URL once Vite has transformed this.
  const files = ['src/App.css', 'src/styles/theme.css'];

  it.each(files)('%s uses the query verbatim', (file) => {
    const css = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(css).toContain(`@media ${PHONE_MEDIA_QUERY} {`);
  });

  it('has no other copy anywhere', () => {
    // A third stylesheet reaching for the phone layout should join the list
    // above rather than restating the numbers, which is how the 820px threshold
    // survived in `WelcomeLanding.css` comments after the constant moved on.
    for (const file of files) {
      const css = readFileSync(resolve(process.cwd(), file), 'utf8');
      const copies = css.split(`@media ${PHONE_MEDIA_QUERY} {`).length - 1;
      expect(copies).toBe(1);
    }
  });
});

/**
 * The bottom bar spends the home-indicator inset on its *buttons*, not on itself.
 *
 * It used to be padding on `.workspace-rail`, which painted the strip and left
 * it inert — 34pt at the bottom of the screen that looked like part of the tab
 * bar and answered no taps, on the edge a thumb rests against. A native tab bar
 * makes the whole thing tappable, and moving the inset into the button's box is
 * what does that here: the visible icon-and-caption block is unchanged, the row
 * still measures `--touch-target`, and the strip below it now belongs to a tab.
 *
 * Asserted against the text because the geometry only exists on a device with a
 * non-zero inset, which no headless run has. Verified in a real engine at
 * 375x812 with the insets stood up by hand: a tap 12px above the bottom edge
 * answered "Edit workspace".
 */
describe('the phone tab bar and the home-indicator inset', () => {
  const phoneBlock = () => {
    const css = readFileSync(resolve(process.cwd(), 'src/App.css'), 'utf8');
    const start = css.indexOf(`@media ${PHONE_MEDIA_QUERY} {`);
    expect(start, 'the phone block moved; this test reads it by its media query').toBeGreaterThan(0);
    // Everything up to the first line-start `}`, which closes the media block.
    const end = css.indexOf('\n}', start);
    return css.slice(start, end);
  };

  const rule = (block: string, selector: string) => {
    const start = block.indexOf(`${selector} {`);
    return start === -1 ? null : block.slice(start, block.indexOf('}', start));
  };

  it('puts the inset on the button, so it is part of the target', () => {
    const button = rule(phoneBlock(), '.workspace-rail__button');
    expect(button).not.toBeNull();
    expect(button).toContain('var(--safe-bottom)');
  });

  it('does not also spend it on the rail, which would double the band', () => {
    const rail = rule(phoneBlock(), '.workspace-rail');
    expect(rail).not.toBeNull();
    // The negative margin stays — it is what hands back `.app-layout`'s own
    // inset so the bar paints through it. A `padding` naming `--safe-bottom`
    // would be the old arrangement, and the two together would reserve 68pt.
    expect(rail).toContain('margin-bottom: calc(-1 * var(--safe-bottom))');
    expect(/padding:[^;]*--safe-bottom/u.test(rail ?? '')).toBe(false);
  });
});
