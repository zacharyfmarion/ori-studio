/**
 * The Fold workspace's tools (plan D14): what each one is, which group it is
 * in, the key the Fold scope will give it, and its words — for every surface
 * that offers them, the rail, the phone's tool sheet and the tool window.
 *
 * Three kinds of item stand on the rail, and they combine:
 *
 * - **a tool** is taken in hand: a fold (valley, mountain, precrease), the
 *   Divide line, or Rotate, which previews the model turned by the amount
 *   its window sets and adds the turn as a step once applied (`tools/rotate`);
 *   Unfold to step and Repeat preview the same way, from the step and the
 *   range their windows set (`fold/return`, `fold/repeat`);
 * - **a line mode** says how a fold's line is located — an axiom, a free line,
 *   or an existing crease — and stays chosen across fold tools;
 * - **a model verb** (turn over) is a step of its own, done at once: it has
 *   no amount to choose.
 *
 * React-free and store-free; literal `t()` keys so the extractor sees them.
 */
import type { TFunction } from 'i18next';
import type { FoldShortcutId as RegistryFoldShortcutId } from '../../keyboard/shortcuts';
import { axiomPhrase, type FoldAxiom } from '../../lib/foldSentences';
import type { TurnKind } from '../../lib/steps/turn';
import { turnCardWords } from '../../lib/steps/turnWords';
import type { FoldVertexOpKind } from '../document/foldSequenceDocument';
import { FOLD_ROTATION_DEFAULT } from './rotate/rotateTool';
import { locatesWithLineModes, type FoldVertexLines } from './vertex/vertexInputs';

/** A plain fold's kind, as the tool window's V / M / P control offers it. */
export type FoldKind = 'valley' | 'mountain' | 'precrease';

export const FOLD_KINDS: readonly FoldKind[] = ['valley', 'mountain', 'precrease'];

/**
 * A vertex fold's tool (plan Phase 11): paper turned about a vertex rather
 * than folded along a located line, each named as the op it commits
 * (`tools/vertex`).
 */
export type FoldVertexToolId = FoldVertexOpKind;

export const FOLD_VERTEX_TOOLS: readonly FoldVertexToolId[] = ['squash', 'petal', 'rabbit-ear', 'swivel'];

export function isVertexTool(id: FoldToolId): id is FoldVertexToolId {
  return (FOLD_VERTEX_TOOLS as readonly string[]).includes(id);
}

/**
 * A tool taken in hand. Inside reverse is the design's fourth fold; it folds
 * outside too, as its kind control's other value (plan Phase 9, research
 * §5.2: the kind is usually forced by the geometry). The crimp and the tuck
 * (plan Phase 11) are compound folds along a located line too: a crimp along
 * a second line after it, a tuck against a layer the engine lists. The vertex
 * folds pick their flap, line or triangle themselves. The sinks are a family
 * of their own, each along a located line.
 */
export type FoldToolId =
  | FoldKind
  | 'inside-reverse'
  | FoldCompoundLineToolId
  | FoldVertexToolId
  | 'divide-line'
  | FoldSinkToolId
  // The model turned round, by a preset or an exact angle (`tools/rotate`).
  | 'rotate'
  | FoldSequenceToolId;

/**
 * The tools that act on the sequence's earlier steps rather than along a
 * line: Unfold to step returns to one (`fold/return`), Repeat folds a range
 * of them again on the other side of a symmetry axis (`fold/repeat`). Each
 * previews from the moment it is in hand, as Rotate does, and is put down
 * once its step is added.
 */
export type FoldSequenceToolId = 'unfold-to' | 'repeat';

export const FOLD_SEQUENCE_TOOLS: readonly FoldSequenceToolId[] = ['unfold-to', 'repeat'];

export function isSequenceTool(id: FoldToolId): id is FoldSequenceToolId {
  return id === 'unfold-to' || id === 'repeat';
}

