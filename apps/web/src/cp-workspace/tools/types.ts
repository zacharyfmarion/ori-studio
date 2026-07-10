/**
 * Surface-agnostic tool interaction layer (Phase 5). A tool "engine" is a pure
 * reducer over a stream of {@link ToolInput}s — no DOM, no React, no GPU — so it
 * can be unit-tested by feeding an input sequence and asserting the emitted
 * preview + commit. The surface adapter (the WebGL canvas) converts native
 * pointer events into {@link ToolInput}s (model coords, already snapped) and
 * renders the {@link ToolPreview}; the controller routes {@link ToolCommit}s to
 * the kernel command layer. See implementation-plans/webgl-canvas-workspace-migration.md.
 */
import type { ModelPoint } from '../renderer/types';

/** A pointer intent, translated to model space by the surface. */
export interface ToolInput {
  kind: 'down' | 'move' | 'up' | 'cancel';
  /** Cursor position in model coords, already snapped by the surface. */
  point: ModelPoint;
}

/** A candidate crease segment shown while a tool is in progress. */
export interface ToolPreviewSegment {
  a: ModelPoint;
  b: ModelPoint;
}

/** Live, uncommitted geometry the surface renders each frame. */
export interface ToolPreview {
  segments: readonly ToolPreviewSegment[];
}

/**
 * A committed action: the ordered input points the active command consumes. The
 * controller attaches the active `operationId` and enriches the payload
 * (colours/options) — the engine stays free of command identity.
 */
export interface ToolCommit {
  points: readonly ModelPoint[];
}

/** The result of reducing one input: next state, live preview, optional commit. */
export interface ToolOutput<S> {
  state: S;
  preview: ToolPreview | null;
  commit: ToolCommit | null;
}

/** A pure tool state machine. `S` is the engine's private interaction state. */
export interface ToolEngine<S> {
  readonly initialState: S;
  reduce(state: S, input: ToolInput): ToolOutput<S>;
}
