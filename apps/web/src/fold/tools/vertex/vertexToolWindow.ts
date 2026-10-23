/**
 * The vertex folds' window — squash, petal fold, rabbit ear, swivel (plan
 * Phase 11, D14) — as the plain descriptor the one Fold window renderer draws
 * (`components/fold/FoldToolWindow`), the reverse tool's window's sibling.
 *
 * While the clicks are being made: numbered steps for them, each naming what
 * the folder sees by its part in the fold (owner feedback, 2026-10-12: "the
 * edge that moves" named nothing), the fold's precondition — said up front,
 * since research §5.3 found the preconditions, not the stacking, to be what
 * stops these folds: for the petal fold and the swivel, a line above the
 * steps says what the fold is; for the others a note under the direction —
 * and the direction, which decides which layer a click names. Notes never
 * repeat a step: what a point snaps to while points are clicked, and Esc. A
 * petal fold's hinge is named by a crease or by its two ends, and a swivel's
 * target by a crease or edge or by two points: a control switches each
 * (`lineBy`), in both phases, so the window keeps its shape.
 *
 * A swivel is constructed by its edge onto a line or by its valley and
 * mountain (Construct by). By its edge, it offers no direction while its
 * clicks are made: the canvas lights only the edges and lines that land
 * some way (`swivelReach`). By its valley and mountain, its two lines are
 * located with the line modes, each named by its letter on the layer that
 * faces the viewer — the valley taken with Enter, then the mountain — and it
 * has no direction at all: its letters are the viewer's. Either way it
 * folds the folder's way and kind and never another (owner feedback,
 * 2026-10-20): one that does not land is refused, and the notice offers the
 * other way when that lands. Once previewed its steps stay, the last in
 * hand, and a control is shown only where there is a choice (owner
 * feedback, 2026-10-12).
 *
 * Once every click is in, previewing:
 *
 * - a swivel on a folded edge's **kind**, open (the strip folded up on top)
 *   or inside (tucked between the two layers) — when the other kind lands
 *   too, or the one asked does not; a kind that does not land disabled;
 * - **the direction**, valley or mountain, as the viewer sees it — a
 *   swivel by its edge's when the other way lands too, or the one asked
 *   does not; a way that does not land disabled;
 * - a squash's **spine target**: its hinge line until a point is clicked on
 *   the folded pane, drawn there either way (the bold line its step names),
 *   with a way back to the hinge;
 * - a rabbit ear's **layers** and hinge-region status. The canvas's fourth
 *   click fixes its hinge crease; no separate crease selector is offered;
 * - a swivel's **ridge**, the crease of its four that folds the other way:
 *   square to the edge, or toward its end — by name, only when both land;
 * - a petal fold's note: what the fold creases itself, the hinge and the
 *   kite creases, when they are not there already; a swivel's, how to read
 *   its picture;
 * - the **layer order**, when the fold leaves more than one;
 * - a refusal in the folder's words with every fix a button, and Cancel and
 *   the fold.
 *
 * React-free and store-free.
 */
import type { TFunction } from 'i18next';
import { FOLD_SWIVEL_KINDS, type FoldDirection, type FoldSwivelKind } from '../../document/foldSequenceDocument';
import type { FoldModelPoint } from '../../engine/foldEngineWire';
import { FOLD_LINE_BY, foldToolLabel, lineModeSteps, type FoldLineBy, type FoldVertexToolId } from '../foldToolCatalog';
import {
  queuedNote,
  lineModeNotes,
  lineModeSelect,
  settingsMeta,
  type FoldToolHost,
  type FoldToolInstructions,
  type FoldToolWindowModel,
  type FoldToolWindowVerbs,
  type FoldToolWindowView,
} from '../foldToolWindow';
import { foldRefusalNotice, sectionFlapNames } from '../refusalNotice';
import { choiceStepper, type FoldChoiceStepper, type FoldKindChoice } from '../reverse/reverseToolWindow';
import { swivelRidgeName } from '../../stepSentenceVertex';
import { vertexToolSteps, type FoldSquashHinge, type FoldSwivelInput } from './vertexInputs';

/** Which of a swivel's two creases rises as its ridge: square to the edge, or toward its far end. */
export type FoldSwivelRidge = 'foot' | 'end';

/** What a petal fold creases itself as it lifts the flap (`FoldPetalAnalysis`' `scores_line`, `scores_kites`). */
export interface FoldPetalScores {
  /** The hinge, through the top layer. */
  hinge: boolean;
  /** How many kite creases, through the top two layers. */
  kites: number;
}

