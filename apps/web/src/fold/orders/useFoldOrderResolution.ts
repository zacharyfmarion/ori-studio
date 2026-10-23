import { trackFoldChoiceOffered, trackFoldOrderResolved, trackFoldOrdersSearched } from '../../analytics/trackFold';
import { useEffect, useMemo, useRef, useState } from 'react';
import { reportError } from '../../monitoring';
import { canonicalJson } from '../document/foldDigest';
import { isFoldCompoundOp } from '../engine/foldEngineCompoundWire';
import { orderResolvedStep } from '../engine/foldEnginePreview';
import { FOLD_PLACEMENT_SEARCH_MS } from '../engine/foldPlacementSearch';
import { foldSearchTicket } from '../engine/foldSearch';
import type { FoldOrderSelection } from '../engine/foldEngineCompoundCalls';
import type { FoldEngineRefused } from '../engine/foldEngineWire';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { foldStepInputKey } from '../session/foldSessionEngine';
import type { FoldToolStep } from '../canvas/useFoldToolPreview';

export interface FoldOrderResolution {
  key: string;
  movingVaries?: boolean;
  inputKey: string;
  active: boolean;
  required: boolean;
  waiting: boolean;
  /** A search for more orders is running: {@link FoldOrderResolution.stop} ends it, keeping what it found. */
  searching: boolean;
  /** A search for more orders has run, so an exact count says there are no others. */
  searched: boolean;
  failed: boolean;
  index: number;
  count: number;
  exact: boolean;
  canSearch: boolean;
  step: (delta: number) => void;
  search: () => void;
  stop: () => void;
  back: () => void;
  resume: () => void;
}

/** The most a search for more orders multiplies its first budget by. */
const MAX_BUDGET = 64;

interface Navigation {
  key: string;
  index: number;
  /** The search's size: its first, times four for each Find more orders, up to {@link MAX_BUDGET}. */
  budget: number;
  /** A new one for each press of Find more orders, and each stop. */
  batch: number;
  reviewing: boolean;
  prefer?: [number, number][];
  /** A press of Find more orders is running, or has answered. */
  pressed?: boolean;
  /** The last press was stopped: read what it found, search no further. */
  stopped?: boolean;
  /** How many orders there were when the last press began. */
  before?: number;
}

