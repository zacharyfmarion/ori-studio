import { useMemo, useState, type CSSProperties } from 'react';
import { PT_TO_CSS_PX, type PaperStyle } from '../../lib/paper/paperStyle';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { useSettingsStore } from '../../store/settingsStore';
import { useThemeStore } from '../../store/themeStore';
import { referencesCreaseAlpha, referencesDimAlpha } from '../../themes/referencesInk';

/**
 * The paper style's paper and inks, as the custom properties the References
 * workspace draws with.
 *
 * Every colour in this workspace — the card's classes in `theme.css`, the
 * canvas's `diagramColors.ts`, the document's own creases through the editor's
 * resolver — is one of the `--fold-*` tokens the theme sets on `:root`. Those
 * tokens are global on purpose: the Edit canvas's line colours are Oriedita
 * parity and follow the theme. So the style re-sets the same names on the
 * workspace root alone (`.references-workspace`, D12), and everything inside
 * it follows the style while the editor keeps the theme's values. Nothing
 * here touches `:root`.
 *
 * The sheet is the style's paper (D13): `--references-paper-front` and
 * `--references-paper-back` are what a step's sheet — the card's, the big
 * view's, and the flap during a fold — is filled with, the back when the view
 * is mirrored. The workspace's ground stays the theme's. The two alphas come
 * with them: how faint an earlier crease's grey and an earlier step's creases
 * draw is derived from the style's inks over the style's paper
 * (`referencesInk.ts`), because that is what they sit on.
 */
export const REFERENCES_PAPER_TOKENS = [
  '--references-paper-front',
  '--references-paper-back',
  '--fold-mountain',
  '--fold-valley',
  '--fold-border',
  '--fold-unassigned',
  '--references-crease-alpha',
  '--references-dim-alpha',
] as const;

export type ReferencesPaperToken = (typeof REFERENCES_PAPER_TOKENS)[number];
export type ReferencesPaperTokens = Readonly<Record<ReferencesPaperToken, string>>;

export interface ReferencesPaperStyle {
  /** The tokens, as the workspace root's inline style. */
  style: CSSProperties;
  /** The workspace root the tokens are set on, once it has mounted; `null` before. */
  root: HTMLElement | null;
  /**
   * The same values by name, for a reader that runs in the render that sets
   * them — before the DOM carries them (`diagramInkColors`).
   */
  tokens: ReferencesPaperTokens;
  /** The style's arrow pen, in CSS px, for the diagram drawn over the canvas. */
  arrowWidth: number;
  /**
   * Changes when any colour the workspace reads off the DOM changes — the
   * theme's or the style's — so an effect that resolved colours re-reads them.
   */
  inkKey: string;
}

/**
 * The tokens for `style`; the References policy decides which fields count.
 *
 * The alphas are derived against the front face: one token serves every card
 * on the strip, and a strip mixes faces once a plan turns the paper over.
 */
export function referencesPaperTokens(style: PaperStyle): ReferencesPaperTokens {
  const seen = applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.references);
  const paper = seen.paper.front;
  const mountain = seen.mountainFolds.color;
  const valley = seen.valleyFolds.color;
  const aux = seen.auxCreases.pen.color;
  return {
    '--references-paper-front': paper,
    '--references-paper-back': seen.paper.back,
    '--fold-mountain': mountain,
    '--fold-valley': valley,
    '--fold-border': seen.edges.color,
    '--fold-unassigned': aux,
    '--references-crease-alpha': referencesCreaseAlpha(paper, aux).toFixed(3),
    '--references-dim-alpha': referencesDimAlpha(paper, mountain, valley).toFixed(3),
  };
}

/** React's `CSSProperties` has no slot for custom properties; the cast is named once. */
function cssVars(vars: ReferencesPaperTokens): CSSProperties {
  return vars as CSSProperties;
}

/**
 * The display style's paper and inks for the workspace root, live on the style
 * and the theme, with the root's `ref` beside them so the readers know where
 * the tokens are. Take `setRoot` off the object where it is used as a `ref` —
 * `const { setRoot, ...paper } = usePaperStyleTokens()` — or the compiler
 * reads the whole object as a ref and refuses it in render.
 */
export function usePaperStyleTokens(): ReferencesPaperStyle & {
  setRoot: (element: HTMLElement | null) => void;
} {
  const display = useSettingsStore((state) => state.paperStyle.display);
  const theme = useThemeStore((state) => state.currentTheme);
  // State, not a ref: a reader resolves colours against it during render, and
  // a ref's `current` is not for reading there.
  const [root, setRoot] = useState<HTMLElement | null>(null);
  return useMemo(() => {
    const tokens = referencesPaperTokens(display);
    return {
      style: cssVars(tokens),
      root,
      setRoot,
      tokens,
      arrowWidth: display.arrows.width * PT_TO_CSS_PX,
      inkKey: [theme.name, ...REFERENCES_PAPER_TOKENS.map((token) => tokens[token])].join('|'),
    };
  }, [display, theme, root]);
}
