import type { AnnotateTool } from './annotateTools';

/** Creation defaults only. Selected-mark properties belong in Layers. */
export type AnnotateToolParameter = 'line-type' | 'text-style' | 'star-fill' | 'circle-mode';

/** Store-free catalog: adding a parameter does not add behavior to a panel or rail. */
const PARAMETERS: Partial<Record<NonNullable<AnnotateTool>, readonly AnnotateToolParameter[]>> = {
  line: ['line-type'],
  'angle-bisector': ['line-type'],
  label: ['text-style'],
  star: ['star-fill'],
  circle: ['circle-mode'],
  'close-up': ['circle-mode'],
  enlarge: ['circle-mode'],
  'x-ray': ['circle-mode'],
};

export function annotateToolParameters(tool: AnnotateTool): readonly AnnotateToolParameter[] {
  return tool === null ? [] : PARAMETERS[tool] ?? [];
}