/**
 * The tools held for one step and put down once it is added, the tool they
 * were taken up from back in hand: Rotate, and the sequence tools.
 */
export function isOneStepTool(id: FoldToolId): id is 'rotate' | FoldSequenceToolId {
  return id === 'rotate' || isSequenceTool(id);
}

/** The compound folds along a located line that are tools of their own, beside inside reverse. */
export type FoldCompoundLineToolId = 'crimp' | 'tuck' | 'pleat';

export function isFoldKind(id: FoldToolId): id is FoldKind {
  return id === 'valley' || id === 'mountain' || id === 'precrease';
}

/** A tool that folds along a located line: the plain folds, and the compound folds along one. */
export type FoldLineToolId = FoldKind | 'inside-reverse' | FoldCompoundLineToolId | FoldSinkToolId;

export function isLineTool(id: FoldToolId): id is FoldLineToolId {
  return isFoldKind(id) || id === 'inside-reverse' || id === 'crimp' || id === 'pleat' || id === 'tuck' || isSinkTool(id);
}

/**
 * The sinks (plan Phase 11, research §5.4), each a tool along a located line:
 * a closed point's tip pushed in, open or closed, or a sunk one pulled back
 * out. The open and the closed sink are one sink's two kinds, the window's
 * control switching between them as the reverse fold's kind does.
 */
export type FoldSinkToolId = 'open-sink' | 'closed-sink' | 'unsink';

export const FOLD_SINK_TOOLS: readonly FoldSinkToolId[] = ['open-sink', 'closed-sink', 'unsink'];

export function isSinkTool(id: FoldToolId): id is FoldSinkToolId {
  return id === 'open-sink' || id === 'closed-sink' || id === 'unsink';
}

/** A sink's kind, as the sink tool's kind control names it in full: its tool's name. */
export function foldSinkKindLabel(t: TFunction, kind: 'open' | 'closed'): string {
  return foldToolLabel(t, kind === 'open' ? 'open-sink' : 'closed-sink');
}

/** Pleat supports every construction independently on each line. Crimp's menu remains free/crease. */
export type FoldSecondLineModeId = FoldLineModeId;

export const FOLD_SECOND_LINE_MODES: readonly FoldSecondLineModeId[] = ['free', 'crease'];

/**
 * Whether the active construction uses the shared Locate line tools: a
 * swivel's by its valley and mountain does, and a squash's drawn hinge until
 * it is taken.
 */
export function usesLineMode(id: FoldToolId, construction: Partial<FoldVertexLines> = {}): boolean {
  return locatesLine(id) || (isVertexTool(id) && locatesWithLineModes(id, construction));
}

/** Tools folded along one line; the type guard excludes multi-line constructions. */
export function locatesLine(id: FoldToolId): id is FoldLineToolId {
  return isLineTool(id);
}

/**
 * How a vertex fold names a line it takes (`tools/vertex/vertexInputs`): an
 * existing crease clicked, or the line through two points clicked — a petal
 * fold's hinge, which the fold then creases itself, or the line a swivel lays
 * its edge on.
 */
export type FoldLineBy = 'crease' | 'points';

export const FOLD_LINE_BY: readonly FoldLineBy[] = ['crease', 'points'];

/** A reverse fold's kind, as the reverse tool's kind control names it. */
export function foldReverseKindLabel(t: TFunction, kind: 'inside' | 'outside'): string {
  return kind === 'inside'
    ? t('tools:fold.tool.insideReverse', 'Inside reverse fold')
    : t('tools:fold.op.outsideReverse', 'Outside reverse fold');
}

/** A crimp's kind, as its kind control and its commit name it: the Step pane's words for it. */
export function foldCrimpKindLabel(t: TFunction, kind: 'inside' | 'outside'): string {
  return kind === 'inside'
    ? t('panels:fold.words.crimpInside', 'Inside crimp')
    : t('panels:fold.words.crimpOutside', 'Outside crimp');
}