/** What a vertex tool's window is drawn from, beside every tool's view. */
export interface FoldVertexWindowView {
  tool: FoldVertexToolId;
  /** How a swivel is constructed: by its edge onto a line, or by its valley and mountain. */
  swivelInput?: FoldSwivelInput;
  /** A squash's hinge: the folded edge, or a line drawn. */
  squashHinge?: FoldSquashHinge;
  /**
   * The line taken first is: a swivel by its valley and mountain's valley,
   * its picks then locating the mountain; a squash's drawn hinge, its pick
   * then the flap's end.
   */
  lineTaken?: boolean;
  /** The picks have located that line: it can be taken. */
  lineLocated?: boolean;
  direction: FoldDirection;
  /** The engine has described the flap, line or fan the clicks name: there is something to choose about. */
  described: boolean;
  /** The step is built from that description and the choices made: there is something to commit. */
  known: boolean;
  /** A squash's spine lands on its hinge line, or toward a point clicked. */
  target: 'hinge' | 'point';
  /**
   * A rabbit ear's fourth creases that land — a swivel's ridges that land —
   * the only ones offered, numbered among themselves, and the position of
   * the one taken among them.
   */
  fourths: number;
  fourth: number;
  /** With none that lands: whether one would with other paper staying; null while that is asked. */
  fourthElsewhere?: boolean | null;
  /** The layers at a rabbit ear's center, and how many it cuts (null for every one). */
  layers: number;
  fanLayers: number | null;
  /** How many layer orders the step leaves (0 with no choice), and the one taken. */
  orders: number;
  order: number;
  /** A `use_emergent` fix's number on screen, by its direction. */
  emergentNumber?: (direction: FoldModelPoint) => number | null;
  /** How a petal fold's hinge, or a swivel's target, is named: by a crease, or by two points. */
  lineBy?: FoldLineBy;
  /** A swivel's ridge taken, by name; null before the engine has described it. */
  ridge?: FoldSwivelRidge | null;
  /**
   * A swivel whose pivot was clicked on a folded edge: its creases meet on
   * that edge (`FoldSwivelOnFoldOp`), and it has no ridge to choose.
   */
  onFold?: boolean;
  /**
   * Valley, then mountain: whether the fold lands that way, once known (a
   * swivel's, of the kind it folds). A way that does not is not offered.
   * Absent when unknown.
   */
  directions?: readonly boolean[];
  /** A swivel on a folded edge's kind as it folds: the folder's, always. */
  swivelKind?: FoldSwivelKind;
  /** The kinds a swivel on a folded edge lands one way or the other, once known: the others are offered disabled. */
  swivelKinds?: readonly FoldSwivelKind[];
  /** What a petal fold creases itself, once the engine has described its flap. */
  petalScores?: FoldPetalScores | null;
  /** A swivel's meeting point from which no edge can swing: its next click picks another point. */
  nothingSwings?: boolean;
}

/** The vertex folds' own calls in the window; the canvas binds them. */
export interface FoldVertexWindowVerbs {
  setSwivelInput?: (mode: FoldSwivelInput) => void;
  /** A squash's hinge: the folded edge, or a line drawn. */
  setSquashHinge?: (hinge: FoldSquashHinge) => void;
  setVertexDirection?: (direction: FoldDirection) => void;
  /** A swivel on a folded edge's kind: its strip on top, or tucked between the layers. */
  setSwivelKind?: (kind: FoldSwivelKind) => void;
  stepEmergent?: (delta: number) => void;
  stepFanLayers?: (delta: number) => void;
  /** Name a petal fold's hinge, or a swivel's target, by a crease or by two points. */
  setVertexLineBy?: (lineBy: FoldLineBy) => void;
}

/** A vertex fold's own controls in the window. */
export interface FoldVertexControls {
  input?: FoldKindChoice<FoldSwivelInput> | null;
  /** A squash's hinge, the folded edge or a line drawn; null for the other folds. */
  hinge?: FoldKindChoice<FoldSquashHinge> | null;
  /**
   * A swivel on a folded edge's kind, Open or Inside: only once previewed
   * and only when both land — a control with no choice in it is not shown —
   * the one that lands taken otherwise. Null for the other folds.
   */
  kind: FoldKindChoice<FoldSwivelKind> | null;
  /**
   * Valley or Mountain. Null for a swivel while its clicks are made, and
   * once previewed unless it lands both ways: it folds the way that lands.
   */
  direction: {
    label: string;
    value: FoldDirection;
    /** An option `disabled` does not land that way: offered, but not taken, its tooltip saying why. */
    options: readonly { value: FoldDirection; label: string; tooltip: string; disabled?: boolean }[];
    disabled: boolean;
    set: (direction: FoldDirection) => void;
  } | null;
  /**
   * How a petal fold's hinge is named — a hinge crease, or two endpoints —
   * or a swivel's target: a crease or edge, or two points. Null for the
   * other folds.
   */
  lineBy: FoldKindChoice<FoldLineBy> | null;
  /** A squash's spine target; null for every other fold, and before the flap is clicked. */
  target: {
    label: string;
    /** "The hinge line", or "The point clicked". */
    value: string;
    reset: { label: string; disabled: boolean; run: () => void } | null;
  } | null;
  /** A swivel's ridge selector; null for rabbit ears and the other tools. */
  emergent: FoldChoiceStepper | null;
  /** Status of the rabbit ear's selected hinge region; null for other folds. */
  emergentNote: string | null;
  /** The layers a rabbit ear cuts, when more than one lies at its center. */
  layers: FoldChoiceStepper | null;
  order: FoldChoiceStepper | null;
  /**
   * What the fold needs of the paper, or what it will do, said under the
   * direction: a squash's and a rabbit ear's precondition; a petal fold's
   * creases it makes itself, and a swivel's vertex, once previewed. Null for
   * a fold whose window says it above its steps instead (`vertexIntro`).
   */
  note: string | null;
}

/** Whether a vertex fold has any choice to show beside its direction. */
export function hasVertexChoices(controls: FoldVertexControls): boolean {
  return Boolean(controls.target || controls.emergent || controls.emergentNote || controls.layers || controls.order);
}

/**
 * What the fold needs of the paper (research §5.3: its preconditions are
 * what stop it), said under its direction; null for the petal fold and the
 * swivel, whose windows say it above their steps (`vertexIntro`), before the
 * first click it governs.
 */
