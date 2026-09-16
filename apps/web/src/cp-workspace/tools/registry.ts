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
import { pickVertexTool } from './pickVertexTool';

/**
 * Input modes handled by a local engine.
 *
 * `pick-vertex` is the one that is not a drag: it commits on press and has no
 * gesture to preview. It lives here anyway because everything else about it is
 * the same — one engine, looked up by mode, fed by the surface adapter.
 */
export type ToolInputMode =
  | 'drag-line'
  | 'drag-box'
  | 'drag-path'
  | 'drag-vertex'
  | 'pick-vertex';

// State shapes differ per engine; the runtime type-erases them, so the registry
// holds engines by their common interface.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ENGINES: Record<ToolInputMode, ToolEngine<any>> = {
  'drag-line': dragLineTool,
  'drag-box': dragBoxTool,
  'drag-path': dragPathTool,
  'drag-vertex': dragVertexTool,
  'pick-vertex': pickVertexTool,
};

export function toolEngineFor(mode: ToolInputMode): ToolEngine<unknown> {
  return ENGINES[mode];
}
