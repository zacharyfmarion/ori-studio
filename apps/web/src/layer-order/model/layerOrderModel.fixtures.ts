/**
 * A small figure for the inspector model's tests, and helpers to drive the
 * reducer the way its hook will: dispatch, collect the effects, answer them.
 *
 * Seven faces. Front stacks, top first:
 *
 * | spot | faces   |
 * | ---- | ------- |
 * | 0    | 0, 1    |
 * | 1    | 0, 1, 2 |
 * | 2    | 2, 3    |
 * | 3    | 4       |
 * | 4    | 4, 5    |
 * | 5    | 3       |
 * | 6    | 6       |
 *
 * Open pairs: 0–2, 2–3, 4–5. So 0, 2, 3, 4 and 5 have choices; 1 overlaps 0
 * and 2 but both are settled; 6 overlaps nothing. Faces 0, 2, 4 and 6 show
 * their front from the front side.
 */
import type {
  LayerCarriedFacts,
  LayerChangedSpots,
  LayerOpenFacts,
  LayerPosition,
  LayerSidesStacks,
  LayerSolutionCount,
  LayerStacks,
} from './layerOrderEngineFacts';
import { initLayerOrderDialog, layerOrderReducer } from './layerOrderReducer';
import { rowKeyOf, type LayerRowKey } from './layerOrderRowGroups';
import type {
  LayerOrderAction,
  LayerOrderDialogInit,
  LayerOrderDialogState,
  LayerOrderEffect,
  LayerOrderStep,
} from './layerOrderState';

export function stacksOf(spots: readonly (readonly number[])[]): LayerStacks {
  const offsets = [0];
  const faces: number[] = [];
  for (const spot of spots) {
    faces.push(...spot);
    offsets.push(faces.length);
  }
  return { offsets: Uint32Array.from(offsets), faces: Uint32Array.from(faces) };
}

/** Both sides from the front's stacks: the back sees each stack the other way up. */
export function sidesOf(front: readonly (readonly number[])[]): LayerSidesStacks {
  return { front: stacksOf(front), back: stacksOf(front.map((spot) => [...spot].reverse())) };
}

export const SPOTS: readonly (readonly number[])[] = [[0, 1], [0, 1, 2], [2, 3], [4], [4, 5], [3], [6]];

/** The order on screen after the fixture's preview of 2 in front of 0, from the front. */
export const SPOTS_TWO_OVER_ZERO: readonly (readonly number[])[] = [[0, 1], [2, 0, 1], [2, 3], [4], [4, 5], [3], [6]];

/** The order the engine would say for `spots`, packed: a stand-in, the same for the same stacks (`layer_order`). */
export function orderOf(spots: readonly (readonly number[])[]): Uint8Array {
  return Uint8Array.from(spots.flatMap((spot) => [...spot, 255]));
}

export const FRONT_UP = Uint8Array.of(1, 0, 1, 0, 1, 0, 1);
export const OPEN_PAIRS = Uint32Array.of(0, 2, 2, 3, 4, 5);

export function changedSpots(front: number[] = [], back: number[] = []): LayerChangedSpots {
  return { front: Uint32Array.from(front), back: Uint32Array.from(back) };
}

export const NO_SPOTS = changedSpots();

/** The open's facts; the letters default to face order, A for face 0, over however many faces it has. */
export function openFactsOf(overrides: Partial<LayerOpenFacts> = {}): LayerOpenFacts {
  const faces = overrides.faces ?? 7;
  return {
    faces,
    frontUp: FRONT_UP,
    openPairs: OPEN_PAIRS,
    openedOn: { kind: 'held', ignored: 0 },
    stacks: sidesOf(SPOTS),
    order: orderOf(SPOTS),
    constraints: [],
    restore: null,
    letterOrder: Array.from({ length: faces }, (_, face) => face),
    ...overrides,
  };
}

export function carried(overrides: Partial<LayerCarriedFacts> & Pick<LayerCarriedFacts, 'index'>): LayerCarriedFacts {
  return {
    status: { status: 'intact' },
    subject: 0,
    object: 2,
    subjectState: 'intact',
    objectState: 'intact',
    sign: 1,
    constraint: [0, 2, 1],
    ...overrides,
  };
}

export function count(front: number, back: number, orders: number, done = true): LayerSolutionCount {
  return {
    front: { n: front, exact: done },
    back: { n: back, exact: done },
    orders: { n: orders, exact: done },
    done,
  };
}

export function position(index: number, total: number, exact = true): LayerPosition {
  return { index, total: { n: total, exact } };
}