/** A tuck by its direction as the viewer sees it, as its window and its commit name it: the Step pane's words. */
export function foldTuckLabel(t: TFunction, direction: 'valley' | 'mountain'): string {
  return direction === 'valley'
    ? t('panels:fold.words.tuckValley', 'Valley fold and tuck')
    : t('panels:fold.words.tuckMountain', 'Mountain fold and tuck');
}

/** How a fold's line is located: an axiom, a line drawn freely, or a crease already there (D3 "existing crease"). */
export type FoldLineModeId =
  | 'axiom-1'
  | 'axiom-2'
  | 'axiom-3'
  | 'axiom-4'
  | 'axiom-5'
  | 'axiom-6'
  | 'axiom-7'
  | 'free'
  | 'crease';

/** The line modes in the order every surface lists them (plan D14). */
export const FOLD_LINE_MODES: readonly FoldLineModeId[] = [
  'axiom-1',
  'axiom-2',
  'axiom-3',
  'axiom-4',
  'axiom-5',
  'axiom-6',
  'axiom-7',
  'free',
  'crease',
];

export function isFoldLineMode(value: string): value is FoldLineModeId {
  return (FOLD_LINE_MODES as readonly string[]).includes(value);
}

/** The axiom a line mode is, or null for a free line and an existing crease. */
export function lineModeAxiom(mode: FoldLineModeId): FoldAxiom | null {
  switch (mode) {
    case 'axiom-1':
      return 1;
    case 'axiom-2':
      return 2;
    case 'axiom-3':
      return 3;
    case 'axiom-4':
      return 4;
    case 'axiom-5':
      return 5;
    case 'axiom-6':
      return 6;
    case 'axiom-7':
      return 7;
    case 'free':
    case 'crease':
      return null;
  }
}

/**
 * A step of its own that turns the whole model (lib/steps' turn type), done
 * at once from the rail: Turn over, which has nothing to choose. A rotation
 * has its amount and direction to choose, so it is a tool (`rotate`).
 */
export type FoldModelVerbId = 'turn-over';

/** What each model verb adds: Fold's turn over mirrors side to side (`View::turned_over`). */
export const FOLD_MODEL_TURNS: Readonly<Record<FoldModelVerbId, TurnKind>> = {
  'turn-over': { kind: 'turn-over', axis: 'vertical' },
};

/** Anything the rail shows: what its glyph is chosen by. */
export type FoldRailItemId = FoldToolId | FoldLineModeId | FoldModelVerbId;

/**
 * The registry ids the Fold scope binds (plan D14 Keyboard, `keyboard/shortcuts.ts`'s
 * `FOLD_SHORTCUTS`), and Escape's, which runs through the viewport's cancel
 * ladder. One list with the registry's, so a tooltip and the scope cannot
 * disagree; the surface resolves each to the user's key.
 */
export type FoldShortcutId = RegistryFoldShortcutId | 'viewport.cancel';

/** Resolves a key's id to the label the user's layout gives it, or undefined while it has none. */
export type FoldKeyLabel = (id: FoldShortcutId) => string | undefined;

export const FOLD_TOOL_SHORTCUTS: Readonly<Partial<Record<FoldToolId, FoldShortcutId>>> = {
  valley: 'fold.toolValley',
  mountain: 'fold.toolMountain',
  precrease: 'fold.toolPrecrease',
  'inside-reverse': 'fold.toolInsideReverse',
  crimp: 'fold.toolCrimp',
  pleat: 'fold.toolPleat',
  // The vertex folds.
  squash: 'fold.toolSquash',
  petal: 'fold.toolPetal',
  'rabbit-ear': 'fold.toolRabbitEar',
  swivel: 'fold.toolSwivel',
  'divide-line': 'fold.toolDivideLine',
  // The sinks.
  'open-sink': 'fold.toolOpenSink',
  'closed-sink': 'fold.toolClosedSink',
  unsink: 'fold.toolUnsink',
  // Rotate, on R as the rotation was when it was done at once.
  rotate: 'fold.rotate',
  // The sequence tools, on Shift+E and Shift+R.
  'unfold-to': 'fold.toolUnfoldTo',
  repeat: 'fold.toolRepeat',
};

