import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PRESET_THEMES, themeCssVariables } from '.';

/**
 * The start screen's action cards, read from the real stylesheet and resolved against every
 * preset. Lighthouse flagged the description at 3.75:1 in One Dark; this keeps it at WCAG AA
 * (4.5:1) in every theme whose own body text can reach it.
 */

const APP_CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'App.css'), 'utf8');

type Rgb = [number, number, number];

function declaration(selector: string, property: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*');
  const rule = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(APP_CSS);
  if (!rule) throw new Error(`App.css has no rule for ${selector}`);
  const value = new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*([^;]+);`).exec(rule[1]);
  if (!value) throw new Error(`${selector} sets no ${property}`);
  return value[1].trim();
}

/** Split at commas that are not inside parentheses. */
function topLevelArgs(inner: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === '(') depth += 1;
    else if (inner[i] === ')') depth -= 1;
    else if (inner[i] === ',' && depth === 0) {
      args.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  args.push(inner.slice(start).trim());
  return args;
}

/** The subset of CSS colour syntax these rules use: hex, `var()` and srgb `color-mix()`. */
function resolveColor(expression: string, variables: Map<string, string>): Rgb {
  const value = expression.trim();
  const reference = /^var\((--[\w-]+)\)$/.exec(value);
  if (reference) {
    const resolved = variables.get(reference[1]);
    if (resolved === undefined) throw new Error(`${reference[1]} is not set by the theme`);
    return resolveColor(resolved, variables);
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((d) => d + d).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
  }
  const mix = /^color-mix\(in srgb,(.*)\)$/s.exec(value);
  if (mix) {
    const [first, second] = topLevelArgs(mix[1]).map((part) => {
      const weighted = /^(.*?)\s+([\d.]+)%$/.exec(part);
      return weighted
        ? { color: weighted[1], weight: Number(weighted[2]) / 100 }
        : { color: part, weight: null };
    });
    const firstWeight = first.weight ?? 1 - (second.weight ?? 0.5);
    const a = resolveColor(first.color, variables);
    const b = resolveColor(second.color, variables);
    return a.map((channel, i) => channel * firstWeight + b[i] * (1 - firstWeight)) as Rgb;
  }
  throw new Error(`Unsupported colour expression: ${value}`);
}

function luminance([r, g, b]: Rgb): number {
  const linear = (channel: number) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function contrast(a: Rgb, b: Rgb): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

const DESCRIPTION = declaration('.start-action__description', 'color');
const BACKGROUNDS = {
  resting: declaration('.start-action', 'background'),
  hovered: declaration('.start-action:hover:not(:disabled),\n.start-action:focus-visible', 'background'),
};

describe('start action description contrast', () => {
  it.each(PRESET_THEMES.map((theme) => [theme.name, theme] as const))('%s', (_name, theme) => {
    const variables = new Map(themeCssVariables(theme));
    const text = resolveColor(DESCRIPTION, variables);
    const body = resolveColor('var(--text-primary)', variables);
    for (const background of Object.values(BACKGROUNDS)) {
      const surface = resolveColor(background, variables);
      // Solarized's own body text is below AA on this surface, so no description colour
      // can reach it there; those palettes are held to the 3:1 floor instead.
      const required = contrast(body, surface) >= 4.5 ? 4.5 : 3;
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(required);
    }
  });
});