function preconditionNote(t: TFunction, tool: FoldVertexToolId): string | null {
  switch (tool) {
    case 'squash':
      return t(
        'tools:fold.vertex.note.squashFlap',
        'A flap squashes when its two layers are joined only at its hinge and nothing lies on top of it.'
      );
    case 'rabbit-ear':
      return t(
        'tools:fold.vertex.note.rabbitEarMeet',
        'The creases meet at the triangle’s incenter: one to each corner, and a fourth the ear stands up along.'
      );
    case 'petal':
    case 'swivel':
      return null;
  }
}

/** What a petal fold creases itself as it lifts the flap (owner feedback, 2026-10-12), from the engine's description. */
function petalScoresNote(t: TFunction, scores: FoldPetalScores): string {
  const { hinge, kites } = scores;
  if (hinge && kites >= 2) {
    return t(
      'tools:fold.vertex.note.petalCreasesAll',
      'The fold creases the hinge through the top layer and both kite creases through the top two layers as the flap lifts.'
    );
  }
  if (hinge && kites === 1) {
    return t(
      'tools:fold.vertex.note.petalCreasesHingeKite',
      'The fold creases the hinge through the top layer and one kite crease through the top two layers as the flap lifts. The other kite crease is there already.'
    );
  }
  if (hinge) {
    return t(
      'tools:fold.vertex.note.petalCreasesHinge',
      'The fold creases the hinge through the top layer as the flap lifts. The kite creases are there already.'
    );
  }
  if (kites >= 2) {
    return t(
      'tools:fold.vertex.note.petalCreasesKites',
      'The fold creases both kite creases through the top two layers as the flap lifts. The hinge is there already.'
    );
  }
  if (kites === 1) {
    return t(
      'tools:fold.vertex.note.petalCreasesKite',
      'The fold creases one kite crease through the top two layers as the flap lifts. The hinge and the other kite crease are there already.'
    );
  }
  return t(
    'tools:fold.vertex.note.petalRefolds',
    'Every crease it folds is there already: it refolds the hinge and the kite creases.'
  );
}

/**
 * What the petal fold and the swivel are, in a line above their steps: what
 * a first-time folder could not otherwise know before the first click (owner
 * feedback, 2026-10-11) — and no more (2026-10-12: a paragraph above the
 * steps went unread). Null for the others.
 */
function vertexIntro(t: TFunction, tool: FoldVertexToolId): string | null {
  switch (tool) {
    case 'petal':
      return t('tools:fold.vertex.intro.petalLift', 'Lifts a flap’s point up along a hinge.');
    case 'swivel':
      return t('tools:fold.vertex.intro.swivelSwing', 'Swings an edge of the paper onto a line.');
    case 'squash':
    case 'rabbit-ear':
      return null;
  }
}

/**
 * The notes under the steps: what a click on a point snaps to, while one is
 * asked for — a rabbit ear's corners, a petal fold's hinge by its ends — and
 * the key that clears the picks. Never what a step already says (owner
 * feedback, 2026-10-12): the canvas lights what each click can take.
 */
function locateNotes(t: TFunction, view: FoldToolWindowView, vertex: FoldVertexWindowView, host: FoldToolHost): string[] {
  const { tool } = vertex;
  const clear = host.coarse ? [] : [t('tools:fold.note.clear', 'Esc clears the picks.')];
  const points = tool === 'rabbit-ear' ? view.picks < 3 : tool === 'petal' && vertex.lineBy === 'points' && view.picks < 2;
  if (!points) return clear;
  return [
    host.coarse
      ? t('tools:fold.vertex.note.snapOrFreeTouch', 'Points snap to corners, crossings, marks and midpoints: turn on Free point to put one anywhere.')
      : t('tools:fold.vertex.note.snapOrFree', 'Points snap to corners, crossings, marks and midpoints: hold {{modifier}} to put one anywhere.', {
          modifier: host.alt,
        }),
    ...clear,
  ];
}

/** The commit, as a step: Enter, or on a finger the fold's button. */
function commitStepPlain(t: TFunction, tool: FoldVertexToolId, host: FoldToolHost): string {
  const action = foldToolLabel(t, tool);
  return host.coarse
    ? t('tools:fold.steps.commitTouch', 'Tap {{action}} to fold.', { action })
    : t('tools:fold.steps.commit', 'Press Enter to fold.');
}

/** The last step while the clicks are made: what comes after them. */
function finishStep(t: TFunction, tool: FoldVertexToolId, host: FoldToolHost): string {
  const action = foldToolLabel(t, tool);
  switch (tool) {
    case 'petal':
      return host.coarse
        ? t('tools:fold.vertex.steps.petalFinishTouch', 'Choose Valley or Mountain, then tap {{action}}.', { action })
        : t('tools:fold.vertex.steps.petalFinish', 'Choose Valley or Mountain, then press Enter.');
    case 'rabbit-ear':
      return host.coarse
        ? t('tools:fold.vertex.steps.earFinishTouch', 'Tap {{action}} to fold.', { action })
        : t('tools:fold.vertex.steps.earFinish', 'Press Enter to fold.');
    // A swivel's ridge and way are offered only when there is a choice, once it is previewed.
    case 'swivel':
    case 'squash':
      return commitStepPlain(t, tool, host);
  }
}

/** Whether the vertex tool in hand is a swivel by its valley and mountain. */
function isValleyMountain(vertex: FoldVertexWindowView): boolean {
  return vertex.tool === 'swivel' && vertex.swivelInput === 'valley-mountain';
}

