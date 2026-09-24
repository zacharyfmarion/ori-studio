import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { useThemeStore } from '../../store/themeStore';
import { applyTheme, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '../../themes';
import { referencesCreaseAlpha, referencesDimAlpha } from '../../themes/referencesInk';
import { createCpLineAppearanceResolver } from '../adapters/cpLineStyle';
import { canvasDiagramInk, CP_CREASE_WIDTH_FACTOR, DIAGRAM_LINE_INK } from './diagram/diagramInk';
import { useReferencesDiagramScene } from './useReferencesDiagramScene';
import {
  REFERENCES_PAPER_TOKENS,
  referencesCanvasPens,
  referencesCardInks,
  referencesPaperTokens,
  usePaperStyleTokens,
  type ReferencesPaperStyle,
} from './usePaperStyleTokens';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MOUNTAIN = '#112233';
const VALLEY = '#445566';
const EDGE = '#778899';
const AUX = '#aabbcc';
const FRONT = '#ddeeff';
const BACK = '#001122';

const hex = ([r, g, b]: readonly number[]): string =>
  `#${[r, g, b].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`;

const rootVar = (name: string) => document.documentElement.style.getPropertyValue(name);

const initialSettings = useSettingsStore.getInitialState();

/** No document: the scene's lines are packed with no sheet in scope. */
const NO_SHEET = { geometry: null, border: null };

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: ReferencesPaperStyle | null = null;
let workspace: HTMLElement | null = null;

/** A workspace root as the panel renders it, with a canvas inside for the resolvers. */
function Workspace() {
  const { setRoot, ...paper } = usePaperStyleTokens();
  useEffect(() => {
    latest = paper;
    workspace = paper.root;
  });
  return (
    <div className="references-workspace" ref={setRoot} style={paper.style}>
      <canvas />
    </div>
  );
}

beforeEach(() => {
  useSettingsStore.setState(initialSettings, true);
  useThemeStore.getState().setTheme(DEFAULT_DARK_THEME);
  applyTheme(DEFAULT_DARK_THEME);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(<Workspace />));
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  latest = null;
  workspace = null;
  useSettingsStore.setState(initialSettings, true);
});

function restyle() {
  act(() => {
    const store = useSettingsStore.getState();
    store.setPaperStyleField('display', 'mountainFolds', {
      ...DEFAULT_PAPER_STYLE.mountainFolds,
      color: MOUNTAIN,
    });
    store.setPaperStyleField('display', 'valleyFolds', {
      ...DEFAULT_PAPER_STYLE.valleyFolds,
      color: VALLEY,
    });
    store.setPaperStyleField('display', 'edges', { ...DEFAULT_PAPER_STYLE.edges, color: EDGE });
    store.setPaperStyleField('display', 'auxCreases.pen', {
      ...DEFAULT_PAPER_STYLE.auxCreases.pen,
      color: AUX,
    });
    store.setPaperStyleField('display', 'paper.front', FRONT);
    store.setPaperStyleField('display', 'paper.back', BACK);
  });
}