/** Search while editing; review starts only on tool confirmation. Input changes leave review. */
export function useFoldOrderResolution(session: FoldSessionSurface, base: FoldToolStep | null, inputKey: string) {
  const parent = session.cursor.state;
  const placing = base?.op.kind === 'valley' || base?.op.kind === 'mountain';
  const compound = base && (placing || base.op.kind === 'pleat' || isFoldCompoundOp(base.op)) ? base.op : null;
  const { completion: _order, ...choices } = base?.choices ?? {};
  const key = compound && parent ? `${parent.generation}:${parent.id}|${canonicalJson({ op: compound, choices })}|${inputKey}` : null;
  const [navigation, setNavigation] = useState<Navigation>({ key: '', index: 0, budget: 1, batch: 0, reviewing: false });
  const nav: Navigation = navigation.key === key ? navigation : { key: key ?? '', index: 0, budget: 1, batch: 0, reviewing: false };
  if (navigation.key !== (key ?? '')) setNavigation(nav);
  // A plain fold's placements search for a press's time, in slices; a stopped press reads what it found.
  const searchMs = placing ? (nav.stopped ? 0 : FOLD_PLACEMENT_SEARCH_MS * nav.budget) : undefined;
  const queryKey = key ? `${key}|${nav.index}|${nav.budget}|${nav.batch}|${canonicalJson(nav.prefer ?? null)}|${searchMs ?? ''}` : null;
  const [answer, setAnswer] = useState<{ key: string; value: FoldOrderSelection | null; refused: FoldEngineRefused | null; failed: boolean } | null>(null);
  const { withCursor, cancelSearch, resolveOrders } = session;
  useEffect(() => {
    if (!placing || !key) return;
    return () => { void withCursor((engine, at) => engine.releaseOrderSearch?.(at)).catch((error: unknown) => reportError(error, { surface: 'fold:order-release' })); };
  }, [placing, key, withCursor]);
  useEffect(() => {
    if (!compound || !queryKey || answer?.key === queryKey) return;
    let current = true;
    // A pleat's orders, and a plain fold's placements, are searches the worker
    // runs in slices: one no longer wanted — the lines moved, Escape put the
    // tool down, Stop — stops there.
    const search = compound.kind === 'pleat' || placing ? foldSearchTicket() : undefined;
    const query = {
      index: nav.index, batch: nav.batch, prefer: nav.prefer, perComponent: 1000 * nav.budget, maxNodes: 200_000 * nav.budget,
      ...(searchMs !== undefined ? { searchMs } : {}),
    };
    // The step the orders resolve is folded in the same turn, for the preview that follows.
    void resolveOrders(compound, choices, query, search).then((reply) => {
      if (!current || reply.status !== 'answered') return;
      const value = reply.value;
      setAnswer({ key: queryKey, value: value.status === 'ok' ? value : null, refused: value.status === 'ok' ? null : value, failed: false });
    }, (error: unknown) => {
      if (!current) return;
      reportError(error, { surface: 'fold:order-resolution' });
      setAnswer({ key: queryKey, value: null, refused: null, failed: true });
    });
    return () => {
      current = false;
      if (search) cancelSearch(search);
    };
    // All semantic input is covered by queryKey; a new object is not a new question.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolveOrders, cancelSearch, queryKey, answer?.key]);
  const own = answer?.key === queryKey ? answer : null;
  const value = own?.value ?? (answer?.key.startsWith(`${key}|`) ? answer.value : null);
  const limited = own?.refused?.refusal.code === 'budget_exceeded';
  const required = own?.failed === true || limited || (!!value && (!value.count.exact || value.count.orders > 1));
  const offered = useRef<string | null>(null);
  useEffect(() => {
    if (placing && key && value && nav.reviewing && required && offered.current !== key) {
      offered.current = key;
      trackFoldChoiceOffered('placement', value.count.orders);
    }
  }, [placing, key, value, required, nav.reviewing]);
  // Once per press of Find more orders, as its answer arrives.
  const searchedFor = useRef<string | null>(null);
  useEffect(() => {
    const found = own?.value;
    if (!key || !found || !nav.pressed) return;
    const press = `${key}|${nav.batch}`;
    if (searchedFor.current === press) return;
    searchedFor.current = press;
    const result = nav.stopped ? 'stopped' : found.count.exact ? 'exhausted' : 'incomplete';
    trackFoldOrdersSearched(result, found.count.orders > (nav.before ?? 0), found.count.orders);
  }, [key, own, nav.pressed, nav.stopped, nav.batch, nav.before]);
  const searching = placing && own === null && !!nav.pressed && !nav.stopped;
  const resolution: FoldOrderResolution | null = key ? {
    key, inputKey, movingVaries: value?.moving_varies, active: nav.reviewing, required,
    waiting: own === null, failed: (own?.failed ?? false) || limited,
    searching,
    searched: nav.batch > 0,
    index: value?.index ?? nav.index,
    count: Math.min(Number.MAX_SAFE_INTEGER, value?.count.orders ?? 0),
    exact: value?.count.exact === true && Number.isSafeInteger(value.count.orders),
    // A placement search goes on from where it stopped, so another press always finds more time.
    canSearch: placing ? !value?.count.exact : nav.budget < MAX_BUDGET,
    step: (delta) => {
      if (!nav.reviewing || !value) return;
      const count = Math.min(Number.MAX_SAFE_INTEGER, value.count.orders);
      const next = value.index + delta;
      const index = value.count.exact ? (next + count) % count : Math.max(0, Math.min(count - 1, next));
      setNavigation({ ...nav, index, prefer: undefined });
    },
    search: () => setNavigation({
      ...nav, budget: Math.min(MAX_BUDGET, nav.budget * 4), batch: nav.batch + 1, prefer: value?.relations,
      pressed: true, stopped: false, before: value?.count.orders ?? 0,
    }),
    stop: () => { if (searching) setNavigation({ ...nav, batch: nav.batch + 1, stopped: true }); },
    back: () => { trackFoldOrderResolved('canceled', 'tool', value?.count.orders ?? 0); setNavigation({ ...nav, reviewing: false }); },
    resume: () => setNavigation({ ...nav, reviewing: true }),
  } : null;
  const step = useMemo(() => {
    if (!key) return base;
    const resolved = base && value ? orderResolvedStep(base.op, base.choices, value) : null;
    return resolved ? { ...resolved, key: foldStepInputKey(resolved) } : null;
  }, [base, key, value]);
  // Search exhaustion belongs to order review, not a geometric refusal that
  // disables the tool confirmation needed to reach that review.
  return { step, resolution, refused: limited ? null : own?.refused ?? null };
}
