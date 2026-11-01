/**
 * The Layer order dialog's session, opened and applied: the two engine
 * conversations the dialog's shell has with its worker
 * (`implementation-plans/layer-order-dialog.md`, row U4). The hook that keeps
 * the worker and the status is `useLayerOrderSession.ts`; these are the
 * calls it makes, as plain async functions over any {@link LayerOrderEngine},
 * so the inspector's effect runner (U10's `useLayerOrderDialog`, running U9's
 * `open` effect) can make the same ones.
 *
 * - **Open** ({@link openLayerOrderSession}): restore the host's record onto
 *   the source, or open on the order the host shows (D19), or on the
 *   solver's first order when the host shows none; then read what the panes
 *   draw and the inspector drives: both sides' stacks and scenes, and the
 *   faces' letters. A refusal is an answer; a rejection (the worker lost, a
 *   defect) is the call failing, as everywhere on the engine.
 * - **Apply** ({@link applyLayerOrderSession}): save the record and read the
 *   order on screen as the host kernel's relations: `LayerOrderApplied`,
 *   with the request's own source, which the host folds again as it is.
 *
 * React-free and store-free.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { LayerOrderApplied, LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import { faceLettersOf, type FaceLetters } from '../engine/faceIndex';
import {
  LAYER_ORDER_LIMITS,
  type LayerOrderEngine,
  type LayerOrderLimits,
  type LayerOrderOpened,
  type LayerOrderRestored,
  type LayerRefusal,
} from '../engine/layerOrderEngine';
import { layerOrderSceneRelations } from '../engine/layerOrderSceneRelations';
import { openFacts, type LayerOpenFacts, type LayerSidesStacks } from '../model/layerOrderEngineFacts';

/**
 * How a session opens on a request: by restoring its record (`restore`), on
 * the order the host shows (`showing`, `layer_open_showing`), or on the
 * solver's first order when the host shows none (`first`).
 */
export type LayerOrderOpenHow = 'restore' | 'showing' | 'first';

export function layerOrderOpenHow(request: LayerOrderRequest): LayerOrderOpenHow {
  if (request.record) return 'restore';
  return request.shown ? 'showing' : 'first';
}

/** The limits a request's first open runs with: a restore's, or an open's. */
export function layerOrderOpenLimits(request: LayerOrderRequest): LayerOrderLimits {
  return request.record ? LAYER_ORDER_LIMITS.restore : LAYER_ORDER_LIMITS.open;
}

/** The paper scenes of the order on screen, per side; null when the figure has no subfaces. */
export interface LayerOrderScenes {
  readonly front: OristudioCpFoldedPaperScene | null;
  readonly back: OristudioCpFoldedPaperScene | null;
}

/** A session open: what the panes draw (U8) and the inspector drives (U10). */
export interface LayerOrderSessionOpen {
  readonly how: LayerOrderOpenHow;
  /**
   * The engine's answer, with no handle: how many faces, which show their
   * front, the open pairs (the pickable subjects and their objects), the
   * spots and where the order on screen came from; for a restore, each part
   * of the record found again.
   */
  readonly opened: LayerOrderOpened | LayerOrderRestored;
  /** The order on screen's stacks, top first, per side. */
  readonly stacks: LayerSidesStacks;
  /** Drawn by the kernel's own builder with the source's model, so the panes show what Apply's fold will. */
  readonly scenes: LayerOrderScenes;
  /** The face index: each face's letters, assigned once per opening (`faceIndex.ts`); null with no scene. */
  readonly letters: FaceLetters | null;
  /** The open as U9's inspector model takes it: its `opened` action's facts. */
  readonly facts: LayerOpenFacts;
}

export type LayerOrderOpenAnswer =
  | { readonly kind: 'ready'; readonly open: LayerOrderSessionOpen }
  | { readonly kind: 'refused'; readonly refusal: LayerRefusal };

export interface LayerOrderOpenOptions {
  /**
   * The worker already holds this request's session, and a restore of its
   * record timed out (U9's Keep trying): restore again on it
   * (`layer_restore_record`) rather than opening a new one.
   */
  readonly sessionOpen?: boolean;
}

/** The faces' letters from the scene the host shows, before the engine has answered: what a refusal names a face by. */
export function requestFaceLetters(request: LayerOrderRequest): FaceLetters | null {
  return request.shown ? faceLettersOf(request.shown) : null;
}

/**
 * Open `request`'s session on `engine` within `limits`, then read what the
 * dialog draws. Resolves `ready` or `refused`; rejects when a call fails.
 */
export async function openLayerOrderSession(
  engine: Pick<LayerOrderEngine, 'open' | 'openShowing' | 'restore' | 'restoreRecord' | 'stacks' | 'scene' | 'order'>,
  request: LayerOrderRequest,
  limits: LayerOrderLimits,
  { sessionOpen = false }: LayerOrderOpenOptions = {}
): Promise<LayerOrderOpenAnswer> {
  const how = layerOrderOpenHow(request);
  const { source, record, shown } = request;
  const outcome =
    how === 'restore' && record
      ? sessionOpen
        ? await engine.restoreRecord(record, limits)
        : await engine.restore(source, record, limits)
      : how === 'showing' && shown
        ? await engine.openShowing(source, layerOrderSceneRelations(shown), limits)
        : await engine.open(source, limits);
  if (outcome.status === 'refused') return { kind: 'refused', refusal: outcome.refusal };
  // Asked together: the worker answers them in turn, behind nothing but each other.
  const [front, back, frontScene, backScene, order] = await Promise.all([
    engine.stacks('front'),
    engine.stacks('back'),
    engine.scene('front'),
    engine.scene('back'),
    engine.order(),
  ]);
  const stacks = { front, back };
  const scene = frontScene ?? backScene;
  const letters = scene ? faceLettersOf(scene) : null;
  return {
    kind: 'ready',
    open: {
      how,
      opened: outcome,
      stacks,
      scenes: { front: frontScene, back: backScene },
      letters,
      // With no scene to letter, every face ranks alike and sorts by its index.
      facts: openFacts(outcome, stacks, record, letters?.inLetterOrder ?? [], order),
    },
  };
}

export type LayerOrderApplyAnswer =
  | { readonly kind: 'applied'; readonly applied: LayerOrderApplied }
  /** The record can't be saved (over its budget): Apply refuses inside the dialog, with the reason. */
  | { readonly kind: 'refused'; readonly refusal: LayerRefusal };

/**
 * Apply's plumbing: the session's record (its committed constraints, the
 * carried rows `keepCarried` names by record index, or every one when left
 * out, and the order's free pairs) and the order on screen as the relations
 * the host seeds its fold with, on the request's source. Nothing in the
 * session changes, so a refused save leaves it as it was. Rejects when a
 * call fails.
 */
export async function applyLayerOrderSession(
  engine: Pick<LayerOrderEngine, 'save' | 'relations'>,
  request: LayerOrderRequest,
  keepCarried?: readonly number[]
): Promise<LayerOrderApplyAnswer> {
  const saved = await engine.save(keepCarried);
  if (saved.status === 'refused') return { kind: 'refused', refusal: saved.refusal };
  const relations = await engine.relations();
  return { kind: 'applied', applied: { record: saved.record, relations, source: request.source } };
}
