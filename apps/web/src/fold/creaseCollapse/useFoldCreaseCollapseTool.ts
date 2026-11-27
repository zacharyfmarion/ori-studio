import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { trackFoldRefused } from '../../analytics';
import { reportError } from '../../monitoring';
import type { Point } from '../../lib/geometry';
import type { FoldHit, FoldPaneId } from '../canvas/foldPicking';
import type { FoldToolStep } from '../canvas/useFoldToolPreview';
import type { FoldCollapseOp, FoldCollapseTo, SheetPoint } from '../document/foldSequenceDocument';
import type { FoldImportOpened } from '../engine/foldEngineIoWire';
import type { FoldEngineRefused, FoldScene } from '../engine/foldEngineWire';
import type { FoldOrderResolution } from '../orders/useFoldOrderResolution';
import { foldStepInputKey } from '../session/foldSessionEngine';
import { FOLD_SCENE_QUERY } from '../session/foldStateQueries';
import { useFoldStateQuery, type FoldSessionSurface } from '../session/useFoldSession';
import { foldToolInputKey, foldTools, type FoldToolState } from '../tools/foldToolState';
import { collapsePieceAt, collapsePieceIndex, type FoldCollapsePieceIndex } from './creaseCollapsePieces';
import { clickPiece, collapsePicksKey, collapseStretches, picksOn, type FoldCollapsePick } from './creaseCollapsePicks';
import type { FoldCreaseCollapseProblem, FoldCreaseCollapseWindowView, FoldCreaseCollapseWindowVerbs } from './creaseCollapseToolWindow';

/** How long the tool waits after a click before it asks the engine: a run of clicks asks once, for the last. */
export const CREASE_COLLAPSE_DELAY_MS = 120;

/** Collapse while it is in hand: its window, what the canvas previews and draws, and its clicks. */
export interface FoldCreaseCollapseTool {
  view: FoldCreaseCollapseWindowView;
  verbs: FoldCreaseCollapseWindowVerbs;
  /** The `collapse` op of the order shown, as the session previews and commits it; null while none lands. */
  step: FoldToolStep | null;
  /** The layer order review the window's chooser reads (`FoldOrderChooser`): Enter asks it when there are several. */
  resolution: FoldOrderResolution | null;
  /** How many layer orders the creases set land in; 1 while one or none. */
  orders: number;
  /** The creases set. */
  picks: readonly FoldCollapsePick[];
  /** The pieces of the step on screen, indexed on both panes through the scene shown. Null until both scenes are in. */
  index: FoldCollapsePieceIndex | null;
  /** Where a refusal says the creases do not fold, in sheet coordinates. */
  marked: readonly SheetPoint[];
  /** What a pointer at `at` on a pane is over: the piece a click would set. */
  hitTest: (pane: FoldPaneId, at: Point, radius: number) => FoldHit;
  /** A click on what `hitTest` found. */
  pick: (hit: FoldHit) => void;
}

/** The engine's answer for one set of creases. */
type Opened =
  | { key: string; status: 'opened'; opened: FoldImportOpened }
  | { key: string; status: 'refused'; refused: FoldEngineRefused }
  | { key: string; status: 'failed' };

/** One listed order per component, from the order's place in the ‹ n of m ›: the last component steps fastest. */
export function collapseChoice(components: readonly { orders: number }[], index: number): number[] {
  let rest = index;
  const choice = components.map(() => 0);
  for (let k = components.length - 1; k >= 0; k -= 1) {
    const size = Math.max(1, components[k]!.orders);
    choice[k] = rest % size;
    rest = Math.floor(rest / size);
  }
  return choice;
}

/** Why a refusal says the creases do not fold, as the window words it, and the sheet points it names. */
export function collapseProblem(refused: FoldEngineRefused): { problem: FoldCreaseCollapseProblem; points: SheetPoint[] } {
  const body = refused.refusal as { code: string; point?: unknown; points?: unknown };
  const point = (value: unknown): SheetPoint | null =>
    Array.isArray(value) && value.length === 2 && typeof value[0] === 'number' && typeof value[1] === 'number'
      ? [value[0], value[1]]
      : null;
  const points = [point(body.point), ...(Array.isArray(body.points) ? body.points.map(point) : [])].filter(
    (p): p is SheetPoint => p !== null
  );
  switch (body.code) {
    case 'collapse_not_flat_at_vertex':
    case 'import_not_flat_foldable':
      return { problem: 'vertex', points };
    case 'import_no_order':
      return { problem: 'order', points };
    default:
      return { problem: 'other', points };
  }
}

