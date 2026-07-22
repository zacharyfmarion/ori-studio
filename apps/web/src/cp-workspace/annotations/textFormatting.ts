/**
 * Shared rich-text formatting vocabulary for text annotations: the inline mark
 * bitflags Lexical uses, the block/text-type presets exposed in the toolbar, and
 * small pure decoders. Kept runtime-free so the read-only renderer, the editor,
 * and tests can all share it.
 */

/** Lexical `TextNode` format bitflags (mirrors lexical's IS_* constants). */
export const TEXT_FORMAT_BOLD = 1;
export const TEXT_FORMAT_ITALIC = 1 << 1;
export const TEXT_FORMAT_STRIKETHROUGH = 1 << 2;
export const TEXT_FORMAT_UNDERLINE = 1 << 3;

export interface InlineMarks {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
}

/** Decode a Lexical text-node format bitfield into named marks. */
export function decodeInlineMarks(format: number): InlineMarks {
  return {
    bold: (format & TEXT_FORMAT_BOLD) !== 0,
    italic: (format & TEXT_FORMAT_ITALIC) !== 0,
    strikethrough: (format & TEXT_FORMAT_STRIKETHROUGH) !== 0,
    underline: (format & TEXT_FORMAT_UNDERLINE) !== 0,
  };
}

/** The block/text-type presets offered in the text toolbar (v1 scope). */
export type TextBlockType = 'paragraph' | 'h1' | 'h2';

export interface TextBlockPreset {
  value: TextBlockType;
  /** English label (localized at the call site). */
  label: string;
  /** Font-size multiplier applied to the box's base font size, via CSS em. */
  scale: number;
  fontWeight: number;
}

export const TEXT_BLOCK_PRESETS: readonly TextBlockPreset[] = [
  { value: 'paragraph', label: 'Body', scale: 1, fontWeight: 400 },
  { value: 'h1', label: 'Heading', scale: 1.75, fontWeight: 700 },
  { value: 'h2', label: 'Subheading', scale: 1.35, fontWeight: 600 },
];

export function textBlockPreset(type: TextBlockType): TextBlockPreset {
  return TEXT_BLOCK_PRESETS.find((preset) => preset.value === type) ?? TEXT_BLOCK_PRESETS[0];
}

/** Supported text alignments. */
export type TextAlign = 'left' | 'center' | 'right';

/** Normalize a Lexical element `format` (string or numeric) to a CSS alignment. */
export function normalizeTextAlign(format: unknown): TextAlign {
  if (format === 'center' || format === 2) return 'center';
  if (format === 'right' || format === 'end' || format === 3) return 'right';
  return 'left';
}