/** Whether the vertex tool in hand is a squash whose drawn hinge is still being located. */
function isLocatingHinge(vertex: FoldVertexWindowView): boolean {
  return vertex.tool === 'squash' && vertex.squashHinge === 'line' && vertex.lineTaken !== true;
}

/**
 * A squash's drawn hinge, located with the line modes as a swivel's valley
 * is: the line mode's clicks, then Enter takes it, and the flap's end is
 * clicked after.
 */
function hingeLineInstructions(t: TFunction, view: FoldToolWindowView, host: FoldToolHost): FoldToolInstructions {
  const take = host.coarse
    ? t('tools:fold.vertex.squashHinge.takeTouch', 'Tap Use as the hinge.')
    : t('tools:fold.vertex.squashHinge.take', 'Press Enter to take it as the hinge.');
  const items = [...lineModeSteps(t, view.lineMode, host.coarse), take];
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    intro: t('tools:fold.vertex.squashHinge.intro', 'Draw the hinge across the flap’s folded edge. Only the end beyond it squashes.'),
    items,
    current: Math.min(view.picks, items.length - 1),
    notes: lineModeNotes(t, view.lineMode, host, view.freeLineSnap),
  };
}

/** A squash's Hinge control: the folded edge it infers, or a line drawn. Both are always offered. */
function squashHingeControl(
  t: TFunction,
  vertex: FoldVertexWindowView,
  verbs: FoldToolWindowVerbs,
  readOnly: boolean
): FoldKindChoice<FoldSquashHinge> | null {
  if (vertex.tool !== 'squash') return null;
  return {
    label: t('tools:fold.vertex.squashHinge.label', 'Hinge'),
    value: vertex.squashHinge ?? 'folded',
    options: [
      {
        value: 'folded',
        short: t('tools:fold.vertex.squashHinge.folded', 'Folded edge'),
        label: t('tools:fold.vertex.squashHinge.foldedHelp', 'The fold the flap’s lower layer turns over: the whole flap squashes'),
        disabled: false,
        reason: null,
      },
      {
        value: 'line',
        short: t('tools:fold.vertex.squashHinge.line', 'Line'),
        label: t('tools:fold.vertex.squashHinge.lineHelp', 'A line you draw: only the flap’s end beyond it squashes'),
        disabled: false,
        reason: null,
      },
    ],
    disabled: readOnly || !verbs.setSquashHinge,
    note: null,
    set: (hinge) => verbs.setSquashHinge?.(hinge),
  };
}

/**
 * A swivel by its valley and mountain's steps: its valley, then its
 * mountain, each the line mode's own clicks named by the line they locate
 * (as a pleat's are), and what comes after — Enter takes the valley, then
 * Enter folds. On the layer that faces the viewer, so the intro says so.
 */
function valleyMountainInstructions(
  t: TFunction,
  view: FoldToolWindowView,
  vertex: FoldVertexWindowView,
  host: FoldToolHost,
  commit: string
): FoldToolInstructions {
  const valley = !vertex.lineTaken;
  const clicks = lineModeSteps(t, view.lineMode, host.coarse).map((instruction) =>
    valley
      ? t('tools:fold.vertex.valleyMountain.valleyStep', 'Valley line: {{instruction}}', { instruction })
      : t('tools:fold.vertex.valleyMountain.mountainStep', 'Mountain line: {{instruction}}', { instruction })
  );
  const take = host.coarse
    ? t('tools:fold.vertex.valleyMountain.takeValleyTouch', 'Tap Use as the valley.')
    : t('tools:fold.vertex.valleyMountain.takeValley', 'Press Enter to take it as the valley.');
  const items = [...clicks, valley ? take : commit];
  const inside = vertex.swivelKind === 'inside';
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    intro: valley
      ? inside
        ? t(
            'tools:fold.vertex.valleyMountain.pickValleyInside',
            'Pick the valley line: on the layer you see, from a point on a folded edge into the paper.'
          )
        : t(
            'tools:fold.vertex.valleyMountain.pickValley',
            'Pick the valley line: the flap’s hinge, on the layer you see, from a point on a folded edge into the paper.'
          )
      : t(
          'tools:fold.vertex.valleyMountain.pickMountain',
          'Pick the mountain line, from the same point on the folded edge. The crease on the layer behind follows, dotted where it is hidden.'
        ),
    items,
    current: Math.min(view.picks, items.length - 1),
    notes: lineModeNotes(t, view.lineMode, host, view.freeLineSnap),
  };
}

function locateInstructions(
  t: TFunction,
  view: FoldToolWindowView,
  vertex: FoldVertexWindowView,
  host: FoldToolHost
): FoldToolInstructions {
  const { tool } = vertex;
  if (isValleyMountain(vertex)) return valleyMountainInstructions(t, view, vertex, host, commitStepPlain(t, 'swivel', host));
  if (isLocatingHinge(vertex)) return hingeLineInstructions(t, view, host);
  const lines = {
    petalHinge: vertex.lineBy ?? 'crease',
    swivelTarget: vertex.lineBy ?? 'crease',
    swivelInput: vertex.swivelInput,
    ...(vertex.squashHinge ? { squashHinge: vertex.squashHinge } : {}),
  };
  const items = [...vertexToolSteps(t, tool, lines, host, vertex.nothingSwings === true), finishStep(t, tool, host)];
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    intro: vertexIntro(t, tool),
    items,
    current: Math.min(Math.max(0, view.picks), items.length - 1),
    notes: locateNotes(t, view, vertex, host),
  };
}

