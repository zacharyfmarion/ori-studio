/**
 * Which tools the Fold rail offers, in which groups (plan D14).
 *
 * One list, read by both surfaces that draw it — the rail's icon grid and the
 * phone's labelled tool sheet — as Edit's `cpRailGroups()` serves both of
 * Edit's. The sheet exists to name what the rail shows, so a sheet that worked
 * out its own list could quietly stop naming some of it. Gating, words and the
 * calls are decided here; each surface only draws.
 *
 * React-free and store-free: it takes a view and bound verbs and returns data.
 */
import type { TFunction } from 'i18next';
import type { TurnKind } from '../../lib/steps/turn';
import type { FoldVertexLines } from './vertex/vertexInputs';
import {
  FOLD_LINE_MODES,
  FOLD_LINE_MODE_SHORTCUTS,
  FOLD_MODEL_TURNS,
  FOLD_MODEL_VERB_SHORTCUTS,
  FOLD_SEQUENCE_TOOLS,
  FOLD_SINK_TOOLS,
  FOLD_TOOL_SHORTCUTS,
  FOLD_VERTEX_TOOLS,
  foldModelVerbDescription,
  foldModelVerbLabel,
  foldReadOnlyReason,
  foldToolDescription,
  foldToolLabel,
  usesLineMode,
  lineModeDescription,
  lineModeLabel,
  type FoldLineModeId,
  type FoldModelVerbId,
  type FoldReadOnlyReason,
  type FoldRailItemId,
  type FoldShortcutId,
  type FoldToolId,
} from './foldToolCatalog';

/** What the rail shows from: the tool in hand and the line mode chosen. */
export interface FoldToolsView {
  tool: FoldToolId;
  lineMode: FoldLineModeId;
  /**
   * How the vertex fold in hand is constructed: a swivel by its valley and
   * mountain, or a squash about a drawn hinge not yet taken, locates lines
   * with the line modes.
   */
  construction?: Partial<FoldVertexLines>;
  /** Set while nothing on the sequence can change, and why. */
  readOnly: FoldReadOnlyReason | null;
  /** The flat sheet is on screen: there is no step to unfold, or to repeat. */
  atSheet?: boolean;
}

/** The calls the rail and the tool sheet make; the store binds them. */
export interface FoldRailVerbs {
  selectTool: (id: FoldToolId) => void;
  selectLineMode: (id: FoldLineModeId) => void;
  /** A model verb: add this turn as a step of its own (D6). */
  turn: (turn: TurnKind) => void;
}

export type FoldRailGroupId = 'fold' | 'sink' | 'reference' | 'locate' | 'model' | 'sequence';

/** Taken in hand; a way of locating the line; or done at once. */
export type FoldRailItemKind = 'tool' | 'line-mode' | 'verb';

export interface FoldRailItem {
  id: FoldRailItemId;
  kind: FoldRailItemKind;
  label: string;
  /** What it does, in a line. */
  description: string;
  /** Why it cannot be used now; null while it can. Said in place of the description. */
  reason: string | null;
  /** The key the Fold scope gives it; null for what has none. */
  shortcut: FoldShortcutId | null;
  active: boolean;
  available: boolean;
  select: () => void;
}

export interface FoldRailGroup {
  id: FoldRailGroupId;
  label: string;
  collapsedByDefault: boolean;
  items: readonly FoldRailItem[];
}

const FOLD_GROUP_TOOLS: readonly FoldToolId[] = [
  'valley',
  'mountain',
  'precrease',
  'inside-reverse',
  'crimp',
  'pleat',
  // The vertex folds.
  ...FOLD_VERTEX_TOOLS,
];

function groupLabel(t: TFunction, id: FoldRailGroupId): string {
  switch (id) {
    case 'fold':
      return t('tools:fold.group.fold', 'Fold');
    case 'sink':
      return t('tools:fold.group.sink', 'Sinks');
    case 'reference':
      return t('tools:fold.group.reference', 'Reference points');
    case 'locate':
      return t('tools:fold.group.locate', 'Locate line');
    case 'model':
      return t('tools:fold.group.model', 'Model');
    case 'sequence':
      return t('tools:fold.group.sequence', 'Sequence');
  }
}

/**
 * The rail's groups, in order: the folds; the sinks; Reference points; Locate
 * line; the model — Turn over, done at once, and the Rotate tool; and the
 * sequence — Unfold to step and Repeat, which act on the steps folded so far.
 * Every surface that shows the Fold tools reads this list.
 */
export function foldRailGroups(t: TFunction, view: FoldToolsView, verbs: FoldRailVerbs): FoldRailGroup[] {
  const locked = view.readOnly === null ? null : foldReadOnlyReason(t, view.readOnly);
  const tool = (id: FoldToolId, reason = locked): FoldRailItem => ({
    id,
    kind: 'tool',
    label: foldToolLabel(t, id),
    description: foldToolDescription(t, id),
    reason,
    shortcut: FOLD_TOOL_SHORTCUTS[id] ?? null,
    active: view.tool === id,
    available: reason === null,
    select: () => verbs.selectTool(id),
  });
  // The flat sheet has no step to return from, nor one to repeat.
  const sequenceReason = locked ?? (view.atSheet ? t('panels:fold.return.empty', 'Fold a step first.') : null);

  const lineMode = (id: FoldLineModeId): FoldRailItem => ({
    id,
    kind: 'line-mode',
    label: lineModeLabel(t, id),
    description: lineModeDescription(t, id),
    reason: locked,
    shortcut: FOLD_LINE_MODE_SHORTCUTS[id],
    // A line mode stays chosen under the Divide line, but is not what the
    // canvas is doing then; a petal fold locates its line H through it.
    active: view.lineMode === id && usesLineMode(view.tool, view.construction),
    available: locked === null,
    select: () => verbs.selectLineMode(id),
  });

  const verb = (id: FoldModelVerbId): FoldRailItem => ({
    id,
    kind: 'verb',
    label: foldModelVerbLabel(t, id),
    description: foldModelVerbDescription(t, id),
    reason: locked,
    shortcut: FOLD_MODEL_VERB_SHORTCUTS[id],
    // Done at once and gone: never the thing in hand.
    active: false,
    available: locked === null,
    select: () => verbs.turn(FOLD_MODEL_TURNS[id]),
  });

  const groups: [FoldRailGroupId, readonly FoldRailItem[]][] = [
    ['fold', FOLD_GROUP_TOOLS.map((id) => tool(id))],
    ['sink', FOLD_SINK_TOOLS.map((id) => tool(id))],
    ['reference', [tool('divide-line')]],
    ['locate', FOLD_LINE_MODES.map(lineMode)],
    // Turn over at once; Rotate a tool, its amount and direction to choose.
    ['model', [verb('turn-over'), tool('rotate')]],
    ['sequence', FOLD_SEQUENCE_TOOLS.map((id) => tool(id, sequenceReason))],
  ];
  return groups.map(([id, items]) => ({
    id,
    label: groupLabel(t, id),
    collapsedByDefault: false,
    items,
  }));
}

/**
 * A rail item's tooltip: its name, its key when it has one, and what it does
 * or why it cannot — Edit's and Annotate's form.
 */
export function foldRailTooltip(item: FoldRailItem, key: string | undefined): string {
  const name = key ? `${item.label} (${key})` : item.label;
  return `${name} - ${item.reason ?? item.description}`;
}
