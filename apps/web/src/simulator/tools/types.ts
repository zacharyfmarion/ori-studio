/**
 * The simulator's tool contract.
 *
 * Everything under `simulator/tools/` is pure: no React, no store, no worker.
 * The viewport feeds pointer samples to an engine and hands the gesture that
 * comes out to `useSimulatorTools`, which is the one place a tool has effects.
 * See `implementation-plans/simulator-tool-rail-and-pins.md` for how to add a
 * tool.
 */
import type { SimulatorShortcutId } from '../../keyboard/shortcuts';
import type { SimulatorPickRegion } from '../pickQuery';

/** The simulator's tools. Orbit is the resting one: a drag turns the model. */
export type SimulatorToolId = 'orbit' | 'pin';

/**
 * How a tool reads a press on the canvas.
 *
 * One list, where Edit carries three overlapping ones, with a total `Record` of
 * routes in `pressRoute.ts`: a new mode is a typecheck error everywhere it has
 * to be handled.
 */
export type SimulatorInputMode = 'orbit' | 'pick-faces';

/** Icon names, mapped to glyphs by each surface so this module stays JSX-free. */
export type SimulatorToolIcon = 'orbit' | 'pin';

/** The cursor a tool shows over the canvas while nothing overrides it. */
export type SimulatorToolCursor = 'grab' | 'crosshair';

/** An option a tool keeps between sessions. */
export type SimulatorToolOptionId = 'pinThroughLayers';

export interface SimulatorToolOptions {
  /** A pin box reaches every layer centred inside it, rather than only what shows. */
  pinThroughLayers: boolean;
}

export const DEFAULT_SIMULATOR_TOOL_OPTIONS: SimulatorToolOptions = {
  pinThroughLayers: true,
};

/**
 * Something the tool window says that is not an error: errors are toasts.
 *
 * - `recovered`: the solver blew up while pinned and restarted from flat, so
 *   the pins now hold the flat sheet.
 * - `strained`: the pins are stretching the paper between them.
 */
export type SimulatorToolNotice = 'recovered' | 'strained';

/** What the tools show, read by the rail, the window and the cursor. */
export interface SimulatorToolsView {
  activeToolId: SimulatorToolId;
  /** Faces pinned on the model on screen. */
  pinnedCount: number;
  options: SimulatorToolOptions;
  notices: readonly SimulatorToolNotice[];
}

/**
 * The sections of the tool window, without a word of text: `actions.ts` turns
 * them into strings and bound verbs, and one renderer draws every tool's.
 */
export interface SimulatorToolWindowSections {
  /** The Pin tool's own window, or the pins' while another tool is active. */
  kind: 'pin' | 'pins';
  /** How to use the tool, for as long as it has nothing else to report. */
  instructions: boolean;
  options: readonly SimulatorToolOptionId[];
  /** The pinned count, with Clear. */
  pins: boolean;
}

export interface SimulatorToolDefinition {
  id: SimulatorToolId;
  icon: SimulatorToolIcon;
  /** The verb that selects it, which is also where its key comes from. */
  shortcut: SimulatorShortcutId;
  input: SimulatorInputMode;
  cursor: SimulatorToolCursor;
  /** What the tool window shows while this tool is active; null for nothing. */
  window: (view: SimulatorToolsView) => SimulatorToolWindowSections | null;
}

/** A point on the canvas, in CSS pixels from its top-left corner. */
export interface CssPoint {
  x: number;
  y: number;
}

/** A rectangle on the canvas, in CSS pixels, normalised so `left <= right`. */
export interface CssRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CssSize {
  width: number;
  height: number;
}

/** One pointer sample, in canvas CSS pixels. */
export interface SimulatorPointerInput {
  kind: 'down' | 'move' | 'up' | 'cancel';
  point: CssPoint;
  /**
   * Shift is held. Read from the press, as Edit reads it for a box select, so
   * letting go of Shift halfway through does not change what the box does.
   */
  shift: boolean;
  /** A finger, rather than a mouse or a pen. */
  touch: boolean;
}

/** A finished gesture, before any tool has said what it means. */
export type SimulatorGesture =
  | { kind: 'box'; rect: CssRect; shift: boolean; touch: boolean }
  | { kind: 'click'; point: CssPoint; shift: boolean; touch: boolean };

export interface SimulatorGestureOutput<S> {
  state: S;
  /** What to draw while the gesture is in flight. */
  preview: { marquee: CssRect } | null;
  /** Set on the sample that finishes a gesture. */
  gesture: SimulatorGesture | null;
}

/** A pure gesture reducer, the shape of Edit's tool engines over CSS pixels. */
export interface SimulatorGestureEngine<S> {
  readonly initialState: S;
  reduce(state: S, input: SimulatorPointerInput): SimulatorGestureOutput<S>;
}

/** How a pick combines with the pins already set. */
export type PinMode = 'replace' | 'add' | 'toggle';

/**
 * Which faces a pick reached: every layer centred in a box, only what shows in
 * it, or the one face in front of a point.
 */
export type SimulatorPickReach = 'all-layers' | 'visible' | 'front';

/**
 * What a finished gesture asks for. One kind today; a tool with a new effect
 * adds its own, and the hook's executor is exhaustive over them.
 */
export interface SimulatorPickFacesIntent {
  kind: 'pick-faces';
  /** How it was asked, for analytics: a box, a click, or a finger's tap. */
  gesture: 'box' | 'click' | 'tap';
  region: SimulatorPickRegion;
  reach: SimulatorPickReach;
  mode: PinMode;
  /** The canvas's CSS size when the gesture ended, which the region is relative to. */
  surface: CssSize;
}

export type SimulatorIntent = SimulatorPickFacesIntent;