/** What is left to choose once every click is in (a swivel keeps its steps instead: `swivelPreviewSteps`). */
function chooseStep(t: TFunction, tool: Exclude<FoldVertexToolId, 'swivel'>, host: FoldToolHost): string {
  switch (tool) {
    case 'squash':
      // Where the spine lands, as the folded pane draws it: the bold line.
      return host.coarse
        ? t('tools:fold.vertex.steps.squashSpineTouch', 'The spine lands on the bold line: tap the paper to land it elsewhere.')
        : t('tools:fold.vertex.steps.squashSpine', 'The spine lands on the bold line: click the paper to land it elsewhere.');
    case 'petal':
      // Another flap below the hinge is picked by a click on it.
      return host.coarse
        ? t('tools:fold.vertex.steps.petalWayTouch', 'Choose which way it lifts, or tap another flap to lift that one.')
        : t('tools:fold.vertex.steps.petalWay', 'Choose which way it lifts, or click another flap to lift that one.');
    case 'rabbit-ear':
      // The hinge region is picked again by clicking another region.
      return host.coarse
        ? t('tools:fold.vertex.steps.earChooseTouch', 'Choose the layers, or tap another region for the hinge crease.')
        : t('tools:fold.vertex.steps.earChoose', 'Choose the layers, or click another region for the hinge crease.');
  }
}

/**
 * The commit, in a window with buttons in it: a stepper pressed last keeps
 * the focus, and Enter would press it again, so the button is named too.
 */
function commitStep(t: TFunction, tool: FoldVertexToolId, host: FoldToolHost): string {
  const action = foldToolLabel(t, tool);
  return host.coarse
    ? t('tools:fold.steps.commitTouch', 'Tap {{action}} to fold.', { action })
    : t('tools:fold.steps.commitOrClick', 'Press Enter, or click {{action}}, to fold.', { action });
}

/**
 * A swivel's steps once every click is in: the same steps, its last in hand
 * — a press of Enter, or of the button when a ridge or a way to choose sits
 * above it and may hold the focus.
 */
function swivelPreviewSteps(
  t: TFunction,
  vertex: FoldVertexWindowView,
  host: FoldToolHost,
  controls: FoldVertexControls
): FoldToolInstructions {
  const lines = { petalHinge: 'crease' as const, swivelTarget: vertex.lineBy ?? 'crease', swivelInput: vertex.swivelInput };
  const choice =
    controls.kind !== null || controls.direction !== null || controls.emergent !== null || controls.order !== null;
  const items = [
    ...vertexToolSteps(t, 'swivel', lines, host),
    choice ? commitStep(t, 'swivel', host) : commitStepPlain(t, 'swivel', host),
  ];
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    intro: vertexIntro(t, 'swivel'),
    items,
    current: items.length - 1,
    notes: [],
  };
}

function previewInstructions(
  t: TFunction,
  vertex: FoldVertexWindowView,
  host: FoldToolHost,
  view: FoldToolWindowView,
  fixes: boolean,
  controls: FoldVertexControls
): FoldToolInstructions {
  const { tool } = vertex;
  if (!vertex.described && view.preview?.refused) {
    // Refused before anything was described: nothing to choose, only to pick
    // again — or to take a fix the notice offers.
    const again = fixes
      ? host.coarse
        ? t('tools:fold.vertex.steps.fixOrPickAgainTouch', 'Tap a fix below, or tap Cancel and pick again.')
        : t('tools:fold.vertex.steps.fixOrPickAgain', 'Click a fix below, or press Esc and pick again.')
      : host.coarse
        ? t('tools:fold.vertex.steps.pickAgainReadTouch', 'Tap Cancel and pick again: the notice below says what to change.')
        : t('tools:fold.vertex.steps.pickAgainRead', 'Press Esc and pick again: the notice below says what to change.');
    return {
      heading: t('tools:fold.window.instructions', 'Instructions'),
      items: [again],
      current: 0,
      notes: [],
    };
  }
  const queued = view.preview ? queuedNote(t, view.preview) : [];
  if (isValleyMountain(vertex)) {
    // The kind or the order to choose sits above the button, which may hold the focus.
    const choice = controls.kind !== null || controls.order !== null;
    const steps = valleyMountainInstructions(t, view, vertex, host, choice ? commitStep(t, 'swivel', host) : commitStepPlain(t, 'swivel', host));
    return { ...steps, current: steps.items.length - 1, notes: [...steps.notes, ...queued] };
  }
  if (tool === 'swivel') {
    const steps = swivelPreviewSteps(t, vertex, host, controls);
    return { ...steps, notes: queued };
  }
  return {
    heading: t('tools:fold.window.instructions', 'Instructions'),
    items: [chooseStep(t, tool, host), commitStep(t, tool, host)],
    // The choices are optional, so the window leads with them and never marks them done.
    current: 0,
    notes: queued,
  };
}

/** A swivel's two available ridges, named by where they point. */
function fourthStepper(
  t: TFunction,
  vertex: FoldVertexWindowView,
  verbs: FoldToolWindowVerbs,
  readOnly: boolean
): FoldChoiceStepper | null {
  return choiceStepper(t, t('tools:fold.vertex.ridge', 'Ridge'), vertex.fourth, vertex.fourths,
    verbs.stepEmergent, readOnly, vertex.ridge ? swivelRidgeName(t, vertex.ridge) : undefined);

}