export const FOLD_LINE_MODE_SHORTCUTS: Readonly<Record<FoldLineModeId, FoldShortcutId>> = {
  'axiom-1': 'fold.lineAxiom1',
  'axiom-2': 'fold.lineAxiom2',
  'axiom-3': 'fold.lineAxiom3',
  'axiom-4': 'fold.lineAxiom4',
  'axiom-5': 'fold.lineAxiom5',
  'axiom-6': 'fold.lineAxiom6',
  'axiom-7': 'fold.lineAxiom7',
  free: 'fold.lineFree',
  crease: 'fold.lineCrease',
};

export const FOLD_MODEL_VERB_SHORTCUTS: Readonly<Record<FoldModelVerbId, FoldShortcutId>> = {
  'turn-over': 'fold.turnOver',
};

/** Why nothing on the sequence can change: a newer build wrote it (D7), or the step is locked (D6). */
export type FoldReadOnlyReason = 'newer' | 'locked';

export function foldReadOnlyReason(t: TFunction, reason: FoldReadOnlyReason): string {
  switch (reason) {
    case 'newer':
      return t('tools:fold.readOnly.newer', 'This sequence is from a newer Ori Studio, so it opens read-only.');
    case 'locked':
      return t('tools:fold.readOnly.locked', 'This step is from a newer Ori Studio, so nothing can be folded from it.');
  }
}

export function foldToolLabel(t: TFunction, id: FoldToolId): string {
  switch (id) {
    case 'valley':
      return t('tools:fold.tool.valley', 'Valley fold');
    case 'mountain':
      return t('tools:fold.tool.mountain', 'Mountain fold');
    case 'precrease':
      return t('tools:fold.tool.precrease', 'Precrease');
    case 'inside-reverse':
      return t('tools:fold.tool.reverse', 'Reverse fold');
    case 'pleat':
      return t('tools:fold.op.pleat', 'Pleat');
    case 'crimp':
      return t('tools:fold.op.crimp', 'Crimp');
    case 'tuck':
      return t('tools:fold.op.tuck', 'Tuck');
    // The vertex folds, by the names the rail gave them while they were planned.
    case 'squash':
      return t('tools:fold.op.squash', 'Squash fold');
    case 'petal':
      return t('tools:fold.op.petal', 'Petal fold');
    case 'rabbit-ear':
      return t('tools:fold.op.rabbitEar', 'Rabbit ear');
    case 'swivel':
      return t('tools:fold.op.swivel', 'Swivel fold');
    case 'divide-line':
      return t('tools:fold.tool.divideLine', 'Divide line');
    // The sinks, by the names the rail gave them while they were planned.
    case 'open-sink':
      return t('tools:fold.op.openSink', 'Open sink');
    case 'closed-sink':
      return t('tools:fold.op.closedSink', 'Closed sink');
    case 'unsink':
      return t('tools:fold.op.unsink', 'Unsink');
    case 'rotate':
      // The turn's own word, so the tool, its step and the Diagram it is linked to name it alike.
      return turnCardWords({ kind: 'rotate', rotate: FOLD_ROTATION_DEFAULT }, t).title;
    // The sequence tools by their steps' names, so a tool and the step it adds are named alike.
    case 'unfold-to':
      return t('panels:fold.return.label', 'Unfold to step');
    case 'repeat':
      // On the other side or behind, as the axis taken says: the window and the step say which.
      return t('panels:fold.repeat.label', 'Repeat');
  }
}

