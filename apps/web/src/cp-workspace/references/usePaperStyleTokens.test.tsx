import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { useSettingsStore } from '../../store/settingsStore';
import { useThemeStore } from '../../store/themeStore';
import { applyTheme, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '../../themes';
import { referencesCreaseAlpha, referencesDimAlpha } from '../../themes/referencesInk';
import { createCpLineAppearanceResolver } from '../adapters/cpLineStyle';
import { DIAGRAM_LINE_INK } from './diagram/diagramInk';
import { useReferencesDiagramScene } from './useReferencesDiagramScene';
import {
  REFERENCES_PAPER_TOKENS,
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

  it('carries the existing creases’ pen and switches through the References policy', () => {
    // Phase 5: the aux pen in CSS px, the toggle and erode, for the big view's
    // lines; a card derives the same from the display style itself.
    expect(latest?.inks).toEqual({
      aux: {
        pen: DEFAULT_PAPER_STYLE.auxCreases.pen,
        css: DEFAULT_PAPER_STYLE.auxCreases.pen.width * PT_TO_CSS_PX,
      },
      auxVisible: true,
      erode: 0,
    });
    act(() =>
      useSettingsStore.getState().setPaperStyleFields('display', {
        'auxCreases.visible': false,
        erode: 0.05,
      })
    );
    expect(latest?.inks).toMatchObject({ auxVisible: false, erode: 0.05 });
    const card = referencesCardInks(useSettingsStore.getState().paperStyle.display);
    expect(card.creases).toEqual({ visible: false, erode: 0.05 });
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
      const scene = useReferencesDiagramScene(diagram, 1, false, paper);
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
});