/** Whether the selected hinge region can fold with the current layers. */
function emergentNote(t: TFunction, vertex: FoldVertexWindowView, host: FoldToolHost): string {
  if (vertex.fourths > 0) return t('tools:fold.vertex.hingeRegionFits', 'The hinge crease lies in the selected region.');
  return host.coarse
    ? t('tools:fold.vertex.hingeRegionBlockedTouch', 'This hinge region cannot fold with these layers. Tap another region or change the layers.')
    : t('tools:fold.vertex.hingeRegionBlocked', 'This hinge region cannot fold with these layers. Click another region or change the layers.');
}

/** The layers stepper's value: every layer, or the first few from the direction's side. */
function layersValue(t: TFunction, vertex: FoldVertexWindowView): string {
  const { layers, fanLayers, direction } = vertex;
  if (fanLayers === null || fanLayers >= layers) return t('tools:fold.vertex.layersAll', 'All {{count}}', { count: layers });
  return direction === 'valley'
    ? t('tools:fold.vertex.layersTop', 'Top {{count}} of {{total}}', { count: fanLayers, total: layers })
    : t('tools:fold.vertex.layersBottom', 'Bottom {{count}} of {{total}}', { count: fanLayers, total: layers });
}

/**
 * How a petal fold's hinge, or a swivel's target, is named: a segmented
 * control of two, each saying in its tooltip what is clicked. Null for the
 * other folds.
 */
function lineByControl(
  t: TFunction,
  vertex: FoldVertexWindowView,
  verbs: FoldToolWindowVerbs,
  readOnly: boolean
): FoldKindChoice<FoldLineBy> | null {
  const { tool } = vertex;
  if ((tool !== 'petal' && tool !== 'swivel') || isValleyMountain(vertex)) return null;
  const option = (value: FoldLineBy) => {
    const petal = tool === 'petal';
    const short =
      value === 'crease'
        ? petal
          ? t('tools:fold.vertex.lineBy.hingeCrease', 'Hinge crease')
          : t('tools:fold.vertex.lineBy.creaseOrEdge', 'Crease or edge')
        : petal
          ? t('tools:fold.vertex.lineBy.twoEndpoints', 'Two endpoints')
          : t('tools:fold.vertex.lineBy.twoPoints', 'Two points');
    const label =
      value === 'crease'
        ? petal
          ? t('tools:fold.vertex.lineBy.hingeCreaseHelp', 'Click a precrease already across the flap')
          : t('tools:fold.vertex.lineBy.creaseOrEdgeHelp', 'Click a crease or an edge already there')
        : petal
          ? t('tools:fold.vertex.lineBy.twoEndpointsHelp', 'Click the hinge’s two ends: the fold creases it')
          : t('tools:fold.vertex.lineBy.twoPointsHelp', 'Click two points on the line');
    return { value, short, label, disabled: false, reason: null };
  };
  return {
    label: tool === 'petal' ? t('tools:fold.vertex.lineBy.hinge', 'Hinge') : t('tools:fold.vertex.lineBy.target', 'Lands on'),
    value: vertex.lineBy ?? 'crease',
    options: FOLD_LINE_BY.map(option),
    disabled: readOnly || !verbs.setVertexLineBy,
    note: null,
    set: (lineBy) => verbs.setVertexLineBy?.(lineBy),
  };
}

/**
 * What the fold will do, said under the direction while it is previewed: a
 * petal fold's creases; a swivel's picture, read in a line — the dot, the
 * bold line, the lit paper the folded pane draws.
 */
function previewNote(t: TFunction, vertex: FoldVertexWindowView): string | null {
  if (vertex.tool === 'petal') return vertex.petalScores ? petalScoresNote(t, vertex.petalScores) : null;
  if (isValleyMountain(vertex)) {
    return vertex.described
      ? t(
          'tools:fold.vertex.note.swivelValleyMountainPicture',
          'The creases meet at the dot. The dotted crease is on the layer behind, and follows from the valley and the mountain; the lit paper moves.'
        )
      : null;
  }
  if (vertex.tool === 'swivel') {
    return vertex.described
      ? t('tools:fold.vertex.note.swivelPicture', 'The creases meet at the dot, the edge lands on the bold line, and the lit paper moves.')
      : null;
  }
  return preconditionNote(t, vertex.tool);
}

/**
 * Whether a vertex fold offers its direction: always, but a swivel by its
 * edge — whose clicks are offered only what lands some way — only once the
 * engine has described it, and then when the other way lands, with the way
 * asked or in its place (it folds the way asked, and is refused when that
 * does not land: the control then offers the way that does), or which ways
 * land is not known (a target named by two points). A swivel by its valley and
 * mountain never: its letters are the viewer's. Owner feedback, 2026-10-12:
 * a control with no choice in it is not shown.
 */
function offersDirection(vertex: FoldVertexWindowView, clicked: boolean): boolean {
  if (vertex.tool !== 'swivel') return true;
  if (isValleyMountain(vertex) || !clicked || !vertex.described) return false;
  const ways = vertex.directions;
  if (!ways || ways.length !== 2) return true;
  // A choice only when the other way lands: with the way asked too, or in its place.
  const asked = vertex.direction === 'valley' ? 0 : 1;
  return ways[1 - asked] === true;
}

/**
 * A swivel on a folded edge's kind, Open or Inside, each saying in its
 * tooltip where the strip goes: once it is previewed, when the other kind
 * lands too or the one asked does not — a kind that does not land offered
 * disabled, its tooltip saying why (owner feedback, 2026-10-12: offer only
 * what lands, and no control without a choice in it). Null otherwise: it
 * folds the kind asked, which its step and its picture name.
 */
