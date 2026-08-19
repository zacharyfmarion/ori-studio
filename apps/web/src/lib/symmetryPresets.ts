import type { Point } from './geometry';

export type SymmetryPreset = 'book' | 'diagonal';
export type SymmetrySelectValue = 'none' | SymmetryPreset | 'custom';
export type SymmetryVariant = 'vertical' | 'horizontal' | 'risingDiagonal' | 'fallingDiagonal';

export interface SymmetryPresetOption {
  preset: SymmetryPreset;
  variant: SymmetryVariant;
  label: string;
  angle: number;
}

export const SYMMETRY_PRESET_LABELS: Record<SymmetryPreset, string> = {
  book: 'Book',
  diagonal: 'Diagonal',
};

export const SYMMETRY_PRESET_OPTIONS: SymmetryPresetOption[] = [
  { preset: 'book', variant: 'vertical', label: 'Vertical', angle: 90 },
  { preset: 'book', variant: 'horizontal', label: 'Horizontal', angle: 0 },
  { preset: 'diagonal', variant: 'risingDiagonal', label: 'Bottom-left to top-right', angle: 45 },
  { preset: 'diagonal', variant: 'fallingDiagonal', label: 'Top-left to bottom-right', angle: 135 },
];

const SYMMETRY_MATCH_EPSILON = 0.000_001;

function normalizeAngle(angle: number): number {
  return ((angle % 180) + 180) % 180;
}

function angleDistance(a: number, b: number): number {
  const diff = Math.abs(normalizeAngle(a) - normalizeAngle(b));
  return Math.min(diff, 180 - diff);
}

export function symmetryOptionForAngle(angle: number): SymmetryPresetOption {
  return SYMMETRY_PRESET_OPTIONS.reduce((best, option) =>
    angleDistance(angle, option.angle) < angleDistance(angle, best.angle) ? option : best,
  );
}

export function exactSymmetryOptionForAngle(angle: number): SymmetryPresetOption | null {
  return (
    SYMMETRY_PRESET_OPTIONS.find(
      (option) => angleDistance(angle, option.angle) <= SYMMETRY_MATCH_EPSILON,
    ) ?? null
  );
}

export function defaultSymmetryOption(preset: SymmetryPreset): SymmetryPresetOption {
  return SYMMETRY_PRESET_OPTIONS.find((option) => option.preset === preset)!;
}

export function symmetryOptionForPreset(
  preset: SymmetryPreset,
  currentAngle: number,
): SymmetryPresetOption {
  const current = symmetryOptionForAngle(currentAngle);
  return current.preset === preset ? current : defaultSymmetryOption(preset);
}

export function nextSymmetryOption(current: SymmetryPresetOption): SymmetryPresetOption {
  const options = SYMMETRY_PRESET_OPTIONS.filter((option) => option.preset === current.preset);
  const currentIndex = options.findIndex((option) => option.variant === current.variant);
  return options[(currentIndex + 1) % options.length];
}

export function paperCenter(width: number, height: number): Point {
  return { x: width / 2, y: height / 2 };
}

export function isPaperCenter(point: Point, width: number, height: number): boolean {
  const center = paperCenter(width, height);
  return (
    Math.abs(point.x - center.x) <= SYMMETRY_MATCH_EPSILON &&
    Math.abs(point.y - center.y) <= SYMMETRY_MATCH_EPSILON
  );
}

export function symmetrySelectValueForState({
  hasSymmetry,
  symAngle,
  symLoc,
  paperWidth,
  paperHeight,
}: {
  hasSymmetry: boolean;
  symAngle: number;
  symLoc: Point;
  paperWidth: number;
  paperHeight: number;
}): SymmetrySelectValue {
  if (!hasSymmetry) return 'none';
  if (!isPaperCenter(symLoc, paperWidth, paperHeight)) return 'custom';
  return exactSymmetryOptionForAngle(symAngle)?.preset ?? 'custom';
}