/** What a tool does, in a line: the rail's tooltip after its name, and the phone sheet's row. */
export function foldToolDescription(t: TFunction, id: FoldToolId): string {
  switch (id) {
    case 'valley':
      return t('tools:fold.tool.valleyHelp', 'Fold the moving side toward you, so it lands on top.');
    case 'mountain':
      return t('tools:fold.tool.mountainHelp', 'Fold the moving side away from you, so it lands underneath.');
    case 'precrease':
      return t('tools:fold.tool.precreaseHelp', 'Fold and unfold, leaving a crease to use later.');
    case 'inside-reverse':
      return t('tools:fold.tool.reverseHelp', 'Reverse a flap inside itself or wrap it around the outside, reversing its spine.');
    case 'pleat':
      return t('tools:fold.tool.pleatHelp', 'Make a pleat: locate the mountain line, then the valley line.');
    case 'crimp':
      return t('tools:fold.tool.crimpHelp', 'Fold a flap in along one line and back out along a second, so its end turns.');
    case 'tuck':
      return t('tools:fold.tool.tuckHelp', 'Fold a flap and slide it under, or over, a layer that stays.');
    // The vertex folds.
    case 'squash':
      return t('tools:fold.vertex.help.squash', 'Open a two-layer flap and press it flat, its spine onto its hinge.');
    case 'petal':
      return t(
        'tools:fold.vertex.help.petalHinge',
        'Lift a flap’s lower point along a hinge while its sides fold in along two kite creases.'
      );
    case 'rabbit-ear':
      return t('tools:fold.vertex.help.rabbitEar', 'Fold a triangle’s corners in along their bisectors, so a point stands up.');
    case 'swivel':
      return t('tools:fold.vertex.help.swivelEdge', 'Swivel an edge onto a line, pivoting at a point.');
    case 'divide-line':
      return t('tools:fold.tool.divideLineHelp', 'Mark points that divide an edge or a crease into equal parts.');
    case 'open-sink':
      return t('tools:fold.tool.openSinkHelp', 'Push a closed point’s tip in, turning every layer of it inside out.');
    case 'closed-sink':
      return t('tools:fold.tool.closedSinkHelp', 'Push a closed point’s tip into a pocket, its layers kept together.');
    case 'unsink':
      return t('tools:fold.tool.unsinkHelp', 'Pull a sunk point’s tip back out.');
    case 'rotate':
      return t(
        'tools:fold.tool.rotateHelp',
        'Turn the model round by a part of a turn or an exact angle, previewed, then applied as a step of its own.'
      );
    case 'unfold-to':
      return t(
        'tools:fold.tool.unfoldToHelp',
        'Return the paper to an earlier step’s pose, keeping every crease made since, previewed, then added as a step.'
      );
    case 'repeat':
      return t(
        'tools:fold.tool.repeatAxisHelp',
        'Fold a range of steps again across a symmetry axis, on the other side or behind, previewed, then added as a step.'
      );
  }
}

export function lineModeLabel(t: TFunction, mode: FoldLineModeId): string {
  const axiom = lineModeAxiom(mode);
  if (axiom !== null) {
    return t('tools:fold.line.axiom', 'Axiom {{number}}: {{phrase}}', { number: axiom, phrase: axiomPhrase(t, axiom) });
  }
  return mode === 'free' ? t('tools:fold.line.free', 'Free line') : t('tools:fold.line.crease', 'Existing crease');
}

/** What a line mode locates, in a line: the rail's tooltip and the phone sheet's row. */
export function lineModeDescription(t: TFunction, mode: FoldLineModeId): string {
  switch (mode) {
    case 'axiom-1':
      return t('tools:fold.line.axiom1Help', 'The line through two points.');
    case 'axiom-2':
      return t('tools:fold.line.axiom2Help', 'The line that folds one point onto another.');
    case 'axiom-3':
      return t('tools:fold.line.axiom3Help', 'The line that folds one edge or crease onto another.');
    case 'axiom-4':
      return t('tools:fold.line.axiom4Help', 'The line through a point, perpendicular to an edge or crease.');
    case 'axiom-5':
      return t('tools:fold.line.axiom5Help', 'The line through a pivot that folds a point onto an edge or crease.');
    case 'axiom-6':
      return t('tools:fold.line.axiom6Help', 'The line that folds two points onto two edges or creases at once.');
    case 'axiom-7':
      return t(
        'tools:fold.line.axiom7Help',
        'The line that folds a point onto an edge or crease, perpendicular to another.'
      );
    case 'free':
      return t('tools:fold.line.freeHelp', 'A line drawn anywhere, with no reference.');
    case 'crease':
      return t('tools:fold.line.creaseHelp', 'A crease or folded edge already there: refold a precrease, or unfold a flap.');
  }
}