/**
 * Collapse, the tool (`implementation-plans/fold-collapse-existing-creases.md`):
 * while it is in hand, a click on a crease of the step on screen sets it to
 * the letter in hand (`clickPiece`), and the engine collapses the creases set
 * a moment after the last click (`collapseOpen`, held under an import
 * handle): its ‹ n of m ›, and the `collapse` op of the order shown
 * (`collapseOp`), which the session previews as any step — so the folded
 * pane shows the paper collapsed as soon as it lands (`useFoldStateView`).
 * Several orders are reviewed with the order chooser before the step is
 * added. A refusal names where the creases do not fold.
 *
 * Null while another tool is in hand.
 */
export function useFoldCreaseCollapseTool(
  session: FoldSessionSurface,
  tools: FoldToolState,
  shown: FoldScene | null
): FoldCreaseCollapseTool | null {
  const active = tools.tool === 'collapse';
  const handle = active ? session.cursor.state : null;
  const stateKey = handle ? `${handle.generation}:${handle.id}` : null;
  const parent = useFoldStateQuery(handle, FOLD_SCENE_QUERY);
  const index = useMemo(() => (active && parent && shown ? collapsePieceIndex(parent, shown) : null), [active, parent, shown]);

  // A pick the step on screen has no piece for any more — another step, an undo — is let go.
  const picks = tools.collapsePicks;
  useEffect(() => {
    if (!index) return;
    const kept = picksOn(picks, index.pieces);
    if (kept !== picks) foldTools().setCollapsePicks(kept);
  }, [index, picks]);

  // --- The engine's answer for the creases set, asked a moment after the last click.
  const picksKey = collapsePicksKey(picks);
  const key = stateKey !== null && picks.length > 0 ? `${stateKey}|${picksKey}` : null;
  const [opened, setOpened] = useState<Opened | null>(null);
  const held = useRef<number | null>(null);
  const { withState } = session;
  const release = useCallback(
    (importHandle: number | null) => {
      if (importHandle === null || !handle) return;
      void withState(handle, (engine) => engine.releaseImports([importHandle])).catch((error: unknown) =>
        reportError(error, { surface: 'fold:collapse-release' })
      );
    },
    [withState, handle]
  );
  useEffect(() => {
    if (key === null || !handle) {
      release(held.current);
      held.current = null;
      setOpened(null);
      return undefined;
    }
    let current = true;
    const stretches = collapseStretches(picks);
    const timer = setTimeout(() => {
      void withState(handle, (engine, state) => engine.collapseOpen(state, stretches)).then(
        (answer) => {
          const outcome = answer.status === 'answered' ? answer.value : null;
          if (!current) {
            if (outcome?.status === 'ok') release(outcome.import);
            return;
          }
          release(held.current);
          held.current = outcome?.status === 'ok' ? outcome.import : null;
          setOpened(
            outcome === null
              ? { key, status: 'failed' }
              : outcome.status === 'ok'
                ? { key, status: 'opened', opened: outcome }
                : { key, status: 'refused', refused: outcome }
          );
        },
        (error: unknown) => {
          reportError(error, { surface: 'fold:collapse-open' });
          if (current) setOpened({ key, status: 'failed' });
        }
      );
    }, CREASE_COLLAPSE_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
    // The picks are read through their key: an equal set must not ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, withState, release]);
  // Let the last one go when the tool is put down, or the canvas goes.
  useEffect(() => () => release(held.current), [release]);
  const answer = opened && opened.key === key ? opened : null;

  // A refusal shown is counted once, by its code.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (answer?.status !== 'refused' || counted.current === answer.key) return;
    counted.current = answer.key;
    trackFoldRefused(answer.refused.refusal.code, 'collapse');
  }, [answer]);

  // --- The order shown, and its op.
  const live = answer?.status === 'opened' ? answer.opened : null;
  const count = live ? Math.min(Number.MAX_SAFE_INTEGER, live.count.orders) : 0;
  const [order, setOrder] = useState<{ key: string; index: number; reviewing: boolean }>({ key: '', index: 0, reviewing: false });
  const nav = order.key === key ? order : { key: key ?? '', index: 0, reviewing: false };
  const [built, setBuilt] = useState<{ key: string; op: FoldCollapseOp } | null>(null);
  const opKey = live && key ? `${key}|${nav.index}` : null;
  useEffect(() => {
    if (!live || opKey === null || !handle) return undefined;
    let current = true;
    const choice = collapseChoice(live.components, nav.index);
    void withState(handle, (engine) => engine.collapseOp(live.import, choice)).then(
      (reply) => {
        if (current && reply.status === 'answered' && reply.value.status === 'ok') setBuilt({ key: opKey, op: reply.value.op });
      },
      (error: unknown) => reportError(error, { surface: 'fold:collapse-op' })
    );
    return () => {
      current = false;
    };
    // The import is read through the key it was opened for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opKey, withState]);
  const op = built && built.key === opKey ? built.op : null;
  const step = useMemo<FoldToolStep | null>(() => (op ? { op, key: foldStepInputKey({ op }) } : null), [op]);

  const inputKey = foldToolInputKey(tools);
  const resolution = useMemo<FoldOrderResolution | null>(() => {
    if (!active || key === null || !live) return null;
    const move = (next: Partial<typeof nav>) => setOrder({ ...nav, key, ...next });
    return {
      key,
      inputKey,
      active: nav.reviewing,
      required: count > 1 || !live.count.exact,
      waiting: step === null,
      searching: false,
      searched: false,
      failed: false,
      index: nav.index,
      count,
      exact: live.count.exact,
      canSearch: false,
      step: (delta) => {
        if (!nav.reviewing || count < 1) return;
        move({ index: (((nav.index + delta) % count) + count) % count });
      },
      search: () => {},
      stop: () => {},
      back: () => move({ reviewing: false }),
      resume: () => move({ reviewing: true }),
    };
    // `nav` is read through its fields.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, live, inputKey, nav.index, nav.reviewing, count, step]);

  const setTo = useCallback((to: FoldCollapseTo) => foldTools().setCollapseTo(to), []);
  const pieceIndex = index;
  const hitTest = useCallback(
    (pane: FoldPaneId, at: Point, radius: number): FoldHit => {
      const found = pieceIndex ? collapsePieceAt(pieceIndex, pane, at, radius) : null;
      const piece = found ? pieceIndex?.pieces[found.piece] : undefined;
      if (!found || !piece) return { pane, at, pick: null };
      const image = found.scene ?? [
        { x: piece.sheet[0][0], y: piece.sheet[0][1] },
        { x: piece.sheet[1][0], y: piece.sheet[1][1] },
      ];
      return {
        pane,
        at,
        pick: { kind: 'segment', edge: -1_000_000 - found.piece, segment: 'crease', sheet: piece.sheet, scene: image },
      };
    },
    [pieceIndex]
  );
  const pick = useCallback(
    (hit: FoldHit) => {
      if (!pieceIndex || hit.pick?.kind !== 'segment' || hit.pick.edge > -1_000_000) return;
      const piece = pieceIndex.pieces[-1_000_000 - hit.pick.edge];
      if (!piece) return;
      const state = foldTools().store.getState();
      foldTools().setCollapsePicks(clickPiece(state.collapsePicks, piece, state.collapseTo));
    },
    [pieceIndex]
  );

  if (!active) return null;
  const refused = answer?.status === 'refused' ? collapseProblem(answer.refused) : null;
  const status: FoldCreaseCollapseWindowView['status'] =
    picks.length === 0
      ? 'empty'
      : answer === null
        ? 'working'
        : answer.status === 'failed'
          ? 'failed'
          : answer.status === 'refused'
            ? 'refused'
            : step
              ? 'landed'
              : 'working';
  return {
    view: { to: tools.collapseTo, picks: picks.length, status, problem: refused?.problem ?? null, orders: live ? count : null },
    verbs: { setTo },
    step,
    resolution,
    orders: Math.max(1, count),
    picks,
    index,
    marked: refused?.points ?? [],
    hitTest,
    pick,
  };
}
