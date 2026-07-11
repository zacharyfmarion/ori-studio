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
  /**
   * The 1-based crease id under the cursor (from the surface's hit-test), or null
   * when none. Used by entity-pick tools; free-point tools ignore it.
   */
  lineId?: number | null;
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
  /** Ordered free points the command consumes (free-point / drag tools). */
  points?: readonly ModelPoint[];
  /** Picked crease ids the command consumes (entity-pick tools). */
  lineIds?: readonly number[];
}

/** The result of reducing one input: next state, live preview, optional commit. */
export interface ToolOutput<S> {
  state: S;
  /** Locally-drawn preview (drag tools). Null when there is none. */
  preview: ToolPreview | null;
  commit: ToolCommit | null;
  /**
   * Collected points plus the live cursor, for tools whose preview is computed by
   * the kernel (point-sequence): the controller passes these to
   * `previewOristudioCpCommand`. Omitted by locally-previewed (drag) tools.
   */
  livePoints?: readonly ModelPoint[];
  /**
   * Crease ids to highlight as pick feedback (picked so far plus the one under the
   * cursor), for entity-pick tools. Omitted by other tools.
   */
  highlightLineIds?: readonly number[];
  /**
   * True when the step now awaiting input collects a free point — the surface
   * shows the snap indicator only then (not while picking a crease).
   */
  awaitingPoint?: boolean;
}

/** A pure tool state machine. `S` is the engine's private interaction state. */
export interface ToolEngine<S> {
  readonly initialState: S;
  reduce(state: S, input: ToolInput): ToolOutput<S>;
}
