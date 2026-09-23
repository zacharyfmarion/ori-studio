import { useMemo, useState, type CSSProperties } from 'react';
import { PT_TO_CSS_PX, type PaperStyle, type Pen } from '../../lib/paper/paperStyle';
import { applyPaperStylePolicy, PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
import { useSettingsStore } from '../../store/settingsStore';
import { useThemeStore } from '../../store/themeStore';
import { referencesCreaseAlpha, referencesDimAlpha } from '../../themes/referencesInk';
import type { DiagramCreaseOptions } from './diagram/DiagramPrimitives';
import {
  canvasDiagramPens,
  cardDiagramPens,
  CP_CREASE_WIDTH_FACTOR,
  type DiagramPens,
} from './diagram/diagramInk';
import { referencesShowsAux } from './referencesAuxCreases';

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

/**
 * What the style says about the lines drawn in its aux pen — the creases an
 * earlier step made and the pattern's own aux lines — beyond their colour:
 * the pen, whether the aux lines are drawn (`referencesAuxCreases`), and how
 * far such a line is pulled back from the sheet's edge (D8). For the big
 * view's lines (`useReferencesDiagramScene`) and the layer over it.
 */
export interface ReferencesPaperInks {
  /** The aux pen through the References policy, and its width in CSS px. */
  aux: { pen: Pen; css: number };
  /** Whether the pattern's aux lines are drawn: the References option, or the style's switch. */
  showAux: boolean;
  /** Erode, as a fraction of the sheet. */
  erode: number;
}

/**
 * The big view's pens: the style's, in one ink measured from its edge pen.
 *
 * The References line width is the edge pen — the width at which the editor's
 * crease law (`CP_CREASE_WIDTH_FACTOR`) draws a crease exactly the edge pen's
 * CSS px — so the creases and the diagram's lines over them follow Settings ▸
 * Paper. The letters, rings and arrows over those do not: they are sized from
 * the reader's own line width (View ▸ Line width), as they always were, so a
 * hairline edge pen does not shrink the lettering until it cannot be read.
 */
export interface ReferencesCanvasPens {
  lineWidth: number;
  /** The diagram's pens in that ink: the style's edge, fold, aux and arrow pens over the table. */
  pens: DiagramPens;
}

/** The same, for a card: the pens at the card's scale, and the crease switches. */
export interface ReferencesCardInks {
  pens: DiagramPens;
  creases: DiagramCreaseOptions;
}

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
  /** The aux pen and switches, for the diagram drawn over the canvas and the sheet's aux lines. */
  inks: ReferencesPaperInks;
  /** The big view's pens, and the line width they are measured from. */
  canvasPens: ReferencesCanvasPens;
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

/**
 * The aux pen and switches for `style`, through the References policy, with
 * the References "Show auxiliary creases" option (`null` follows the style).
 */
export function referencesPaperInks(
  style: PaperStyle,
  showAuxOption: boolean | null = null
): ReferencesPaperInks {
  const seen = applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.references);
  return {
    aux: { pen: seen.auxCreases.pen, css: seen.auxCreases.pen.width * PT_TO_CSS_PX },
    showAux: referencesShowsAux(style, showAuxOption),
    erode: seen.erode,
  };
}

/** The big view's pens for `style`, through the References policy. */
export function referencesCanvasPens(style: PaperStyle): ReferencesCanvasPens {
  const seen = applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.references);
  const css = (pen: Pen) => ({ pen, css: pen.width * PT_TO_CSS_PX });
  const edge = css(seen.edges);
  const lineWidth = edge.css / CP_CREASE_WIDTH_FACTOR;
  return {
    lineWidth,
    pens: canvasDiagramPens(lineWidth, seen.arrows.width * PT_TO_CSS_PX, css(seen.auxCreases.pen), {
      edge,
      mountain: css(seen.mountainFolds),
      valley: css(seen.valleyFolds),
    }),
  };
}

/** A card's pens and crease switches for `style`, as {@link referencesPaperInks}. */
export function referencesCardInks(
  style: PaperStyle,
  showAuxOption: boolean | null = null
): ReferencesCardInks {
  const seen = applyPaperStylePolicy(style, PAPER_STYLE_POLICIES.references);
  return {
    pens: cardDiagramPens(seen),
    creases: { showAux: referencesShowsAux(style, showAuxOption), erode: seen.erode },
  };
}

/**
 * {@link referencesCardInks} for the display style and the References option,
 * live. A card reads it itself rather than being handed it: the strip mounts
 * one per step and the style reaches all of them through the store, as the
 * colours reach them through the workspace root's tokens.
 */
export function useReferencesCardInks(): ReferencesCardInks {
  const display = useSettingsStore((state) => state.paperStyle.display);
  const showAux = useSettingsStore((state) => state.referencesShowAuxCreases);
  return useMemo(() => referencesCardInks(display, showAux), [display, showAux]);
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
  const showAux = useSettingsStore((state) => state.referencesShowAuxCreases);
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
      inks: referencesPaperInks(display, showAux),
      canvasPens: referencesCanvasPens(display),
      inkKey: [theme.name, ...REFERENCES_PAPER_TOKENS.map((token) => tokens[token])].join('|'),
    };
  }, [display, showAux, theme, root]);
}