function swivelKindControl(
  t: TFunction,
  vertex: FoldVertexWindowView,
  verbs: FoldToolWindowVerbs,
  readOnly: boolean,
  located: boolean
): FoldKindChoice<FoldSwivelKind> | null {
  if (vertex.tool !== 'swivel' || !vertex.onFold) return null;
  // By its valley and mountain, the kind is part of what the folder asks for,
  // as a diagram names it: offered from the first pick, and still offered
  // when the kind asked is refused before the engine could say which land.
  const asking = vertex.swivelInput === 'valley-mountain';
  const kinds = located ? (vertex.swivelKinds ?? null) : null;
  if (!asking && !kinds) return null;
  const asked = vertex.swivelKind ?? 'open';
  const other: FoldSwivelKind = asked === 'open' ? 'inside' : 'open';
  // No choice in it: only the kind asked lands, or none does.
  if (!asking && !kinds?.includes(other)) return null;
  const lands = (kind: FoldSwivelKind) => !kinds || kinds.includes(kind);
  const cannot = t('tools:fold.vertex.swivelKindCannot', 'This kind cannot fold flat here.');
  return {
    label: t('tools:fold.vertex.swivelKind', 'Kind'),
    value: asked,
    options: FOLD_SWIVEL_KINDS.map((value) => ({
      value,
      short:
        value === 'open' ? t('tools:fold.vertex.swivelOpen', 'Open') : t('tools:fold.vertex.swivelInside', 'Inside'),
      label:
        value === 'open'
          ? t('tools:fold.vertex.swivelOpenHelp', 'Open swivel: the strip folds up on top')
          : t('tools:fold.vertex.swivelInsideHelp', 'Inside swivel: the strip tucks between the layers'),
      disabled: !lands(value),
      reason: lands(value) ? null : cannot,
    })),
    disabled: readOnly || !verbs.setSwivelKind,
    note: null,
    set: (kind) => verbs.setSwivelKind?.(kind),
  };
}

/**
 * A vertex fold's controls (see the module docs). `located` once every click
 * is in: its choices are offered once the engine has described what the
 * clicks name, never about a flap it refused.
 */
export function vertexControls(
  t: TFunction,
  vertex: FoldVertexWindowView,
  verbs: FoldToolWindowVerbs,
  readOnly: boolean,
  host: FoldToolHost,
  clicked: boolean
): FoldVertexControls {
  const { tool } = vertex;
  const located = clicked && vertex.described;
  // Only swivels offer a ridge selector, and only when both ridges land.
  const ear = tool === 'rabbit-ear';
  const ridges = tool === 'swivel' && !vertex.onFold && vertex.fourths >= 2;
  const { setVertexDirection, resetSquashTarget } = verbs;
  // A way the engine says does not land is offered, but not taken.
  const lands = (k: number) => !located || vertex.directions?.[k] !== false;
  const cannot = t('tools:fold.vertex.directionCannot', 'This way it cannot fold flat here.');
  return {
    input: tool === 'swivel' ? {
      label: t('tools:fold.vertex.input.label', 'Construct by'),
      value: vertex.swivelInput ?? 'edge',
      options: [
        { value: 'edge', short: t('tools:fold.vertex.input.edge', 'Edge onto line'), label: t('tools:fold.vertex.input.edgeHelp', 'Choose an edge and the line it should land on'), disabled: false, reason: null },
        {
          value: 'valley-mountain',
          short: t('tools:fold.vertex.input.valleyMountain', 'Valley and mountain'),
          label: t(
            'tools:fold.vertex.input.valleyMountainHelp',
            'Pick the valley and the mountain on the layer you see, meeting on a folded edge; the crease behind follows'
          ),
          disabled: false,
          reason: null,
        },
      ],
      disabled: readOnly || !verbs.setSwivelInput,
      note: null,
      set: mode => verbs.setSwivelInput?.(mode),
    } : null,
    hinge: squashHingeControl(t, vertex, verbs, readOnly),
    kind: swivelKindControl(t, vertex, verbs, readOnly, located),
    direction: offersDirection(vertex, clicked)
      ? {
          label: t('tools:fold.vertex.direction', 'Direction'),
          value: vertex.direction,
          options: [
            {
              value: 'valley',
              label: t('tools:fold.vertex.valley', 'Valley'),
              tooltip: lands(0) ? t('tools:fold.vertex.valleyTitle', 'Valley: the paper turns toward you') : cannot,
              ...(lands(0) ? {} : { disabled: true }),
            },
            {
              value: 'mountain',
              label: t('tools:fold.vertex.mountain', 'Mountain'),
              tooltip: lands(1) ? t('tools:fold.vertex.mountainTitle', 'Mountain: the paper turns away from you') : cannot,
              ...(lands(1) ? {} : { disabled: true }),
            },
          ],
          disabled: readOnly || !setVertexDirection,
          set: (direction) => setVertexDirection?.(direction),
        }
      : null,
    lineBy: lineByControl(t, vertex, verbs, readOnly),
    // Where a squash's spine lands: the bold line on the folded pane, moved by a click there.
    target:
      tool === 'squash' && located
        ? {
            label: t('tools:fold.vertex.target', 'Spine lands on'),
            value:
              vertex.target === 'hinge'
                ? t('tools:fold.vertex.targetHinge', 'The hinge line')
                : t('tools:fold.vertex.targetPoint', 'The point clicked'),
            reset:
              vertex.target === 'point' && resetSquashTarget
                ? { label: t('tools:fold.vertex.reset', 'Back to the hinge'), disabled: readOnly, run: resetSquashTarget }
                : null,
          }
        : null,
    emergent: ridges && located ? fourthStepper(t, vertex, verbs, readOnly) : null,
    emergentNote: ear && located ? emergentNote(t, vertex, host) : null,
    // A rabbit ear's layers; a swivel by its edge folds every layer at its vertex.
    layers:
      tool === 'rabbit-ear' && located
        ? choiceStepper(
            t,
            t('tools:fold.vertex.layers', 'Layers'),
            (vertex.fanLayers ?? vertex.layers) - 1,
            vertex.layers,
            verbs.stepFanLayers,
            readOnly,
            layersValue(t, vertex)
          )
        : null,
    order: located
      ? choiceStepper(t, t('tools:fold.reverse.order', 'Layer order'), vertex.order, vertex.orders, verbs.stepOrder, readOnly)
      : null,
    note: clicked ? previewNote(t, vertex) : preconditionNote(t, tool),
  };
}

