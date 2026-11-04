/**
 * The Layer order dialog's effect runner (`implementation-plans/layer-order-dialog.md`,
 * row U10): U9's reducer describes what it needs done as data
 * (`model/layerOrderState.ts`, `LayerOrderEffect`), and this does it over
 * the dialog's engine, answering each call with the action it asked for, by
 * its request. The hook (`useLayerOrderDialog.ts`) binds it to the session,
 * the dialog's ways out and the analytics.
 *
 * - **Answers go back by request.** An answer is dispatched however late; the
 *   reducer drops one it no longer waits on (a superseded preview, a commit
 *   after Cancel, a count of an older generation). A call the engine rejects
 *   goes to {@link LayerOrderEffectHost.failed}, which tells the dialog
 *   closing from the engine going away.
 * - **The open** is the shell's (`useLayerOrderSession`): the reducer's first
 *   open is the one the session makes as the dialog mounts, and a later one
 *   (Try again, Keep trying an open that ran out) asks the session to open
 *   again; its status answers it. Only a restore asked again on the session
 *   already open (D10's Keep trying) is a call of its own here.
 * - **The count** is the runtime's (`layerOrderRuntime.ts`): it slices the
 *   count between calls once it is on, and publishes each slice. The model's
 *   per-commit decision turns it on or off (`solutions_restart`); a slice the
 *   model asks for is already on its way, so `solutions_slice` asks nothing.
 * - **The flash** is the panes': they fade it and say when it ends.
 * - **Apply** is the hook's: it saves through the dialog's way out, and only
 *   a save that went through closes the model.
 *
 * React-free and store-free.
 */
import type { LayerOrderRequest } from '../../lib/layerOrder/layerOrderRequest';
import type { LayerOrderLimits, LayerSolutionCount } from '../engine/layerOrderEngine';
import type { LayerOrderFact } from '../model/layerOrderAnalytics';
import {
  commitFacts,
  explainFacts,
  previewFacts,
  shownFacts,
  stepFacts,
  type LayerCommitFacts,
  type LayerOrderBits,
} from '../model/layerOrderEngineFacts';
import type { LayerOrderAction, LayerOrderDialogState, LayerOrderEffect } from '../model/layerOrderState';
import { openLayerOrderSession } from './layerOrderSession';
import type { LayerOrderSessionEngine } from './useLayerOrderSession';

/** Which call failed: a crash report's tag. */
export type LayerOrderEffectCall = 'open' | 'preview' | 'explain' | 'commit' | 'solutions' | 'step' | 'apply';

/** What the runner needs from its hook. */
export interface LayerOrderEffectHost {
  readonly engine: LayerOrderSessionEngine;
  readonly request: LayerOrderRequest;
  dispatch(action: LayerOrderAction): void;
  /** Open the session again, through the shell: its status answers open `request`. */
  reopen(request: number, limits: LayerOrderLimits): void;
  /** Turn the runtime's count on or off (D7, the model's decision at each open and commit). */
  setCounting(on: boolean): void;
  /** The count so far, as the runtime last published it. */
  count(): LayerSolutionCount | null;
  /** A call rejected: the dialog closing, the engine gone, or a defect. */
  failed(error: unknown, call: LayerOrderEffectCall): void;
  /** Cancel: answer the host `cancelled`. */
  close(): void;
  track(fact: LayerOrderFact): void;
}

/**
 * Run `effects`, the ones a step of the reducer asked for; `state` is the
 * state that step left, which tells a restore on the open session from an
 * open of the shell's.
 */
export function runLayerOrderEffects(
  effects: readonly LayerOrderEffect[],
  state: LayerOrderDialogState,
  host: LayerOrderEffectHost
): void {
  for (const effect of effects) runLayerOrderEffect(effect, state, host);
}

/** Read only for an answer that changed the order on screen. */
const NO_ORDER: LayerOrderBits = new Uint8Array();

/**
 * A commit's answer, with the order it landed on. An undo or redo with an
 * order to put back asks for it exactly (`show`, no search); should that be
 * refused or run out, which an order the session showed with those
 * constraints never should, it commits the list for the closest fitting
 * order instead, so an undo never sticks.
 */
