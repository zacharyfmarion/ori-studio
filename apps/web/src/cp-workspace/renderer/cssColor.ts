import type { Rgba } from './types';

/**
 * Parse a CSS colour string into normalised {@link Rgba}. Supports the forms the
 * theme actually emits: `#rgb`, `#rrggbb`, and `rgb()/rgba()`. Returns `null` for
 * anything it does not understand so callers can fall back explicitly.
 *
 * Note: channels are copied through linearly (no sRGB decode) — sufficient for
 * clearing the canvas to a themed background.
 */
export function parseCssColor(input: string): Rgba | null {
  const value = input.trim();
  if (value === '') return null;

  if (value.startsWith('#')) {
    const hex = value.slice(1);
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((c) => c + c)
            .join('')
        : hex;
    if (full.length !== 6 || !/^[0-9a-fA-F]{6}$/.test(full)) return null;
    const n = Number.parseInt(full, 16);
    return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255, 1];
  }

  const match = value.match(/^rgba?\(([^)]+)\)$/);
  if (match) {
    const parts = match[1].split(',').map((p) => Number.parseFloat(p.trim()));
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    const alpha = parts.length >= 4 && !Number.isNaN(parts[3]) ? parts[3] : 1;
    return [parts[0] / 255, parts[1] / 255, parts[2] / 255, alpha];
  }

  return null;
}

/**
 * Read a CSS custom property from `element` and parse it as a colour, falling
 * back to `fallback` when the variable is unset or unparseable.
 */
export function readCssVarColor(element: Element, varName: string, fallback: Rgba): Rgba {
  const raw = getComputedStyle(element).getPropertyValue(varName);
  return parseCssColor(raw) ?? fallback;
}
