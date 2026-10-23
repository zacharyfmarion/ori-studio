import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { LayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import { useFoldPaperStyle } from './useFoldPaperStyle';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { reportError } from '../../monitoring';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { useFoldPaneDisplay } from '../canvas/foldPaneDisplay';
import type { FoldPaneDisplay } from '../canvas/foldPaneScenes';
import { foldSpreadPictureKey, foldStatePictureKey, foldStatePictureUrl } from '../canvas/foldStatePicture';
import type { FoldScene } from '../engine/foldEngineWire';
import type { FoldSession } from '../session/foldSession';
import { FOLD_SCENE_QUERY } from '../session/foldStateQueries';
import { foldCardHandleKey, type FoldCardPictureSource } from './foldCardPictureSource';
export { foldCardPictureSource, type FoldCardPictureSource } from './foldCardPictureSource';

/**
 * The step strip's card pictures (plan D14): each step's folded state as the
 * folded pane paints it, in the user's paper style (`foldStatePicture`).
 *
 * A picture costs a scene and a paint, so:
 *
 * - **Kept by the state's fingerprint** (`fs1`), not its handle: a replay or
 *   a new worker hands out new handles for the same states, and two branches
 *   that land the same state share a picture. A state with no fingerprint
 *   yet — the step a tool is folding — is kept by its handle. Beside the
 *   state, the key is the card's layer spread (`foldSpreadPictureKey`) and
 *   the look (`foldStatePictureKey`): the style and the display switches.
 * - **Asked only for the cards in view.** The strip is windowed; a card
 *   asks for its picture as it mounts. The scene is the one every Fold
 *   surface asks for (`FOLD_SCENE_QUERY`), so a state the canvas or the
 *   frames already asked for is painted from the answer in hand.
 * - **Painted a slice at a time**, {@link SLICE_MS} per task, so a strip of
 *   dense states — or every card at once after the style changed — never
 *   holds the main thread; a job for a look no longer shown, or one no card
 *   on screen wants any more, is dropped unpainted.
 * - **A spread on the move is not painted tick by tick.** A card whose
 *   spread changes keeps its last picture of the state in this look on show
 *   and asks for the new one once the spread has held still for
 *   {@link SPREAD_SETTLE_MS} — a slider dragged over every card that
 *   inherits the spread paints each of them once, never goes blank under
 *   the reader, and never pushes the other cards' pictures out of the cache.
 *   A new spread's picture replaces the old ones of the state that no card
 *   wants any more.
 * - **Capped**: at most {@link MAX_PICTURES}, and {@link MAX_PICTURE_CHARS}
 *   of SVG between them, the oldest let go first; a card scrolled back to
 *   paints again.
 */

const MAX_PICTURES = 96;
const MAX_PICTURE_CHARS = 8_000_000;
const SLICE_MS = 8;
/** How long a card's spread holds still before its new picture is asked for: a slider's ticks come faster. */
export const SPREAD_SETTLE_MS = 160;

/**
 * Painted pictures by key: a data URL, or null for a state with nothing to
 * draw; and the keys whose paint or ask failed, while a card wants them.
 */
const pictures = createStore<{ byKey: ReadonlyMap<string, string | null>; failed: ReadonlySet<string> }>(() => ({
  byKey: new Map(),
  failed: new Set(),
}));

interface PaintJob {
  key: string;
  look: string;
  scene: FoldScene;
  style: PaperStyle;
  display: FoldPaneDisplay;
  spread: LayerSpreadOptions | null;
}

/** Asked and not yet painted: a scene on its way, or a job in the queue. */
const asked = new Set<string>();
const queue: PaintJob[] = [];
/** The look the latest ask was for: a job for any other is for a look no longer shown. */
let currentLook = '';
let scheduled = false;
/** How many mounted cards want each key (`useFoldCardPicture`). */
const wanted = new Map<string, number>();
/** The keys a card has wanted: one no card wants any more is not painted, and gives way to a newer spread. */
const carded = new Set<string>();

/**
 * A picture's key: the state, the look, then the spread — so the pictures of
 * one state in one look, whatever their spread, share {@link stateLookOf}.
 */
const pictureKey = (source: FoldCardPictureSource, look: string) =>
  `${source.key}|${look}#${foldSpreadPictureKey(source.spread)}`;

/** The state and the look a picture's key names, without its spread. */
const stateLookOf = (key: string) => key.slice(0, key.lastIndexOf('#'));

/** A card asked for once and since let go by every card that wanted it. */
const unwanted = (key: string) => carded.has(key) && !wanted.has(key);

function want(key: string): void {
  carded.add(key);
  wanted.set(key, (wanted.get(key) ?? 0) + 1);
}

function release(key: string): void {
  const count = (wanted.get(key) ?? 0) - 1;
  if (count > 0) {
    wanted.set(key, count);
    return;
  }
  wanted.delete(key);
  // No card says it failed any more: one that wants it later asks again.
  if (pictures.getState().failed.has(key)) pictures.setState({ failed: without(pictures.getState().failed, [key]) });
}

/** Mark the keys a card wants as failed: those cards stop waiting for them. */
function fail(keys: readonly string[]): void {
  const failing = keys.filter((key) => wanted.has(key));
  if (failing.length === 0) return;
  pictures.setState({ failed: new Set([...pictures.getState().failed, ...failing]) });
}

function without(set: ReadonlySet<string>, keys: readonly string[]): ReadonlySet<string> {
  const next = new Set(set);
  for (const key of keys) next.delete(key);
  return next;
}

/** Forget a key that is neither painted nor wanted. */
function forget(key: string): void {
  if (!wanted.has(key)) carded.delete(key);
}

/**
 * Keep what a slice painted, newest last; let go of the pictures of the same
 * states in the same look at other spreads that no card wants; then of the
 * oldest past the caps — never what this slice painted, which a card on
 * screen is waiting for: letting it go would only have the card ask for it
 * again.
 */
function keep(painted: readonly { key: string; url: string | null }[]): void {
  const next = new Map(pictures.getState().byKey);
  const fresh = new Set(painted.map(({ key }) => key));
  const replaced = new Set(painted.map(({ key }) => stateLookOf(key)));
  for (const key of next.keys()) {
    if (!fresh.has(key) && replaced.has(stateLookOf(key)) && unwanted(key)) {
      next.delete(key);
      forget(key);
    }
  }
  for (const { key, url } of painted) {
    next.delete(key);
    next.set(key, url);
  }
  let chars = 0;
  for (const url of next.values()) chars += url?.length ?? 0;
  for (const [oldest, url] of next) {
    if (next.size <= MAX_PICTURES && chars <= MAX_PICTURE_CHARS) break;
    if (fresh.has(oldest)) continue;
    next.delete(oldest);
    forget(oldest);
    chars -= url?.length ?? 0;
  }
  const { failed } = pictures.getState();
  pictures.setState({ byKey: next, failed: painted.some(({ key }) => failed.has(key)) ? without(failed, [...fresh]) : failed });
}

function drain(): void {
  scheduled = false;
  const start = performance.now();
  const painted: { key: string; url: string | null }[] = [];
  const failed: string[] = [];
  while (performance.now() - start < SLICE_MS) {
    const job = queue.shift();
    if (!job) break;
    asked.delete(job.key);
    if (job.look !== currentLook || unwanted(job.key)) {
      forget(job.key);
      continue;
    }
    try {
      painted.push({ key: job.key, url: foldStatePictureUrl(job.scene, job.style, job.display, job.spread) });
    } catch (error) {
      // Not the user's to act on: the card says it can't be drawn, and asks again when it next mounts.
      failed.push(job.key);
      reportError(error, { surface: 'fold:card-picture' });
    }
  }
  if (painted.length > 0) keep(painted);
  fail(failed);
  if (queue.length > 0) schedule();
}

function schedule(): void {
  if (scheduled) return;
  scheduled = true;
  // A task of its own, so the strip renders between slices.
  setTimeout(drain, 0);
}

function enqueue(job: PaintJob): void {
  queue.push(job);
  schedule();
}

/** Paint a state's picture in this look, unless it is painted or on its way. */
export function requestFoldCardPicture(
  session: FoldSession,
  source: FoldCardPictureSource,
  style: PaperStyle,
  display: FoldPaneDisplay
): void {
  const look = foldStatePictureKey(style, display);
  currentLook = look;
  const key = pictureKey(source, look);
  if (pictures.getState().byKey.has(key) || asked.has(key)) return;
  asked.add(key);
  const { spread } = source;
  const held = session.peek(source.state, FOLD_SCENE_QUERY);
  if (held) {
    enqueue({ key, look, scene: held.value, style, display, spread });
    return;
  }
  session.query(source.state, FOLD_SCENE_QUERY).then(
    (answer) => {
      // A state that went with its engine is asked again under its next handle;
      // one no card wants any more, when a card wants it again.
      if (answer.status === 'answered' && !unwanted(key)) {
        enqueue({ key, look, scene: answer.value, style, display, spread });
        return;
      }
      asked.delete(key);
      forget(key);
    },
    (error: unknown) => {
      asked.delete(key);
      forget(key);
      fail([key]);
      reportError(error, { surface: 'fold:card-picture' });
    }
  );
}

/** A state's picture in this look: its URL, null for nothing to draw, undefined while not painted. */
export function heldFoldCardPicture(
  source: FoldCardPictureSource,
  style: PaperStyle,
  display: FoldPaneDisplay
): string | null | undefined {
  return pictures.getState().byKey.get(pictureKey(source, foldStatePictureKey(style, display)));
}

/** Forget every picture and every job: for tests. */
export function clearFoldCardPictures(): void {
  asked.clear();
  queue.length = 0;
  currentLook = '';
  wanted.clear();
  carded.clear();
  pictures.setState({ byKey: new Map(), failed: new Set() });
}

/** The picture a card shows, kept by the state and the look it is of. */
interface ShownPicture {
  stateLook: string;
  url: string | null;
}

/**
 * A card's picture, in the sequence's paper style (`useFoldPaperStyle`) and
 * under the panes' display switches: a data URL; null for a state with nothing to draw, no
 * state, or a paint that failed; undefined while it is being painted. Asks
 * for it as the card mounts, and again when the style or the switches change.
 *
 * A new spread of the state on the card is no new picture to wait blank for:
 * the card keeps its last one of that state in this look, and asks for the
 * new one once the spread has held still ({@link SPREAD_SETTLE_MS}).
 */
export function useFoldCardPicture(source: FoldCardPictureSource | null): string | null | undefined {
  const session = foldSession();
  const style = useFoldPaperStyle();
  const display = useFoldPaneDisplay();
  const look = foldStatePictureKey(style, display);
  const key = source ? pictureKey(source, look) : null;
  // A step just committed is the state its preview's card pictured under its
  // handle, before it had a fingerprint: the same state, look and spread are
  // the same picture, shown at once rather than painted again.
  const handleKey = source ? foldCardHandleKey(source.state) : null;
  const previewed = source && handleKey !== null && handleKey !== source.key ? pictureKey({ ...source, key: handleKey }, look) : null;
  const stateLook = key === null ? null : stateLookOf(key);
  const picture = useStore(pictures, (snapshot) =>
    key === null ? null : (snapshot.byKey.get(key) ?? (previewed === null ? undefined : snapshot.byKey.get(previewed)))
  );
  const failed = useStore(pictures, (snapshot) => key !== null && snapshot.failed.has(key));
  const [shown, setShown] = useState<ShownPicture | null>(null);
  // Adjusted during render, so the frame that brings the new picture shows it.
  if (stateLook !== null && picture !== undefined && (shown?.stateLook !== stateLook || shown.url !== picture)) {
    setShown({ stateLook, url: picture });
  }
  const last = shown !== null && shown.stateLook === stateLook ? shown : null;
  useEffect(() => {
    if (key === null) return undefined;
    want(key);
    return () => release(key);
  }, [key]);
  const respread = last !== null;
  useEffect(() => {
    if (!source || picture !== undefined) return undefined;
    const ask = () => requestFoldCardPicture(session, source, style, display);
    if (!respread) {
      ask();
      return undefined;
    }
    const settled = setTimeout(ask, SPREAD_SETTLE_MS);
    return () => clearTimeout(settled);
  }, [session, source, style, display, picture, respread]);
  if (picture !== undefined) return picture;
  if (failed) return null;
  return last ? last.url : undefined;
}