async function committedFacts(
  engine: LayerOrderSessionEngine,
  effect: Extract<LayerOrderEffect, { type: 'commit' }>
): Promise<LayerCommitFacts> {
  const { token, constraints, order, limits } = effect;
  if (order) {
    const shown = await engine.show(constraints, order, limits);
    if (shown.verdict === 'shown') return shownFacts(shown, order);
  }
  const answer = token === null ? await engine.commit(constraints, limits) : await engine.commitPreview(token, constraints, limits);
  return commitFacts(answer, answer.verdict === 'committed' ? await engine.order() : NO_ORDER);
}

/** Ask the engine with `ask`, and answer the model with `then`'s action; a call that fails, or can't be made, is `failed`. */
function answered<T>(
  host: LayerOrderEffectHost,
  call: LayerOrderEffectCall,
  ask: (engine: LayerOrderSessionEngine) => Promise<T>,
  then: (value: T) => LayerOrderAction
): void {
  let pending: Promise<T>;
  try {
    pending = ask(host.engine);
  } catch (error) {
    pending = Promise.reject(error);
  }
  pending.then(
    (value) => host.dispatch(then(value)),
    (error: unknown) => host.failed(error, call)
  );
}

function runLayerOrderEffect(effect: LayerOrderEffect, state: LayerOrderDialogState, host: LayerOrderEffectHost): void {
  switch (effect.type) {
    case 'open': {
      const { request, limits } = effect;
      const restoring = state.settle.kind === 'restoring' && state.settle.request === request;
      if (!restoring) {
        host.reopen(request, limits);
        return;
      }
      // Keep trying a restore that ran out (D10), on the session already open.
      answered(
        host,
        'open',
        (engine) => openLayerOrderSession(engine, host.request, limits, { sessionOpen: true }),
        (opened) =>
          opened.kind === 'ready'
            ? { type: 'opened', request, facts: opened.open.facts }
            : { type: 'open_refused', request, refusal: opened.refusal }
      );
      return;
    }
    case 'preview':
      answered(
        host,
        'preview',
        (engine) => engine.previewList(effect.constraints, effect.limits),
        (previewed) => ({ type: 'previewed', request: effect.request, facts: previewFacts(previewed) })
      );
      return;
    case 'explain':
      answered(
        host,
        'explain',
        (engine) => engine.explainList(effect.constraints, effect.limits),
        (explained) => ({ type: 'explained', request: effect.request, facts: explainFacts(explained) })
      );
      return;
    case 'commit': {
      answered(host, 'commit', (engine) => committedFacts(engine, effect), (facts) => ({
        type: 'committed',
        request: effect.request,
        facts,
      }));
      return;
    }
    case 'solutions_restart': {
      const { generation, by, count } = effect;
      host.setCounting(count);
      answered(host, 'solutions', (engine) => engine.position(by), (position) => ({
        type: 'solutions_counted',
        generation,
        by,
        count: count ? host.count() : null,
        position,
      }));
      return;
    }
    case 'solutions_slice':
      // The runtime slices the count between calls once it is on, and its next slice answers this.
      return;
    case 'solutions_position':
      answered(host, 'solutions', (engine) => engine.position(effect.by), (position) => ({
        type: 'solutions_positioned',
        generation: effect.generation,
        by: effect.by,
        position,
      }));
      return;
    case 'step':
      answered(
        host,
        'step',
        async (engine) => {
          const stepped = await engine.step(effect.by, effect.direction, effect.limits);
          return stepFacts(stepped, stepped.verdict === 'moved' ? await engine.order() : NO_ORDER);
        },
        (facts) => ({ type: 'stepped', request: effect.request, facts })
      );
      return;
    case 'flash':
      // The panes fade it, and say when it ends (`onFlashEnded`).
      return;
    case 'apply':
      // The hook's: only a save that went through closes the model.
      return;
    case 'close':
      host.close();
      return;
    case 'track':
      host.track(effect.fact);
      return;
  }
}