/**
 * The clicks that locate a line in this mode, one step each in click order —
 * the tool's slots, which the step stores in the axiom's own input order
 * (plan D6), so the order here is free to read naturally. Taps, on a finger
 * (`coarse`), as every touch instruction in the window says them.
 */
export function lineModeSteps(t: TFunction, mode: FoldLineModeId, coarse = false): string[] {
  const pointToMove = coarse
    ? t('tools:fold.steps.pointToMoveTouch', 'Tap the point to move.')
    : t('tools:fold.steps.pointToMove', 'Click the point to move.');
  const landOnLine = coarse
    ? t('tools:fold.steps.landOnLineTouch', 'Tap the edge or crease it should land on.')
    : t('tools:fold.steps.landOnLine', 'Click the edge or crease it should land on.');
  const perpendicularTo = coarse
    ? t('tools:fold.steps.perpendicularToTouch', 'Tap the edge or crease the fold is perpendicular to.')
    : t('tools:fold.steps.perpendicularTo', 'Click the edge or crease the fold is perpendicular to.');
  switch (mode) {
    case 'axiom-1':
      return coarse
        ? [
            t('tools:fold.steps.axiom1FirstTouch', 'Tap the first point the fold passes through.'),
            t('tools:fold.steps.axiom1SecondTouch', 'Tap the second point.'),
          ]
        : [
            t('tools:fold.steps.axiom1First', 'Click the first point the fold passes through.'),
            t('tools:fold.steps.axiom1Second', 'Click the second point.'),
          ];
    case 'axiom-2':
      return [
        pointToMove,
        coarse
          ? t('tools:fold.steps.axiom2LandTouch', 'Tap where it should land.')
          : t('tools:fold.steps.axiom2Land', 'Click where it should land.'),
      ];
    case 'axiom-3':
      return coarse
        ? [
            t('tools:fold.steps.axiom3MoveTouch', 'Tap the edge or crease to move.'),
            t('tools:fold.steps.axiom3OntoTouch', 'Tap the edge or crease to lay it on.'),
          ]
        : [
            t('tools:fold.steps.axiom3Move', 'Click the edge or crease to move.'),
            t('tools:fold.steps.axiom3Onto', 'Click the edge or crease to lay it on.'),
          ];
    case 'axiom-4':
      return [
        perpendicularTo,
        coarse
          ? t('tools:fold.steps.axiom4ThroughTouch', 'Tap the point the fold passes through.')
          : t('tools:fold.steps.axiom4Through', 'Click the point the fold passes through.'),
      ];
    case 'axiom-5':
      return [
        pointToMove,
        coarse
          ? t('tools:fold.steps.axiom5PivotTouch', 'Tap the pivot the fold passes through.')
          : t('tools:fold.steps.axiom5Pivot', 'Click the pivot the fold passes through.'),
        landOnLine,
      ];
    case 'axiom-6':
      return coarse
        ? [
            t('tools:fold.steps.axiom6FirstPointTouch', 'Tap the first point to move.'),
            landOnLine,
            t('tools:fold.steps.axiom6SecondPointTouch', 'Tap the second point to move.'),
            t('tools:fold.steps.axiom6SecondLineTouch', 'Tap the edge or crease that one should land on.'),
          ]
        : [
            t('tools:fold.steps.axiom6FirstPoint', 'Click the first point to move.'),
            landOnLine,
            t('tools:fold.steps.axiom6SecondPoint', 'Click the second point to move.'),
            t('tools:fold.steps.axiom6SecondLine', 'Click the edge or crease that one should land on.'),
          ];
    case 'axiom-7':
      return [pointToMove, landOnLine, perpendicularTo];
    case 'free':
      return [
        coarse
          ? t('tools:fold.steps.freeStartTouch', 'Tap where the fold line starts.')
          : t('tools:fold.steps.freeStart', 'Click where the fold line starts.'),
        freeEnd(t, coarse),
      ];
    case 'crease':
      return [
        coarse
          ? t('tools:fold.steps.creaseTouch', 'Tap the crease or folded edge to fold along.')
          : t('tools:fold.steps.crease', 'Click the crease or folded edge to fold along.'),
      ];
  }
}

