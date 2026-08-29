export interface ThemeTokens {
  'bg.primary': string;
  'bg.secondary': string;
  'bg.tertiary': string;
  'bg.surface': string;
  'bg.canvas': string;
  'bg.canvasGrid': string;
  'text.primary': string;
  'text.secondary': string;
  'text.muted': string;
  'text.inverse': string;
  'accent.primary': string;
  'accent.hover': string;
  'border.default': string;
  'border.active': string;
  'status.danger': string;
  'status.success': string;
  /**
   * What a selected crease is painted, when `accent.primary` will not do.
   *
   * Selection is the theme's accent by default — that is the theme's own
   * highlight colour and it should stay that way. This exists only for the themes
   * whose accent is confusable with a fold: red is mountain and blue is valley,
   * and since a crease's colour is the only thing that says which it is, a
   * selected mountain painted accent-blue simply reads as a valley.
   *
   * So 11 of 23 themes omit this and keep their accent — gruvbox's orange, ayu's
   * gold, dracula's purple, monokai's green. The 12 that set it are the ones
   * whose accent lands within 28 degrees of hue of mountain or valley; each takes
   * another colour from its *own* palette — mostly its gold, and a deep teal where
   * the gold read as muddy against that theme's canvas.
   *
   * `selectionColor.test.ts` holds the line for both cases.
   */
  'selection.cp'?: string;
  'status.errorBg': string;
  'port.image': string;
  'port.float': string;
  'port.int': string;
  'port.bool': string;
  'port.color': string;
  'port.mask': string;
  'port.field': string;
  'frame.default': string;
  'node.bg': string;
  'node.selected': string;
  'node.shadow': string;
  'node.shadowSelected': string;
  'node.header.input': string;
  'node.header.output': string;
  'node.header.color': string;
  'node.header.filter': string;
  'node.header.composite': string;
  'node.header.transform': string;
  'node.header.generator': string;
  'node.header.matte': string;
  'node.header.group': string;
  'node.header.groupInput': string;
  'node.header.groupOutput': string;
  'node.header.text': string;
  'slider.fill': string;
  'slider.fillHover': string;
  'slider.bg': string;
  'shadow.overlay': string;
  'shadow.contextMenu': string;
  'minimap.mask': string;
}

export interface SyntaxColors {
  comment: string;
  keyword: string;
  type: string;
  variable: string;
  parameter: string;
  port: string;
  function: string;
  number: string;
  string: string;
  operator: string;
  stringEscape: string;
  foreground: string;
}

export interface TreeMakerTheme {
  name: string;
  type: 'dark' | 'light';
  colors: ThemeTokens;
  syntaxColors: SyntaxColors;
}

export function tokenToCssVar(token: string): string {
  return `--${token.replace(/\./g, '-')}`;
}
