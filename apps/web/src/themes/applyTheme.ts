import { mixHexColors } from '../lib/rgbColor';
import type { ThemeTokens, TreeMakerTheme } from './types';
import { tokenToCssVar } from './types';

/**
 * Tokens every theme must define, which is every one except the optional
 * `selection.cp`. Naming them structurally rather than as `keyof ThemeTokens`
 * keeps this map's values `string` — an optional token would widen them to
 * `string | undefined` and there is nothing sensible to set a CSS variable to in
 * that case. Anything optional belongs in `applyTreeMakerDerivedTokens`, where it
 * can state its own fallback.
 */
type RequiredThemeToken = {
  [K in keyof ThemeTokens]-?: undefined extends ThemeTokens[K] ? never : K;
}[keyof ThemeTokens];

const TOKEN_VARIABLE_MAP: Array<[RequiredThemeToken, string]> = [
  ['bg.primary', '--bg-primary'],
  ['bg.secondary', '--bg-secondary'],
  ['bg.tertiary', '--bg-tertiary'],
  ['bg.tertiary', '--bg-elevated'],
  ['bg.surface', '--bg-surface'],
  ['bg.canvas', '--bg-canvas'],
  ['bg.canvasGrid', '--bg-canvas-grid'],
  ['text.primary', '--text-primary'],
  ['text.secondary', '--text-secondary'],
  ['text.muted', '--text-tertiary'],
  ['text.muted', '--text-muted'],
  ['text.inverse', '--text-inverse'],
  ['accent.primary', '--accent-primary'],
  ['accent.hover', '--accent-hover'],
  ['border.default', '--border-default'],
  ['border.active', '--border-strong'],
  ['status.success', '--status-success'],
  ['status.danger', '--status-danger'],
  ['port.color', '--accent-secondary'],
  ['port.color', '--status-warning'],
  ['port.image', '--accent-tertiary'],
  ['port.image', '--status-info'],
  ['shadow.overlay', '--shadow-overlay'],
  ['shadow.contextMenu', '--shadow-context-menu'],
];

const MOUNTAIN_VALLEY_COLORS = {
  dark: {
    mountain: '#ff4d5d',
    valley: '#60a5fa',
    // Oriedita CYAN_3 auxiliary/flat crease color.
    aux: '#64c8c8',
  },
  light: {
    mountain: '#d91f3a',
    valley: '#2563eb',
    aux: '#2f9c9c',
  },
} as const;

/**
 * The References workspace's two highlight colours: the references a step uses
 * (`input`) and the crease it makes (`new`). Neither may be a crease hue —
 * every hue the palette gives a crease (red, blue, cyan, orange, magenta,
 * green, yellow, purple, teal) is spoken for, and `--cp-selection` is a theme's
 * gold — so these sit in the two gaps the wheel has left: a lime at ~83°
 * (35° from yellow, 59° from green) and a pink at ~323° (31° from magenta, 32°
 * from mountain red), each ≥ 28° from every fold hue, which is the distance
 * `selectionColor.test.ts` holds selections to. Light variants are the same
 * hues darkened to read on a light canvas.
 */
const REFERENCE_COLORS = {
  dark: { input: '#f25ab8', new: '#a3e635' },
  light: { input: '#c91d87', new: '#4d7c0f' },
} as const;

function colorMix(color: string, amount: number): string {
  return `color-mix(in srgb, ${color} ${amount}%, transparent)`;
}

/**
 * Oriedita's `GREY_10` (`#A2A2A2`) — the black-and-white line style's valley — is
 * its black ink washed out over white paper: exactly black at 36.5%. Reproduce
 * that *relationship* against the theme's own ink and canvas rather than the
 * literal colour, so the style stays legible whichever way the theme runs.
 */
/** How much of the paper survives in its colour side: the legend's 30% grey. */
const PAPER_BACK_RATIO = 0.7;

const MONOCHROME_VALLEY_INK_RATIO = 0.365;

function applyTreeMakerDerivedTokens(theme: TreeMakerTheme, setVar: (name: string, value: string) => void) {
  const { colors } = theme;
  const isLight = theme.type === 'light';

  setVar('--border-subtle', colorMix(colors['border.default'], isLight ? 72 : 48));
  setVar('--overlay-dim', colors['shadow.overlay']);
  setVar('--bg-paper', isLight ? '#fffdf7' : '#f2f0e7');
  setVar('--paper-shadow', colorMix(colors['text.primary'], isLight ? 18 : 28));
  setVar('--paper-stroke', colorMix(colors['text.primary'], isLight ? 70 : 62));
  // The paper's other face, following the origami house's own legend: white
  // side is the paper, colour side a 30% grey against it. Mixed here rather
  // than with `color-mix()` in the stylesheet because a WebGL canvas reads it
  // through `parseCssColor`, which understands hex and rgb() and nothing else —
  // the same reason `--fold-monochrome-valley` below is mixed in JS.
  setVar('--paper-back', mixHexColors(colors['bg.primary'], colors['text.primary'], PAPER_BACK_RATIO));

  setVar('--tree-edge', colors['text.primary']);
  setVar('--tree-node', colors['bg.tertiary']);
  setVar('--tree-node-stroke', isLight ? colors['bg.primary'] : colors['text.inverse']);
  setVar('--tree-label', colors['text.primary']);
  setVar('--tree-label-stroke', isLight ? colorMix(colors['bg.primary'], 86) : colorMix(colors['bg.secondary'], 82));

  setVar('--fold-mountain', MOUNTAIN_VALLEY_COLORS[theme.type].mountain);
  setVar('--fold-valley', MOUNTAIN_VALLEY_COLORS[theme.type].valley);
  setVar('--fold-flat', MOUNTAIN_VALLEY_COLORS[theme.type].aux);
  setVar('--fold-border', colors['text.primary']);
  // The theme's own accent, unless that accent is confusable with a fold colour —
  // red is mountain, blue is valley, and a selected crease is painted this outright,
  // so either would be read as its assignment. See `selection.cp` in themes/types.
  setVar('--cp-selection', colors['selection.cp'] ?? colors['accent.primary']);
  setVar('--cp-reference-input', REFERENCE_COLORS[theme.type].input);
  setVar('--cp-reference-new', REFERENCE_COLORS[theme.type].new);
  setVar(
    '--fold-monochrome-valley',
    mixHexColors(colors['text.primary'], colors['bg.canvas'], MONOCHROME_VALLEY_INK_RATIO)
  );
  setVar('--fold-ridge', colors['status.danger']);
  setVar('--fold-hinge', colors['port.image']);
  setVar('--fold-pseudohinge', colors['port.bool']);
  setVar('--fold-gusset', colorMix(colors['text.primary'], 70));

  setVar('--domain-overlay-bg', colorMix(colors['bg.primary'], isLight ? 88 : 82));
  setVar('--domain-danger-border', colorMix(colors['status.danger'], 64));
  setVar('--leaf-radius-fill', colorMix(colors['port.image'], isLight ? 16 : 13));
  setVar('--leaf-radius-stroke', colorMix(colors['port.image'], isLight ? 50 : 48));
}

export function applyTheme(theme: TreeMakerTheme): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  for (const [token, value] of Object.entries(theme.colors)) {
    root.style.setProperty(tokenToCssVar(token), value);
  }
  for (const [token, variable] of TOKEN_VARIABLE_MAP) {
    root.style.setProperty(variable, theme.colors[token]);
  }
  applyTreeMakerDerivedTokens(theme, (name, value) => root.style.setProperty(name, value));
  root.setAttribute('data-theme-type', theme.type);
  root.setAttribute('data-theme-name', theme.name);
}
