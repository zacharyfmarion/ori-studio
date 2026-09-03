/**
 * Maps a command's declarative `inputMode` to its tool engine. The surface
 * adapter looks up the active engine here rather than hardcoding one, so adding a
 * tool is: write the engine + tests, register it. Point-sequence (the kernel-
 * previewed default) is handled separately and is not a drag engine.
 */
import type { ToolEngine } from './types';
import { dragLineTool } from './dragLineTool';
import { dragBoxTool } from './dragBoxTool';
import { dragPathTool } from './dragPathTool';
import { dragVertexTool } from './dragVertexTool';

/** Drag input modes handled by a local-preview engine. */
export type ToolInputMode = 'drag-line' | 'drag-box' | 'drag-path' | 'drag-vertex';

// State shapes differ per engine; the runtime type-erases them, so the registry
// holds engines by their common interface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ENGINES: Record<ToolInputMode, ToolEngine<any>> = {
  'drag-line': dragLineTool,
  'drag-box': dragBoxTool,
  'drag-path': dragPathTool,
  'drag-vertex': dragVertexTool,
};

export function toolEngineFor(mode: ToolInputMode): ToolEngine<unknown> {
  return ENGINES[mode];
}