export const INIT: LayerOrderDialogInit = {
  surface: 'edit_figure',
  hasRecord: false,
  recordNeedsAttention: false,
  review: false,
  xray: false,
  at: 1_000,
};

/** A run of the reducer: the state now, and every effect asked for on the way. */
export interface Played {
  readonly state: LayerOrderDialogState;
  readonly effects: readonly LayerOrderEffect[];
}

export function play(from: LayerOrderStep | LayerOrderDialogState, ...actions: LayerOrderAction[]): Played {
  let state = 'state' in from ? from.state : from;
  const effects: LayerOrderEffect[] = 'state' in from ? [...from.effects] : [];
  for (const action of actions) {
    const step = layerOrderReducer(state, action);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}

/** Only the effects the last action asked for. */
export function dispatch(state: LayerOrderDialogState, action: LayerOrderAction): Played {
  return layerOrderReducer(state, action);
}

export function effectsOf<T extends LayerOrderEffect['type']>(
  effects: readonly LayerOrderEffect[],
  type: T
): Extract<LayerOrderEffect, { type: T }>[] {
  return effects.filter((effect): effect is Extract<LayerOrderEffect, { type: T }> => effect.type === type);
}

export function lastOf<T extends LayerOrderEffect['type']>(
  effects: readonly LayerOrderEffect[],
  type: T
): Extract<LayerOrderEffect, { type: T }> {
  const found = effectsOf(effects, type);
  if (found.length === 0) throw new Error(`no ${type} effect among ${effects.map((e) => e.type).join(', ')}`);
  return found[found.length - 1]!;
}

/** The dialog opened on `facts`: init, then the open's answer. */
export function opened(facts: LayerOpenFacts = openFactsOf(), init: Partial<LayerOrderDialogInit> = {}): Played {
  const start = initLayerOrderDialog({ ...INIT, ...init });
  const open = lastOf(start.effects, 'open');
  return play(start, { type: 'opened', request: open.request, facts });
}

/** Pick a sentence on the crease pattern: subject, then object. */
export function picked(state: LayerOrderDialogState, subject: number, object: number): Played {
  return play(
    state,
    { type: 'face_picked', face: subject, origin: 'pattern' },
    { type: 'face_picked', face: object, origin: 'folded' }
  );
}

/** Answer the last preview asked for as fitting, with `token`. */
export function fits(played: Played, token = 7, spots = SPOTS_TWO_OVER_ZERO, changed = changedSpots([1], [1])): Played {
  const preview = lastOf(played.effects, 'preview');
  return play(played.state, {
    type: 'previewed',
    request: preview.request,
    facts: { verdict: 'fits', token, changed, stacks: sidesOf(spots) },
  });
}

/** Answer the last commit asked for as committed. */
export function commits(
  played: Played,
  openPairs: Uint32Array = OPEN_PAIRS,
  spots = SPOTS,
  changed = changedSpots([1], [1])
): Played {
  const commit = lastOf(played.effects, 'commit');
  return play(played.state, {
    type: 'committed',
    request: commit.request,
    facts: { verdict: 'committed', changed, stacks: sidesOf(spots), openPairs, order: orderOf(spots) },
  });
}

/** Answer the last step asked for as moving the order on screen to `spots`. */
export function steps(
  played: Played,
  spots = SPOTS_TWO_OVER_ZERO,
  at: LayerPosition = position(2, 9),
  changed = changedSpots([1])
): Played {
  return play(played.state, {
    type: 'stepped',
    request: lastOf(played.effects, 'step').request,
    facts: { verdict: 'moved', changed, position: at, stacks: sidesOf(spots), order: orderOf(spots) },
  });
}

/** The key of the list row that shows stored constraint `id`: what `row_hovered` and `row_clicked` take. */
export function rowKey(state: LayerOrderDialogState, id: number): LayerRowKey {
  const row = [...state.rows.committed, ...state.rows.carried].find((r) => r.id === id);
  if (!row) throw new Error(`no row ${id}`);
  return rowKeyOf(row, state.figure);
}

/** The trash of the list row that shows stored constraint `id`: the whole row goes. */
export function trashOf(state: LayerOrderDialogState, id: number): LayerOrderAction {
  return { type: 'row_removed', key: rowKey(state, id) };
}

/** Open, pick 2 in front of 0, preview it fitting, Add it, and land the commit: one committed row, `[2, 0, 1]`. */
export function withOneConstraint(openPairsAfter: Uint32Array = Uint32Array.of(2, 3, 4, 5)): Played {
  const added = play(fits(picked(opened().state, 2, 0)).state, { type: 'add' });
  return commits(added, openPairsAfter, SPOTS_TWO_OVER_ZERO);
}