/** A drawn line's second step, every tool's: where it ends. */
function freeEnd(t: TFunction, coarse: boolean): string {
  return coarse ? t('tools:fold.steps.freeEndTouch', 'Tap where it ends.') : t('tools:fold.steps.freeEnd', 'Click where it ends.');
}

/** A crimp's second line mode, as its control names it. */
export function secondLineModeLabel(t: TFunction, mode: FoldSecondLineModeId): string {
  return lineModeLabel(t, mode);
}

/**
 * The clicks that locate a crimp's first line, where the flap turns in: a
 * free line's and a crease's in a crimp's words, an axiom's as the axiom
 * says them.
 */
export function crimpFirstLineSteps(t: TFunction, mode: FoldLineModeId, coarse = false): string[] {
  switch (mode) {
    case 'free':
      return [
        coarse
          ? t('tools:fold.steps.crimpFirstStartTouch', 'Tap where the first line starts, nearer the body: where the flap turns in.')
          : t('tools:fold.steps.crimpFirstStart', 'Click where the first line starts, nearer the body: where the flap turns in.'),
        freeEnd(t, coarse),
      ];
    case 'crease':
      return [
        coarse
          ? t('tools:fold.steps.crimpFirstCreaseTouch', 'Tap the crease or folded edge where the flap turns in.')
          : t('tools:fold.steps.crimpFirstCrease', 'Click the crease or folded edge where the flap turns in.'),
      ];
    default:
      return lineModeSteps(t, mode, coarse);
  }
}

/** The clicks that locate a crimp's second line, after its first line's: one step each. */
export function secondLineSteps(t: TFunction, mode: FoldSecondLineModeId, coarse = false): string[] {
  switch (mode) {
    case 'free':
      return [
        coarse
          ? t(
              'tools:fold.steps.crimpSecondStartTouch',
              'Tap where the second line starts, beyond the first toward the tip: where the flap turns back out.'
            )
          : t(
              'tools:fold.steps.crimpSecondStart',
              'Click where the second line starts, beyond the first toward the tip: where the flap turns back out.'
            ),
        freeEnd(t, coarse),
      ];
    case 'crease':
      return [
        coarse
          ? t('tools:fold.steps.crimpSecondCreaseTouch', 'Tap the crease or folded edge beyond the first line where the flap turns back out.')
          : t('tools:fold.steps.crimpSecondCrease', 'Click the crease or folded edge beyond the first line where the flap turns back out.'),
      ];
    default:
      return lineModeSteps(t, mode, coarse);
  }
}

export function foldModelVerbLabel(t: TFunction, id: FoldModelVerbId): string {
  // The turn's own words, so a Fold step and the Diagram it is linked to name it alike.
  return turnCardWords(FOLD_MODEL_TURNS[id], t).title;
}

export function foldModelVerbDescription(t: TFunction, id: FoldModelVerbId): string {
  switch (id) {
    case 'turn-over':
      return t('tools:fold.verb.turnOverHelp', 'Turn the model over, side to side, as a step of its own.');
  }
}
