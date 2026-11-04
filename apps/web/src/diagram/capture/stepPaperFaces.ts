/**
 * A flat step's faces on the paper (Revision 2) for a step captured before
 * they were kept. Every flat capture keeps them now (Zach, 2026-10-06), but a
 * step captured earlier has none, and an enlarged step's frame anchors
 * nothing without them. They are fetched when they are needed — a step
 * becoming an enlarge source, or enlarged (16e) — rather than by refreshing
 * every older step.
 *
 * The faces must be the stored picture's, so they are only taken from a fold
 * that draws that picture again: the link current, and the capture's picture
 * key the stored one. Anything else changes the picture, which is Refresh's
 * to do ("Refresh step N to anchor the frame to its paper").
 *
 * The kernel is injected, as `captureStep`'s is: no store here.
 */
import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import { isLockedStep, type DiagramStep, type DiagramStyle } from '../document/diagramDocument';
import type { SanitizeEnv } from '../upload/svgSanitize';
import { knownCreasesOf } from './captureCreases';
import { captureStep, type CpCaptureRuntime } from './captureFolded';
import type { CaptureLayerOrderResolve } from './captureLayerOrder';
import { linkStatus, type DiagramLinkStatus } from './linkStatus';

/**
 * A flat fold whose stored picture has no faces on the paper: captured before
 * they were kept. Refresh keeps them, so it is offered on such a step even
 * while its picture shows its pattern as it is. A fold kept as its
 * see-through development or as a bitmap has no faces to keep.
 */
export function lacksPaperFaces(step: DiagramStep): boolean {
  return (
    !isLockedStep(step) &&
    step.source?.kind === 'cp' &&
    step.source.render.mode === 'folded-flat' &&
    step.picture?.kind === 'scene' &&
    step.picture.paperFaces === undefined
  );
}

export type StepPaperFaces =
  /** The step, its picture with its faces on the paper; as it was, when it had them. */
  | { status: 'faces'; step: DiagramStep }
  /**
   * Nothing to anchor to: not a flat fold's scene (a crease pattern, 3D,
   * simulated, an upload, a see-through development, a bitmap), or a fold the
   * kernel names nowhere on its paper.
   */
  | { status: 'none' }
  /**
   * Its faces cannot be had without changing its picture, so Refresh is the
   * way: the link is not current (`stale`, `missing`, or `unknown` — no
   * pattern to ask, or a sheet index not ready), or the fold draws another
   * picture now (`redrawn`).
   */
  | { status: 'refresh'; why: Exclude<DiagramLinkStatus, 'current'> | 'redrawn' };

export interface StepPaperFacesRequest {
  step: DiagramStep;
  /** The crease pattern as it stands; null when none is open. */
  document: OristudioCpDocumentSnapshot | null;
  /** The sheet index; null while it is not ready. */
  sheets: CpSheetIndex | null;
  style: DiagramStyle;
  env?: SanitizeEnv;
  /**
   * The host engine, for a step that keeps a layer order: its picture is
   * drawn in that order, so its faces are only had by folding in it (H7).
   * Absent, such a step's faces are Refresh's to get.
   */
  resolveLayerOrder?: CaptureLayerOrderResolve;
}

/**
 * `step` with its faces on the paper, folded again from its linked pattern
 * when its link is current and the fold draws its stored picture; or why not.
 * Folds nothing for a step that has its faces, or could have none.
 */
export async function stepWithPaperFaces(
  runtime: CpCaptureRuntime,
  { step, document, sheets, style, env, resolveLayerOrder }: StepPaperFacesRequest
): Promise<StepPaperFaces> {
  const { source, picture } = step;
  if (isLockedStep(step) || source?.kind !== 'cp' || source.render.mode !== 'folded-flat') return { status: 'none' };
  if (picture?.kind !== 'scene') return { status: 'none' };
  if (picture.paperFaces !== undefined) return { status: 'faces', step };
  if (!document) return { status: 'refresh', why: 'unknown' };
  const link = linkStatus(source, document, sheets);
  if (link !== 'current') return { status: 'refresh', why: link };
  // Its picture is in its record's order: folded in any other, it is another picture.
  if (source.layerOrder !== undefined && !resolveLayerOrder) return { status: 'refresh', why: 'redrawn' };
  const result = await captureStep(runtime, {
    document,
    sheets,
    scope: source.scope,
    known: knownCreasesOf(source),
    render: source.render,
    style,
    env,
    ...(source.layerOrder !== undefined && resolveLayerOrder
      ? { layerOrder: { kind: 'record' as const, json: source.layerOrder, resolve: resolveLayerOrder } }
      : {}),
  });
  if (result.status === 'missing' || result.status === 'unknown') return { status: 'refresh', why: result.status };
  // Refused, or routed to another folder: not the stored picture.
  if (result.status !== 'captured') return { status: 'refresh', why: 'redrawn' };
  const captured = result.captured.kind === 'picture' ? result.captured.picture : null;
  if (captured?.kind !== 'scene' || captured.key !== picture.key) return { status: 'refresh', why: 'redrawn' };
  if (captured.paperFaces === undefined) return { status: 'none' };
  return { status: 'faces', step: { ...step, picture: { ...picture, paperFaces: captured.paperFaces } } };
}