describe('referencesPaperTokens', () => {
  // D13: the paper is the style's too, and the alphas are derived against it.
  it('maps the References policy’s paper and inks onto the tokens, with the alphas derived against the paper', () => {
    const tokens = referencesPaperTokens(DEFAULT_PAPER_STYLE);
    const { front, back } = DEFAULT_PAPER_STYLE.paper;
    expect(tokens).toEqual({
      '--references-paper-front': front,
      '--references-paper-back': back,
      '--fold-mountain': DEFAULT_PAPER_STYLE.mountainFolds.color,
      '--fold-valley': DEFAULT_PAPER_STYLE.valleyFolds.color,
      '--fold-border': DEFAULT_PAPER_STYLE.edges.color,
      '--fold-unassigned': DEFAULT_PAPER_STYLE.auxCreases.pen.color,
      '--references-arrow': DEFAULT_PAPER_STYLE.arrows.color,
      '--references-crease-alpha': referencesCreaseAlpha(
        front,
        DEFAULT_PAPER_STYLE.auxCreases.pen.color
      ).toFixed(3),
      '--references-dim-alpha': referencesDimAlpha(
        front,
        DEFAULT_PAPER_STYLE.mountainFolds.color,
        DEFAULT_PAPER_STYLE.valleyFolds.color
      ).toFixed(3),
    });
    expect(Object.keys(tokens)).toEqual([...REFERENCES_PAPER_TOKENS]);
  });

  // E13: the screen draws the arrow pen the export already draws, rather than
  // the edge pen's ink the two built-in presets happened to share with it.
  it('carries the arrow pen’s own colour, apart from the edge’s', () => {
    const style = {
      ...DEFAULT_PAPER_STYLE,
      edges: { ...DEFAULT_PAPER_STYLE.edges, color: '#102030' },
      arrows: { ...DEFAULT_PAPER_STYLE.arrows, color: '#405060' },
    };
    expect(referencesPaperTokens(style)['--references-arrow']).toBe('#405060');
    expect(referencesPaperTokens(style)['--fold-border']).toBe('#102030');
  });

  // X11: the ground ink is the theme's, reached through an alias declared on
  // `:root`. The workspace re-sets the `--fold-*` names, and must never re-set
  // the aliases, or the alias would carry the style's ink.
  it('never sets the theme’s own inks under their alias names', () => {
    for (const token of REFERENCES_PAPER_TOKENS) {
      expect(token.startsWith('--theme-')).toBe(false);
      expect(token).not.toBe('--references-ground-ink');
    }
  });

  it('ignores fields outside the policy', () => {
    const restyled = { ...DEFAULT_PAPER_STYLE, erode: 0.2, light: { ...DEFAULT_PAPER_STYLE.light, azimuth: 90 } };
    expect(referencesPaperTokens(restyled)).toEqual(referencesPaperTokens(DEFAULT_PAPER_STYLE));
  });

  it('derives the alphas against the front face, so a dark paper on a light theme dims like a dark one', () => {
    const dark = { ...DEFAULT_PAPER_STYLE, paper: { front: '#0d1117', back: '#ffffff' } };
    const light = { ...DEFAULT_PAPER_STYLE, paper: { front: '#ffffff', back: '#0d1117' } };
    expect(referencesPaperTokens(dark)['--references-dim-alpha']).not.toBe(
      referencesPaperTokens(light)['--references-dim-alpha']
    );
    expect(Number(referencesPaperTokens(dark)['--references-crease-alpha'])).toBeLessThan(
      Number(referencesPaperTokens(light)['--references-crease-alpha'])
    );
  });
});

