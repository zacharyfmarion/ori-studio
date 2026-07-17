import type { OristudioCpRgbColor } from '../engine/oristudioCpTypes';

const clampByte = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

const hexByte = (value: number): string => clampByte(value).toString(16).padStart(2, '0');

/** `{ red, green, blue }` → a `#rrggbb` string for an `<input type="color">`. */
export function rgbColorToHex(color: OristudioCpRgbColor): string {
  return `#${hexByte(color.red)}${hexByte(color.green)}${hexByte(color.blue)}`;
}

/**
 * A `#rgb`/`#rrggbb` hex (as produced by `<input type="color">`) → `{ red, green,
 * blue }`. Malformed input falls back to black rather than throwing.
 */
export function hexToRgbColor(hex: string): OristudioCpRgbColor {
  const normalized = hex.trim().replace(/^#/, '');
  const full =
    normalized.length === 3
      ? normalized
          .split('')
          .map((channel) => channel + channel)
          .join('')
      : normalized;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || Number.isNaN(value)) return { red: 0, green: 0, blue: 0 };
  return {
    red: (value >> 16) & 0xff,
    green: (value >> 8) & 0xff,
    blue: value & 0xff,
  };
}
