/**
 * The foot's refusal note (`LayerOrderDialogFrame.module.css`, `.footNote`)
 * is the theme's primary text on the foot (`--bg-elevated`), its danger said
 * by the icon beside it, not its colour: the danger hue reads under 4.5:1 on
 * the foot in some presets, and so does primary text in the two Solarized
 * ones. So it is `--text-on-elevated`, primary text unless that falls short
 * there (`themes/textOnFill.ts`), held at 4.5:1 or better over every preset.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESET_THEMES, themeCssVariables } from '../../themes';
import { wcagContrast } from '../../themes/paperBack';

const variable = (theme: (typeof PRESET_THEMES)[number], name: string) =>
  themeCssVariables(theme)
    .filter(([key]) => key === name)
    .at(-1)?.[1] ?? '';

describe('the foot’s refusal note', () => {
  it('is set in the text that reads on the foot', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/components/layer-order/LayerOrderDialogFrame.module.css'), 'utf8');
    const footNote = /\.footNote\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(footNote).toMatch(/color:\s*var\(--text-on-elevated,\s*var\(--text-primary\)\);/);
  });

  it.each(PRESET_THEMES.map((theme) => [theme.name, theme] as const))('reads at 4.5:1 or better in %s', (_name, theme) => {
    expect(wcagContrast(variable(theme, '--text-on-elevated'), variable(theme, '--bg-elevated'))).toBeGreaterThanOrEqual(4.5);
  });
});