describe('usePaperStyleTokens', () => {
  it('sets the tokens on the workspace root from the display style, and leaves :root to the theme', () => {
    const themed = {
      mountain: rootVar('--fold-mountain'),
      valley: rootVar('--fold-valley'),
      border: rootVar('--fold-border'),
      unassigned: rootVar('--fold-unassigned'),
      crease: rootVar('--references-crease-alpha'),
      dim: rootVar('--references-dim-alpha'),
      // The theme never sets a paper for References; the workspace alone does.
      front: rootVar('--references-paper-front'),
      back: rootVar('--references-paper-back'),
    };
    // The theme's own inks are not the defaults, so a match below is the style's doing.
    expect(themed.mountain).not.toBe(DEFAULT_PAPER_STYLE.mountainFolds.color);
    expect(themed.front).toBe('');

    const inline = (name: string) => workspace?.style.getPropertyValue(name);
    expect(inline('--fold-mountain')).toBe(DEFAULT_PAPER_STYLE.mountainFolds.color);
    expect(inline('--fold-border')).toBe(DEFAULT_PAPER_STYLE.edges.color);
    expect(inline('--references-paper-front')).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(inline('--references-paper-back')).toBe(DEFAULT_PAPER_STYLE.paper.back);

    restyle();
    expect(inline('--fold-mountain')).toBe(MOUNTAIN);
    expect(inline('--fold-valley')).toBe(VALLEY);
    expect(inline('--fold-border')).toBe(EDGE);
    expect(inline('--fold-unassigned')).toBe(AUX);
    expect(inline('--references-paper-front')).toBe(FRONT);
    expect(inline('--references-paper-back')).toBe(BACK);
    // D13: against the style's paper, not the theme's ground.
    expect(inline('--references-crease-alpha')).toBe(referencesCreaseAlpha(FRONT, AUX).toFixed(3));
    expect(inline('--references-dim-alpha')).toBe(
      referencesDimAlpha(FRONT, MOUNTAIN, VALLEY).toFixed(3)
    );

    // The Edit canvas reads these off :root, and the theme still owns them there.
    expect({
      mountain: rootVar('--fold-mountain'),
      valley: rootVar('--fold-valley'),
      border: rootVar('--fold-border'),
      unassigned: rootVar('--fold-unassigned'),
      crease: rootVar('--references-crease-alpha'),
      dim: rootVar('--references-dim-alpha'),
      front: rootVar('--references-paper-front'),
      back: rootVar('--references-paper-back'),
    }).toEqual(themed);
  });

  it('carries the arrow pen in CSS px and a key that moves with the inks and the theme', () => {
    expect(latest?.arrowWidth).toBeCloseTo(DEFAULT_PAPER_STYLE.arrows.width * PT_TO_CSS_PX, 9);
    const before = latest?.inkKey;
    act(() =>
      useSettingsStore
        .getState()
        .setPaperStyleField('display', 'arrows', { ...DEFAULT_PAPER_STYLE.arrows, width: 3 })
    );
    expect(latest?.arrowWidth).toBeCloseTo(3 * PT_TO_CSS_PX, 9);
    // The arrow pen is not a colour, so the colour key holds.
    expect(latest?.inkKey).toBe(before);

    restyle();
    const restyled = latest?.inkKey;
    expect(restyled).not.toBe(before);
    act(() => useThemeStore.getState().setTheme(DEFAULT_LIGHT_THEME));
    expect(latest?.inkKey).not.toBe(restyled);
  });

  it('carries the aux pen and switches through the References policy', () => {
    // Phase 5: the aux pen in CSS px, whether the pattern's aux lines show and
    // erode, for the big view's lines; a card derives the same from the
    // display style itself.
    expect(latest?.inks).toEqual({
      aux: {
        pen: DEFAULT_PAPER_STYLE.auxCreases.pen,
        css: DEFAULT_PAPER_STYLE.auxCreases.pen.width * PT_TO_CSS_PX,
      },
      showAux: true,
      erode: 0,
    });
    act(() =>
      useSettingsStore.getState().setPaperStyleFields('display', {
        'auxCreases.visible': false,
        erode: 0.05,
      })
    );
    expect(latest?.inks).toMatchObject({ showAux: false, erode: 0.05 });
    const card = referencesCardInks(useSettingsStore.getState().paperStyle.display);
    expect(card.creases).toEqual({ showAux: false, erode: 0.05 });
    // The References option, once set, is what decides.
    act(() => useSettingsStore.getState().setReferencesShowAuxCreases(true));
    expect(latest?.inks.showAux).toBe(true);
    expect(referencesCardInks(useSettingsStore.getState().paperStyle.display, true).creases).toEqual(
      { showAux: true, erode: 0.05 }
    );
    act(() => useSettingsStore.getState().setReferencesShowAuxCreases(null));
    expect(card.pens.crease.width).toBeCloseTo(
      (DIAGRAM_LINE_INK.edge.width * DEFAULT_PAPER_STYLE.auxCreases.pen.width) /
        DEFAULT_PAPER_STYLE.edges.width,
      9
    );
  });

  it('is what the document’s creases resolve to on a canvas inside the workspace', () => {
    restyle();
    const canvas = workspace?.querySelector('canvas');
    if (!canvas) throw new Error('no canvas');
    const resolve = createCpLineAppearanceResolver('color', 'mvf', canvas);
    expect(hex(resolve('Red1').color)).toBe(MOUNTAIN);
    expect(hex(resolve('Blue2').color)).toBe(VALLEY);
    expect(hex(resolve('Black0').color)).toBe(EDGE);
    // ...and not what the same resolver answers on the document.
    expect(hex(createCpLineAppearanceResolver('color', 'mvf', document.documentElement)('Red1').color)).toBe(
      rootVar('--fold-mountain')
    );
  });
});

