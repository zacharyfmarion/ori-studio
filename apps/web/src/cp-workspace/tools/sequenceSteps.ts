/**
 * Per-step decisions for the click-based `sequence` engine, extracted from the
 * WebGL surface so they can be unit-tested without a GPU: how a step's snap kind
 * is classified, and when a candidate step resolves itself without a pick. Pure.
 */
import type { ModelPoint } from '../renderer/types';
import type { CpStepSnap } from './inputModelRegistry';
import type { ToolPreviewSegment } from './types';

/** Steps that snap the pick onto surrounding geometry incl. creases. */
export function isCreaseStep(kind: CpStepSnap | undefined): boolean {
  return kind === 'crease' || kind === 'crease-required';
}

/**
 * Steps that only accept a pick with a crease inside the kernel's selection
 * distance. Anything else is ignored — the kernel would reject it, and Oriedita's
 * destination steps stay put rather than reporting an error.
 */
export function requiresCreaseInRange(kind: CpStepSnap | undefined): boolean {
  return kind === 'crease-required';
}

/**
 * The point a candidate step resolves to with no pick, or null when it still needs
 * one. Oriedita skips the pick when a candidate step has exactly one option
 * (`MouseHandlerVertexMakeAngularlyFlatFoldable`: `if (candidates.size() == 1)`
 * → `SELECT_DESTINATION`), so the lone ray's midpoint stands in for the click.
 *
 * A candidate step that is a tool's *last* step never auto-picks: resolving it
 * would commit the whole command off a preview arriving, with no click at all.
 */
export function loneCandidateAutoPick(
  stepKinds: readonly CpStepSnap[],
  step: number,
  previewSegments: readonly ToolPreviewSegment[]
): ModelPoint | null {
  if (stepKinds[step] !== 'candidate' || step >= stepKinds.length - 1) return null;
  if (previewSegments.length !== 1) return null;
  const only = previewSegments[0];
  return { x: (only.a.x + only.b.x) / 2, y: (only.a.y + only.b.y) / 2 };
}