/** A vertex tool's window: its clicks, then previewing the fold (see the module docs). */
export function vertexToolWindow(
  t: TFunction,
  view: FoldToolWindowView,
  vertex: FoldVertexWindowView,
  verbs: FoldToolWindowVerbs,
  host: FoldToolHost
): FoldToolWindowModel {
  const readOnly = view.readOnly !== null;
  const { tool } = vertex;
  const title = foldToolLabel(t, tool);
  const { preview } = view;
  // A swivel by its valley and mountain locates its lines with the line
  // modes, the select named by the line it locates now.
  const valleyMountain = isValleyMountain(vertex);
  const locatingValley = valleyMountain && !vertex.lineTaken;
  // So does a squash its drawn hinge, until it is taken.
  const locatingHinge = isLocatingHinge(vertex);
  const lineMode = valleyMountain
    ? {
        ...lineModeSelect(t, view, verbs),
        label: locatingValley
          ? t('tools:fold.vertex.valleyMountain.valleyLine', 'Valley line')
          : t('tools:fold.vertex.valleyMountain.mountainLine', 'Mountain line'),
      }
    : locatingHinge
      ? { ...lineModeSelect(t, view, verbs), label: t('tools:fold.vertex.squashHinge.lineMode', 'Hinge line') }
      : null;
  const swivelForm = valleyMountain ? ('valley-mountain' as const) : vertex.onFold ? ('fold' as const) : ('edge' as const);
  if (!preview || locatingValley || locatingHinge) {
    const controls = vertexControls(t, vertex, verbs, readOnly, host, false);
    return {
      phase: 'locate',
      title,
      meta: settingsMeta(t, [controls.direction, controls.lineBy, controls.input, controls.hinge, lineMode].filter(Boolean).length),
      instructions: locateInstructions(t, view, vertex, host),
      lineMode,
      kind: null,
      movingSide: null,
      layers: null,
      refusal: preview?.refused ? foldRefusalNotice(t, preview.refused, {
        kind: 'vertex', readOnly, ...sectionFlapNames(null), vertex: { tool, ...(tool === 'swivel' ? { swivel: swivelForm } : {}) },
      }, verbs) : null,
      divide: null,
      vertex: controls,
      // The valley, or the hinge, is taken with Enter, or this button, once a line is located.
      footer: locatingValley || locatingHinge ? {
        cancel: { label: t('tools:fold.window.cancel', 'Cancel'), shortcut: 'viewport.cancel', disabled: false, run: verbs.cancel },
        commit: {
          label: locatingHinge
            ? t('tools:fold.vertex.squashHinge.use', 'Use as the hinge')
            : t('tools:fold.vertex.valleyMountain.useValley', 'Use as the valley'),
          shortcut: 'fold.commit',
          disabled: readOnly || !vertex.lineLocated || preview?.refused != null,
          run: verbs.commit,
        },
      } : null,
    };
  }
  const controls = vertexControls(t, vertex, verbs, readOnly, host, true);
  const settings = [
    controls.kind,
    controls.direction,
    controls.lineBy,
    controls.input,
    controls.hinge,
    controls.target,
    controls.emergent,
    controls.layers,
    controls.order,
  ];
  const refusal = preview.refused
    ? foldRefusalNotice(
        t,
        preview.refused,
        {
          kind: 'vertex',
          readOnly,
          // A vertex fold shows no section: no chips number its flaps.
          ...sectionFlapNames(null),
          vertex: {
            tool,
            ...(vertex.emergentNumber ? { emergentNumber: vertex.emergentNumber } : {}),
            ...(tool === 'petal' && vertex.lineBy ? { hinge: vertex.lineBy } : {}),
            // The tool makes a swivel by its edge, at a pivot or on a folded edge, or by its valley and mountain.
            ...(tool === 'swivel' ? { swivel: swivelForm } : {}),
          },
        },
        verbs
      )
    : null;
  return {
    phase: 'preview',
    title,
    meta: settingsMeta(t, [...settings, lineMode].filter(Boolean).length),
    instructions: previewInstructions(t, vertex, host, view, (refusal?.actions.length ?? 0) > 0, controls),
    lineMode,
    kind: null,
    movingSide: null,
    layers: null,
    refusal,
    divide: null,
    vertex: controls,
    footer: {
      cancel: {
        label: t('tools:fold.window.cancel', 'Cancel'),
        shortcut: 'viewport.cancel',
        disabled: false,
        run: verbs.cancel,
      },
      commit: {
        label: title,
        shortcut: 'fold.commit',
        disabled: readOnly || !vertex.known || preview.landing || preview.refused !== null,
        run: verbs.commit,
      },
    },
  };
}