describe('the theme’s inks inside the workspace', () => {
  // X11: off the paper a mark draws in the theme's ink, which inside the
  // workspace the style has re-set. The theme's value is carried in by
  // aliases declared on `:root`: a custom property's `var()` is resolved on
  // the element that declares it, and descendants inherit the result.
  //
  // jsdom inherits custom properties but never substitutes `var()`: inside the
  // workspace it hands back the alias's declared text. So the tests show the
  // aliases are declared on `:root` and nowhere else, and then resolve what
  // the workspace inherits there, as a browser does — which lands on the
  // theme's `--fold-border` while the workspace's own is the style's.
  const css = readFileSync(resolve(process.cwd(), 'src/styles/theme.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  );
  /** The first `:root { … }` block, the theme's tokens. */
  const rootBlock = (() => {
    const start = css.indexOf(':root {');
    return css.slice(start, css.indexOf('}', start) + 1);
  })();
  const ALIASES = {
    '--theme-fold-mountain': 'var(--fold-mountain)',
    '--theme-fold-valley': 'var(--fold-valley)',
    '--theme-fold-border': 'var(--fold-border)',
    '--theme-fold-unassigned': 'var(--fold-unassigned)',
    '--references-ground-ink': 'var(--theme-fold-border)',
  };

  it('declares an alias for each ink the workspace re-sets on :root, and nowhere else', () => {
    for (const [alias, value] of Object.entries(ALIASES)) {
      expect(rootBlock).toContain(`${alias}: ${value};`);
      // Declared once in the whole stylesheet: never re-pointed below `:root`.
      expect(css.split(`${alias}:`).length - 1, alias).toBe(1);
    }
    // Every `--fold-*` ink the style re-sets has one.
    for (const token of REFERENCES_PAPER_TOKENS.filter((name) => name.startsWith('--fold-'))) {
      expect(ALIASES).toHaveProperty(`--theme-${token.slice(2)}`);
    }
  });

  /**
   * A custom property as a browser reads it on `element`: each `var()` it
   * holds resolved where it was declared — on `:root`, which the test above
   * shows is the only place the aliases are. jsdom hands back the declared
   * text; a browser hands back the colour, which is taken as it is.
   */
  const resolvedOn = (element: Element, name: string): string => {
    let value = getComputedStyle(element).getPropertyValue(name).trim();
    for (let hops = 0; hops < 8; hops += 1) {
      const reference = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
      if (!reference) break;
      value = getComputedStyle(document.documentElement).getPropertyValue(reference[1]!).trim();
    }
    return value;
  };

  it.each([
    ['dark', DEFAULT_DARK_THEME],
    ['light', DEFAULT_LIGHT_THEME],
  ])('inside the workspace, gives the %s theme’s ink while --fold-border is the style’s', (_, theme) => {
    const style = document.createElement('style');
    style.textContent = rootBlock;
    document.head.append(style);
    try {
      act(() => {
        useThemeStore.getState().setTheme(theme);
        applyTheme(theme);
      });
      restyle();
      const canvas = workspace?.querySelector('canvas');
      if (!canvas) throw new Error('no canvas');
      const themes = rootVar('--fold-border');
      expect(themes).not.toBe('');
      expect(themes).not.toBe(EDGE);
      expect(getComputedStyle(canvas).getPropertyValue('--fold-border')).toBe(EDGE);
      expect(resolvedOn(canvas, '--references-ground-ink')).toBe(themes);
      expect(resolvedOn(canvas, '--theme-fold-border')).toBe(themes);
      // Nothing on the way down re-points them.
      expect(workspace?.style.getPropertyValue('--references-ground-ink')).toBe('');
      expect(workspace?.style.getPropertyValue('--theme-fold-border')).toBe('');
    } finally {
      style.remove();
    }
  });

  it('draws a mark off the paper in the alias, and the arrow in the arrow pen on it', () => {
    const rule = (selector: string) => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThanOrEqual(0);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(rule('.step-diagram__line--arrow')).toContain(
      'stroke: var(--references-arrow, var(--fold-border));'
    );
    expect(rule('.step-diagram__arrowhead')).toContain(
      'fill: var(--references-arrow, var(--fold-border));'
    );
    expect(rule('.step-diagram__ground .step-diagram__line--arrow')).toContain(
      'stroke: var(--references-ground-ink);'
    );
    expect(rule('.step-diagram__ground .step-diagram__arrowhead')).toContain(
      'fill: var(--references-ground-ink);'
    );
    expect(rule('.step-diagram__ground .step-diagram__point')).toContain(
      'stroke: var(--references-ground-ink);'
    );
  });

  it('sets the arrow pen on the workspace root, from the display style', () => {
    const inline = (name: string) => workspace?.style.getPropertyValue(name);
    expect(inline('--references-arrow')).toBe(DEFAULT_PAPER_STYLE.arrows.color);
    act(() =>
      useSettingsStore
        .getState()
        .setPaperStyleField('display', 'arrows', { ...DEFAULT_PAPER_STYLE.arrows, color: '#405060' })
    );
    expect(inline('--references-arrow')).toBe('#405060');
    // A colour the canvas re-reads: the ink key moves with it.
    expect(latest?.tokens['--references-arrow']).toBe('#405060');
  });
});

describe('useReferencesDiagramScene', () => {
  it('packs the lines in the workspace’s inks and repacks when they change', () => {
    const diagram = {
      sheet: { width: 1, height: 1, centre: [0.5, 0.5] as [number, number] },
      primitives: [
        { kind: 'sheet' as const, width: 1, height: 1 },
        { kind: 'line' as const, from: [0, 0] as [number, number], to: [1, 1] as [number, number], style: 'mountain' as const },
      ],
    };
    const scenes: ReturnType<typeof useReferencesDiagramScene>[] = [];
    function Probe() {
      const { setRoot, ...paper } = usePaperStyleTokens();
      const scene = useReferencesDiagramScene(diagram, false, paper, NO_SHEET);
      useEffect(() => {
        scenes.push(scene);
      });
      return <div ref={setRoot} style={paper.style} />;
    }
    const probeContainer = document.createElement('div');
    document.body.appendChild(probeContainer);
    const probeRoot = createRoot(probeContainer);
    act(() => probeRoot.render(<Probe />));
    const packed = (scene: ReturnType<typeof useReferencesDiagramScene>) =>
      hex([...(scene.strokes?.color.slice(0, 3) ?? [])]);
    expect(packed(scenes[scenes.length - 1]!)).toBe(DEFAULT_PAPER_STYLE.mountainFolds.color);
    restyle();
    expect(packed(scenes[scenes.length - 1]!)).toBe(MOUNTAIN);
    act(() => probeRoot.unmount());
    probeContainer.remove();
  });

  // X11: an arrow-style line is cut at the outline the canvas fills — the
  // hull of the sheet's border creases — and the piece off it is handed to
  // the renderer in the ground's ink, the theme's. jsdom does not resolve the
  // alias, so the probe carries the value a browser would read off it.
  it('cuts an arrow-style line at the sheet the canvas fills, off it in the theme’s ink', () => {
    const geometry = {
      segEndpoints: Float64Array.from([
        ...[0, 0, 100, 0],
        ...[100, 0, 100, 100],
        ...[100, 100, 0, 100],
        ...[0, 100, 0, 0],
      ]),
      segAttr: new Int32Array(20),
    } as unknown as CpGeometryTransport;
    const border = new Set([1, 2, 3, 4]);
    const diagram = {
      sheet: { width: 100, height: 100, centre: [50, 50] as [number, number] },
      primitives: [
        { kind: 'line' as const, from: [50, 50] as [number, number], to: [150, 50] as [number, number], style: 'arrow' as const },
      ],
    };
    const scenes: ReturnType<typeof useReferencesDiagramScene>[] = [];
    function Probe() {
      const { setRoot, ...paper } = usePaperStyleTokens();
      const scene = useReferencesDiagramScene(diagram, false, paper, { geometry, border });
      useEffect(() => {
        scenes.push(scene);
      });
      return (
        <div
          ref={setRoot}
          style={{ ...paper.style, ['--references-ground-ink' as string]: '#e6e6e6' }}
        />
      );
    }
    const probeContainer = document.createElement('div');
    document.body.appendChild(probeContainer);
    const probeRoot = createRoot(probeContainer);
    act(() => probeRoot.render(<Probe />));
    // Once the root has mounted, the ground ink is read off it.
    act(() => probeRoot.render(<Probe />));
    const scene = scenes[scenes.length - 1]!;
    expect(scene.outline.map(([x, y]) => `${x},${y}`).sort()).toEqual(
      ['0,0', '100,0', '100,100', '0,100'].sort()
    );
    expect(scene.strokes?.count).toBe(2);
    const ink = (i: number) => hex([...(scene.strokes?.color.slice(i * 4, i * 4 + 3) ?? [])]);
    expect(ink(0)).toBe(DEFAULT_PAPER_STYLE.arrows.color);
    expect(ink(1)).toBe('#e6e6e6');
    expect(Array.from(scene.strokes!.a.slice(2, 4))).toEqual([100, 50]);
    act(() => probeRoot.unmount());
    probeContainer.remove();
  });
});

describe('referencesCanvasPens', () => {
  // The References line width is the edge pen: every References ink is
  // measured from it, in place of the editor's View ▸ Line width.
  it('measures the big view from the edge pen, and draws each pen at its own width', () => {
    const style = {
      ...DEFAULT_PAPER_STYLE,
      edges: { ...DEFAULT_PAPER_STYLE.edges, width: 0.9 },
      mountainFolds: { ...DEFAULT_PAPER_STYLE.mountainFolds, width: 0.75 },
    };
    const { lineWidth, pens } = referencesCanvasPens(style);
    const edgeCss = 0.9 * PT_TO_CSS_PX;
    expect(CP_CREASE_WIDTH_FACTOR * lineWidth).toBeCloseTo(edgeCss, 9);
    const ink = canvasDiagramInk(lineWidth);
    expect(pens.edge.width * ink).toBeCloseTo(edgeCss, 9);
    expect(pens.mountain.width * ink).toBeCloseTo(0.75 * PT_TO_CSS_PX, 9);
    expect(pens.aux.width * ink).toBeCloseTo(DEFAULT_PAPER_STYLE.auxCreases.pen.width * PT_TO_CSS_PX, 9);
    expect(pens.arrow.width * ink).toBeCloseTo(DEFAULT_PAPER_STYLE.arrows.width * PT_TO_CSS_PX, 9);
  });

  it('dashes the folds as the style does: solid when solid', () => {
    expect(
      referencesCanvasPens({
        ...DEFAULT_PAPER_STYLE,
        valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, dash: null },
      }).pens.valley.dash
    ).toBeUndefined();
    const dashed = referencesCanvasPens({
      ...DEFAULT_PAPER_STYLE,
      valleyFolds: { ...DEFAULT_PAPER_STYLE.valleyFolds, dash: [4, 2] },
    }).pens.valley;
    expect(dashed.dash!.map((run) => run / dashed.width)).toEqual([4, 2]);
  });
});
