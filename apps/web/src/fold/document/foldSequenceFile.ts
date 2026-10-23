/**
 * Fold sequences as the project file stores them (`workspace.foldSequences`),
 * read leniently and written back exactly (plan D6, D7).
 *
 * The file's three rules (`lib/documentFile`) hold per sequence — a sequence
 * is a document with its own `formatVersion`, so a newer one opens read-only
 * on its own and is written back as it came — and a tree adds its own:
 *
 * - **A node with a malformed structure is dropped with its subtree.** An id
 *   that is not a non-empty string, or a parent that is neither `null` nor
 *   one, leaves nothing to hang the node on; its children become orphans.
 * - **A node with a malformed or unknown op is kept verbatim and locked.**
 *   Dropping it would silently take its subtree with it, so in a tree damage
 *   to an op is carried like a newer build's op: written back unchanged, and
 *   locking itself and everything below it. So is a node with choices that do
 *   not read, or a key this build does not know: either can change what the
 *   step folds.
 * - **The first of two nodes with one id wins**, as everywhere in the file
 *   (`readEntries`). The later node's children then hang on the first.
 * - **Orphans and cycles are dropped**: only nodes whose path reaches the
 *   sheet are kept, in their order in the file.
 * - **Unknown sequence-level keys are carried verbatim.** Unlike the
 *   Diagram's document fields, they do not open the sequence read-only: the
 *   steps hold everything that decides a state, and the paper — the one
 *   sequence-level field that does — opens it read-only when a newer build
 *   wrote it ({@link newerPaperField}).
 *
 * Marks are annotations, read by the file's plain rules: a malformed mark is
 * dropped, a newer build's carried. So is a step's layer spread, which is
 * display data: never a reason to lock the step. A malformed `expect` or note
 * is dropped; none of these changes what a step folds.
 *
 * Every string a user typed passes through `xmlText` on the way in, so what
 * is stored can always be written into an SVG page.
 *
 * React-free and store-free.
 */

import { readRegionReference } from '../../cp-workspace/regions/regionReference';
import { readLayerSpread, writeLayerSpread } from '../../cp-workspace/folded/layerSpreadSettings';
import {
  NEWER,
  finiteNumber,
  hasNewerKey,
  isRecord,
  readEntries,
  readVersioned,
  writeVersioned,
} from '../../lib/documentFile';
import type { FoldAxiom, ReferenceKind } from '../../lib/foldSentences';
import type { OristudioCpRatioExpression } from '../../lib/oristudioCpToolSettings';
import {
  readTurnRotation,
  TURN_ROTATION_KEYS,
  writeTurnRotation,
  type TurnOverAxis,
  type TurnRotation,
} from '../../lib/steps/turn';
import { xmlText } from '../../lib/xmlEscape';
import { isNewerDocumentPaperStyle, readDocumentPaperStyle } from '../../lib/paper/documentPaperStyle';
import {
  AXIOM_SLOTS,
  FOLD_DEFAULT_PAPER_STYLE,
  FOLD_CP_ORIGINS,
  FOLD_CRIMP_KINDS,
  FOLD_DIRECTIONS,
  FOLD_MARK_MAX_PARTS,
  FOLD_MODEL_LINE_MIN_NORMAL,
  FOLD_POLYGON_MAX_SIDES,
  FOLD_POLYGON_MIN_SIDES,
  FOLD_SEED_MAX_LAYERS,
  FOLD_SEQUENCE_FORMAT_VERSION,
  FOLD_START_SIDES,
  SQUARE_PAPER,
  isKnownMark,
  isKnownSpread,
  isLockedStep,
  randomFoldId,
  rectangleShape,
  type FoldChoices,
  type FoldCompletionChoice,
  type FoldDirection,
  type FoldDivide,
  type FoldFaceOrder,
  type FoldIdFactory,
  type FoldLineInput,
  type FoldLocatedLine,
  type FoldLockedStep,
  type FoldMark,
  type FoldMarkEntry,
  type FoldModelDirection,
  type FoldModelLine,
  type FoldOp,
  type FoldOpeningChoice,
  type FoldPaper,
  type FoldPaperShape,
  type FoldPointRef,
  type FoldPrecreaseExtent,
  type FoldRef,
  type FoldSeed,
  type FoldSequenceDocument,
  type FoldStep,
  type FoldStepNode,
  type FoldStepSpreadEntry,
  type FoldSwivelEdgeOp,
  type FoldSwivelValleyMountainOp,
  type FoldVertexOp,
  type FoldVertexOpKind,
  type SheetPoint,
} from './foldSequenceDocument';
import { FOLD_SHEET_KEY, childrenOf, foldStepTree } from './foldStepTree';

/** A sequence as the project holds it: its document, and the value a read-only one is written back as. */
export interface HeldFoldSequence {
  document: FoldSequenceDocument;
  /**
   * Set when a newer build wrote the sequence: it is shown as `document`, a
   * best-effort reading, never changed, and written back as this value.
   */
  readOnlyRaw: Record<string, unknown> | null;
}

export interface ReadFoldSequenceOptions {
  newId?: FoldIdFactory;
}

/**
 * Read `workspace.foldSequences`: every entry that is a record, in order. A
 * value that is not an array is no sequences. Two sequences with one id would
 * make every reader state and link that names one ambiguous, so a later one
 * is given a new id; it is not dropped, since it holds a user's steps.
 */
export function readFoldSequences(value: unknown, options: ReadFoldSequenceOptions = {}): HeldFoldSequence[] {
  if (!Array.isArray(value)) return [];
  const newId = options.newId ?? randomFoldId;
  const sequences: HeldFoldSequence[] = [];
  const ids = new Set<string>();
  for (const entry of value) {
    const held = readFoldSequence(entry, { newId });
    if (!held) continue;
    const document = ids.has(held.document.id) ? { ...held.document, id: newId('fold') } : held.document;
    ids.add(document.id);
    sequences.push({ ...held, document });
  }
  return sequences;
}

/** Read one sequence; null for a value that is not a record. */
export function readFoldSequence(value: unknown, options: ReadFoldSequenceOptions = {}): HeldFoldSequence | null {
  const newId = options.newId ?? randomFoldId;
  const read = readVersioned(value, {
    version: FOLD_SEQUENCE_FORMAT_VERSION,
    read: (raw) => readDocument(raw, newId),
    newerField: newerPaperField,
  });
  return read && { document: read.document, readOnlyRaw: read.readOnly ? read.raw : null };
}

/**
 * The value written for `workspace.foldSequences`, or null for none: an
 * empty array writes no key, so a project without sequences is written byte
 * for byte as it was before Fold existed (plan D7).
 */
export function writeFoldSequences(sequences: readonly HeldFoldSequence[]): Record<string, unknown>[] | null {
  return sequences.length === 0 ? null : sequences.map(writeFoldSequence);
}

/** One sequence as written: a read-only one as it was read, any other with every field named here. */
export function writeFoldSequence({ document, readOnlyRaw }: HeldFoldSequence): Record<string, unknown> {
  return writeVersioned(document, readOnlyRaw, { version: FOLD_SEQUENCE_FORMAT_VERSION, write: writeSequenceFields });
}

// ---------------------------------------------------------------------------
// Reading the sequence

/** Additional targets are witnesses, not face IDs; keep malformed constraints from being dropped. */
function readTuckTargets(value: unknown): readonly SheetPoint[] | null {
  if (!Array.isArray(value) || value.length > 64) return null;
  const points = value.map(readPoint);
  return points.every((point): point is SheetPoint => point !== null) ? points : null;
}

const SEQUENCE_KEYS = new Set(['formatVersion', 'id', 'title', 'paper', 'style', 'appearance', 'sheetMarks', 'steps']);

function readDocument(value: Record<string, unknown>, newId: FoldIdFactory): FoldSequenceDocument {
  const sheetMarks = readMarks(value.sheetMarks);
  const carried = Object.fromEntries(Object.entries(value).filter(([key]) => !SEQUENCE_KEYS.has(key)));
  // A style a newer build wrote is drawn as this build reads it, and written back as it came.
  if (isRecord(value.style) && isNewerDocumentPaperStyle(value.style)) carried.style = value.style;
  return {
    formatVersion: FOLD_SEQUENCE_FORMAT_VERSION,
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : newId('fold'),
    title: typeof value.title === 'string' ? xmlText(value.title) : '',
    paper: readPaper(value.paper),
    // A file from before there was a style draws in the default, and is written with it.
    style: readDocumentPaperStyle(value.style, FOLD_DEFAULT_PAPER_STYLE),
    ...(isRecord(value.appearance) ? { appearance: value.appearance } : {}),
    ...(sheetMarks.length > 0 ? { sheetMarks } : {}),
    steps: readSteps(value.steps),
    ...(Object.keys(carried).length > 0 ? { carried } : {}),
  };
}

/** A damaged paper reads as the square, front up; the steps then replay against it and break where they do not fit. */
function readPaper(value: unknown): FoldPaper {
  if (!isRecord(value)) return SQUARE_PAPER;
  return {
    shape: readShape(value.shape) ?? SQUARE_PAPER.shape,
    startSide: FOLD_START_SIDES.find((side) => side === value.startSide) ?? SQUARE_PAPER.startSide,
  };
}

/**
 * A shape, best-effort: a polygon of more sides than this build offers still
 * reads, for the read-only sequence that holds one ({@link newerPaperField}).
 */
function readShape(value: unknown): FoldPaperShape | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'square':
      return { kind: 'square' };
    case 'rectangle': {
      const aspect = readPoint(value.aspect);
      return aspect && rectangleShape(aspect[0], aspect[1]);
    }
    case 'polygon': {
      const points = readPoints(value.points);
      return points && points.length >= FOLD_POLYGON_MIN_SIDES ? { kind: 'polygon', points } : null;
    }
    default:
      return null;
  }
}

const PAPER_KEYS = new Set(['shape', 'startSide']);
const SHAPE_KEYS = new Map<string, ReadonlySet<string>>([
  ['square', new Set(['kind'])],
  ['rectangle', new Set(['kind', 'aspect'])],
  ['polygon', new Set(['kind', 'points'])],
]);

/**
 * The first field of a sequence's paper that a newer build wrote, or `null`.
 *
 * The paper decides every state of the sequence, so a paper this build would
 * read as something else — an unknown shape or side, a key it does not know,
 * a polygon of more sides than it offers — opens the sequence read-only, as a
 * newer `formatVersion` does, and the sequence is written back as it came. A
 * value of the wrong type is damage rather than news, and reads as the
 * square.
 */
export function newerPaperField(value: Record<string, unknown>): string | null {
  const paper = value.paper;
  if (!isRecord(paper)) return null;
  for (const key of Object.keys(paper)) if (!PAPER_KEYS.has(key)) return `paper.${key}`;
  if (typeof paper.startSide === 'string' && !FOLD_START_SIDES.some((side) => side === paper.startSide)) {
    return 'paper.startSide';
  }
  const shape = paper.shape;
  if (!isRecord(shape) || typeof shape.kind !== 'string') return null;
  const known = SHAPE_KEYS.get(shape.kind);
  if (!known) return 'paper.shape.kind';
  for (const key of Object.keys(shape)) if (!known.has(key)) return `paper.shape.${key}`;
  if (shape.kind === 'polygon' && Array.isArray(shape.points) && shape.points.length > FOLD_POLYGON_MAX_SIDES) {
    return 'paper.shape.points';
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reading the steps

const STEP_KEYS = new Set(['id', 'parent', 'op', 'choices', 'expect', 'note', 'marks', 'spread']);

function readSteps(value: unknown): FoldStepNode[] {
  return withinTree(readEntries<FoldStepNode>(value, readStep, lockStep));
}

/** A node's parent: `null` for the sheet, a non-empty id, or `undefined` for one that does not read. */
function readParent(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function readStep(id: string, entry: Record<string, unknown>): FoldStep | typeof NEWER | null {
  const parent = readParent(entry.parent);
  if (parent === undefined) return null;
  if (hasNewerKey(entry, STEP_KEYS)) return NEWER;
  const op = readOp(entry.op);
  if (!op) return NEWER;
  const choices = entry.choices === undefined ? {} : readChoices(entry.choices);
  if (!choices) return NEWER;
  const marks = readMarks(entry.marks);
  const spread = readStepSpread(entry.spread);
  return {
    id,
    parent,
    op,
    ...(Object.keys(choices).length > 0 ? { choices } : {}),
    ...(typeof entry.expect === 'string' ? { expect: entry.expect } : {}),
    ...(typeof entry.note === 'string' ? { note: xmlText(entry.note) } : {}),
    ...(marks.length > 0 ? { marks } : {}),
    ...(spread !== undefined ? { spread } : {}),
  };
}

/**
 * A step's own layer spread: `'off'`, or a spread as every flat picture's is
 * read (`readLayerSpread`). A word or a spread this build has no name for is
 * a newer build's, carried; a value of the wrong type, or a spread with no
 * step at all, is dropped — the step then takes an earlier step's.
 */
function readStepSpread(value: unknown): FoldStepSpreadEntry | undefined {
  if (value === 'off') return 'off';
  if (typeof value === 'string') return { unknown: value };
  const spread = readLayerSpread(value);
  if (spread === NEWER) return { unknown: value };
  return spread ?? undefined;
}

/** A node `readStep` carried: only ever one whose parent read. */
function lockStep(id: string, entry: Record<string, unknown>): FoldLockedStep {
  return {
    id,
    parent: readParent(entry.parent) ?? null,
    unknown: entry,
    ...(typeof entry.note === 'string' ? { note: xmlText(entry.note) } : {}),
  };
}

/**
 * The nodes whose path reaches the sheet, in their order in the file: an
 * orphan, every node of a cycle, and everything that folds from either are
 * left out.
 */
function withinTree(nodes: FoldStepNode[]): FoldStepNode[] {
  const tree = foldStepTree(nodes);
  const kept = new Set<string>();
  const queue = [FOLD_SHEET_KEY];
  for (let at = 0; at < queue.length; at += 1) {
    for (const child of childrenOf(tree, queue[at])) {
      if (kept.has(child.id)) continue;
      kept.add(child.id);
      queue.push(child.id);
    }
  }
  return kept.size === nodes.length ? nodes : nodes.filter((node) => kept.has(node.id));
}

// ---------------------------------------------------------------------------
// Reading an op

const ALONG_LINE_KEYS = new Set(['kind', 'line', 'moving', 'seed']);
const OP_KEYS = new Map<string, ReadonlySet<string>>([
  ['repeat', new Set(['kind', 'source', 'parentState', 'axis', 'side', 'steps'])],
  ['valley', new Set([...ALONG_LINE_KEYS, 'landing'])],
  ['mountain', new Set([...ALONG_LINE_KEYS, 'landing'])],
  ['precrease', new Set([...ALONG_LINE_KEYS, 'direction', 'extent'])],
  ['unfold-to', new Set(['kind', 'target', 'source'])],
  ['unfold', new Set(['kind', 'crease', 'direction', 'moving', 'seed'])],
  ['refold', new Set(['kind', 'crease', 'direction', 'moving', 'seed'])],
  ['turn', new Set(['kind', 'axis'])],
  ['rotate', new Set(['kind', 'rotate'])],
  ['cp-jump', new Set(['kind', 'cpJson', 'orderJson', 'origin', 'source'])],
  // Compound folds (plan D4), one block per family.
  ['inside-reverse', ALONG_LINE_KEYS],
  ['outside-reverse', ALONG_LINE_KEYS],
  ['pleat', new Set([...ALONG_LINE_KEYS, 'second', 'secondRoot', 'resolved'])],
  ['crimp', new Set([...ALONG_LINE_KEYS, 'second', 'crimp'])],
  ['tuck', new Set([...ALONG_LINE_KEYS, 'direction', 'target', 'additionalTargets'])],
  ['squash', new Set(['kind', 'flap', 'target', 'direction', 'hinge'])],
  // H by `crease` or by `ends`, one of the two (`FoldPetalOp`).
  ['petal', new Set(['kind', 'crease', 'ends', 'petal', 'direction'])],
  ['rabbit-ear', new Set(['kind', 'corners', 'emergent', 'seed', 'stayer', 'direction', 'ridge'])],
  ['swivel', new Set(['kind', 'vertex', 'toward', 'emergent', 'seed', 'stayer', 'direction'])],
  // Sinks: a fold along a line's fields.
  ['open-sink', ALONG_LINE_KEYS],
  ['closed-sink', ALONG_LINE_KEYS],
  ['unsink', ALONG_LINE_KEYS],
]);

/**
 * A swivel by its edge's keys (`via: 'edge'`), at a free vertex or on a
 * folded edge (`fold`, which no build before it knew, and `swivel` for the
 * inside kind, which none before that knew); its rays form's are `OP_KEYS`'.
 */
const SWIVEL_EDGE_KEYS = new Set([
  'kind',
  'via',
  'pivot',
  'fold',
  'edge',
  'target',
  'seed',
  'direction',
  'ridge',
  'swivel',
]);

/** A swivel by its valley and mountain's keys (`FoldSwivelValleyMountainOp`): no direction. */
const SWIVEL_VALLEY_MOUNTAIN_KEYS = new Set(['kind', 'via', 'valley', 'mountain', 'swivel']);

/** The keys this build knows for an op: its kind's, or its form's when its kind has several. */
function opKeys(value: Record<string, unknown>, kind: string): ReadonlySet<string> | undefined {
  if (kind !== 'swivel' || value.via === undefined) return OP_KEYS.get(kind);
  return value.via === 'valley-mountain' ? SWIVEL_VALLEY_MOUNTAIN_KEYS : SWIVEL_EDGE_KEYS;
}

const TURN_AXES: readonly TurnOverAxis[] = ['vertical', 'horizontal'];

/**
 * An op, or null for one this build cannot read: a kind it does not know, a
 * key it does not know, or a field that does not read. Only the structure is
 * judged here. Whether the inputs resolve — a point on the sheet, two free
 * points far enough apart — is the engine's to say on replay, as *broken*.
 */
function readOp(value: unknown, depth = 0, budget = { remaining: 256 }): FoldOp | null {
  if (depth > 4 || --budget.remaining < 0) return null;
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  const keys = opKeys(value, value.kind);
  if (!keys || hasNewerKey(value, keys)) return null;
  const kind = value.kind;
  switch (kind) {
    case 'repeat': {
      const { source, parentState } = value;
      const axis = readModelLine(value.axis);
      // Absent is the other side, as every repeat before it.
      if (value.side !== undefined && value.side !== 'behind') return null;
      if (!axis || !isRecord(source) || hasNewerKey(source, new Set(['first', 'last', 'revision'])) ||
        ![source.first, source.last, source.revision].every((s) => typeof s === 'string' && s.length > 0) ||
        typeof parentState !== 'string' || !parentState.startsWith('fs1:') ||
        !Array.isArray(value.steps) || value.steps.length === 0 || value.steps.length > 128) return null;
      const steps: import('./foldSequenceDocument').FoldRepeatEntry[] = [];
      for (const step of value.steps) {
        if (!isRecord(step) || hasNewerKey(step, new Set(['op', 'choices', 'expect', 'sourceStep', 'returnTo'])) ||
          typeof step.expect !== 'string' || !step.expect.startsWith('fs1:') ||
          typeof step.sourceStep !== 'string' || !step.sourceStep) return null;
        const op = readOp(step.op, depth + 1, budget);
        const choices = step.choices === undefined ? undefined : readChoices(step.choices);
        if (!op || choices === null) return null;
        if (op.kind === 'unfold-to' ? typeof step.returnTo !== 'number' || !Number.isInteger(step.returnTo) || step.returnTo < 0 || step.returnTo > steps.length : step.returnTo !== undefined) return null;
        steps.push({ op, ...(choices ? { choices } : {}), expect: step.expect, sourceStep: step.sourceStep, ...(typeof step.returnTo === 'number' ? { returnTo: step.returnTo } : {}) });
      }
      return { kind, source: { first: source.first as string, last: source.last as string, revision: source.revision as string }, parentState, axis, ...(value.side === 'behind' ? { side: 'behind' as const } : {}), steps };
    }
    case 'valley':
    case 'mountain': {
      const along = readAlongLine(value);
      const landing = readLanding(value.landing);
      return along && landing && { kind, ...along, landing };
    }
    case 'precrease': {
      const along = readAlongLine(value);
      const direction = readDirection(value.direction);
      // Absent is the whole line; present, it must read, or the step would
      // fold a whole line its author did not fold.
      const extent = value.extent === undefined ? undefined : readExtent(value.extent);
      return along && direction && extent !== null
        ? { kind, direction, ...along, ...(extent ? { extent } : {}) }
        : null;
    }
    case 'unfold':
    case 'refold': {
      const crease = readPoint(value.crease);
      const direction = readDirection(value.direction);
      const motion = readMotion(value);
      return crease && direction && motion && { kind, crease, direction, ...motion };
    }
    case 'turn': {
      const axis = TURN_AXES.find((known) => known === value.axis);
      return axis ? { kind, axis } : null;
    }
    case 'rotate': {
      const rotate = readRotation(value.rotate);
      return rotate && { kind, rotate };
    }
    case 'unfold-to': {
      const { target, source } = value;
      if (target !== null && (typeof target !== 'string' || target.length === 0)) return null;
      if (!isRecord(source) || hasNewerKey(source, new Set(['path', 'state', 'targetState']))) return null;
      const { path, state, targetState } = source;
      if (typeof path !== 'string' || !path.startsWith('fh1:') ||
          typeof state !== 'string' || !state.startsWith('fs1:') ||
          typeof targetState !== 'string' || !targetState.startsWith('fs1:')) return null;
      return { kind, target, source: { path, state, targetState } };
    }
    case 'cp-jump': {
      const origin = FOLD_CP_ORIGINS.find((known) => known === value.origin);
      const { cpJson, orderJson } = value;
      const source = value.source;
      if (source !== undefined && (!isRecord(source) ||
        Object.keys(source).some((key) => key !== 'documentId' && key !== 'revision' && key !== 'region') ||
        typeof source.documentId !== 'string' || !source.documentId ||
        typeof source.revision !== 'string' || !source.revision)) return null;
      const region = isRecord(source) && source.region !== undefined ? readRegionReference(source.region) : undefined;
      if (region === null) return null;
      return origin && typeof cpJson === 'string' && typeof orderJson === 'string'
        ? { kind, cpJson, orderJson, origin, ...(source ? { source: {
          documentId: source.documentId as string, revision: source.revision as string, ...(region ? { region } : {}),
        } } : {}) }
        : null;
    }
    // Compound folds (plan D4), one block per family.
    case 'inside-reverse':
    case 'outside-reverse': {
      const along = readAlongLine(value);
      return along && { kind, ...along };
    }
    case 'pleat': {
      const along = readAlongLine(value);
      const second = readLine(value.second);
      const resolved = value.resolved === undefined ? undefined : readList(value.resolved, (entry) => {
        if (!isRecord(entry) || entry.landing === undefined || Object.keys(entry).some((k) => k !== 'landing' && k !== 'completion')) return null;
        const landing = readLanding(entry.landing);
        const completion = entry.completion === undefined ? undefined : readCompletion(entry.completion);
        return landing && completion !== null ? { landing, ...(completion ? { completion } : {}) } : null;
      });
      const secondRoot = value.secondRoot === undefined ? undefined : readModelLine(value.secondRoot);
      if (!along || !second || secondRoot === null || (secondRoot && second.via !== 'axiom') || (second.via === 'axiom' && !secondRoot) || resolved === null || (resolved && resolved.length !== 2)) return null;
      return { kind, ...along, second, ...(secondRoot ? { secondRoot } : {}), ...(resolved ? { resolved: [resolved[0]!, resolved[1]!] as const } : {}) };
    }
    case 'crimp': {
      const along = readAlongLine(value);
      const second = readLine(value.second);
      const crimp = FOLD_CRIMP_KINDS.find((known) => known === value.crimp);
      // ℓ2 has no root of its own to replay: an axiom there does not read.
      return along && second && second.via !== 'axiom' && crimp ? { kind, second, crimp, ...along } : null;
    }
    case 'tuck': {
      const along = readAlongLine(value);
      const direction = readDirection(value.direction);
      const target = readPoint(value.target);
      const additionalTargets = value.additionalTargets === undefined ? undefined : readTuckTargets(value.additionalTargets);
      if (additionalTargets === null) return null;
      return along && direction && target && { kind: direction, ...along, landing: { kind: 'against', targets: [target, ...(additionalTargets ?? [])] } };
    }
    case 'squash':
    case 'petal':
    case 'rabbit-ear':
    case 'swivel':
      return readVertexOp(kind, value);
    case 'open-sink':
    case 'closed-sink':
    case 'unsink': {
      const along = readAlongLine(value);
      return along && { kind, ...along };
    }
    default:
      return null;
  }
}

/**
 * A step's op and choices as the file reads them back once written, or null
 * when they would not read and the step would come back locked. Only what
 * the document's types hold is written: none of the tools' additions to an
 * op (`FoldEngineOp` — a line in the parent's model frame, a side of one, a
 * tuck's placement, the closure policy).
 */
export function readBackFoldStep(
  op: FoldOp,
  choices: FoldChoices = {}
): { op: FoldOp; choices: FoldChoices } | null {
  const read = readOp(writeFoldOp(op));
  const chosen = readChoices(writeFoldChoices(choices) ?? {});
  return read && chosen && { op: read, choices: chosen };
}

// The vertex folds' ops: sheet points, and the directions their choices
// among rays stored. An optional direction absent is none; present, it must
// read.

function readVertexOp(kind: FoldVertexOpKind, value: Record<string, unknown>): FoldVertexOp | null {
  // The one vertex op with no direction: its letters are the viewer's.
  if (kind === 'swivel' && value.via === 'valley-mountain') return readSwivelValleyMountainOp(value);
  const direction = readDirection(value.direction);
  if (!direction) return null;
  const optional = (key: string): FoldModelDirection | undefined | null =>
    value[key] === undefined ? undefined : readModelDirection(value[key]);
  switch (kind) {
    case 'squash': {
      const flap = readPoint(value.flap);
      const target = optional('target');
      // A drawn hinge, when one is spelled; one that does not read locks the step.
      const hinge = value.hinge === undefined ? undefined : readLocatedLine(value.hinge);
      if (!flap || target === null || hinge === null) return null;
      return { kind, flap, ...(target ? { target } : {}), direction, ...(hinge ? { hinge } : {}) };
    }
    case 'petal': {
      const petal = readPoint(value.petal);
      if (!petal) return null;
      // H by its precrease, as every step before `ends` stored it; or by its
      // two ends. Both, or neither, does not read.
      if (value.ends === undefined) {
        const crease = readPoint(value.crease);
        return crease && { kind, crease, petal, direction };
      }
      const ends = value.crease === undefined ? readPoints(value.ends) : null;
      return ends && ends.length === 2 ? { kind, ends: [ends[0], ends[1]], petal, direction } : null;
    }
    case 'rabbit-ear': {
      const corners = readTriple(value.corners);
      const emergent = readModelDirection(value.emergent);
      const seed = readSeed(value.seed);
      const stayer = readPoint(value.stayer);
      // An older step's ridge: kept as it came, read by nothing (`FoldRabbitEarOp.ridge`).
      const ridge = optional('ridge');
      return corners && emergent && seed && stayer && ridge !== null
        ? { kind, corners, emergent, seed, stayer, direction, ...(ridge ? { ridge } : {}) }
        : null;
    }
    case 'swivel': {
      if (value.via !== undefined) return readSwivelEdgeOp(value, direction);
      const vertex = readPoint(value.vertex);
      const toward = readTriple(value.toward);
      const emergent = readModelDirection(value.emergent);
      const seed = readSeed(value.seed);
      const stayer = readPoint(value.stayer);
      return vertex && toward && emergent && seed && stayer
        ? { kind, vertex, toward, emergent, seed, stayer, direction }
        : null;
    }
  }
}

/**
 * A swivel by its valley and mountain (`via: 'valley-mountain'`): each line
 * as a fold's line is located, an axiom's with its root; `swivel: 'inside'`
 * for the inside swivel, the only value it is written with. No direction.
 */
function readSwivelValleyMountainOp(value: Record<string, unknown>): FoldSwivelValleyMountainOp | null {
  const valley = readLocatedLine(value.valley);
  const mountain = readLocatedLine(value.mountain);
  if (!valley || !mountain || (value.swivel !== undefined && value.swivel !== 'inside')) return null;
  return { kind: 'swivel', via: 'valley-mountain', valley, mountain, ...(value.swivel === 'inside' ? { swivel: 'inside' as const } : {}) };
}

/**
 * A swivel by its edge (`via: 'edge'`): the pivot and a point on the edge,
 * the target as a crease's point or two points (an axiom's would need a root
 * the step does not store), the layers, and the ridge when the folder took
 * the other one. On a folded edge, `fold` in place of the pivot and no seed
 * or ridge: a `fold` beside any of them does not read; and `swivel:
 * 'inside'` for the inside swivel — the only value it is written with (an
 * open one spells none), and only on a folded edge. Any other `via` is a
 * newer build's form.
 */
function readSwivelEdgeOp(value: Record<string, unknown>, direction: FoldDirection): FoldSwivelEdgeOp | null {
  if (value.via !== 'edge') return null;
  const edge = readPoint(value.edge);
  const target = readLine(value.target);
  if (value.fold !== undefined) {
    const fold = readPoint(value.fold);
    const alone = value.pivot === undefined && value.seed === undefined && value.ridge === undefined;
    const inside = value.swivel === 'inside';
    const kind = inside || value.swivel === undefined;
    return alone && kind && fold && edge && target && target.via !== 'axiom'
      ? { kind: 'swivel', via: 'edge', fold, edge, target, direction, ...(inside ? { swivel: 'inside' as const } : {}) }
      : null;
  }
  if (value.swivel !== undefined) return null;
  const pivot = readPoint(value.pivot);
  const seed = readSeed(value.seed);
  const ridge = value.ridge === undefined ? undefined : readModelDirection(value.ridge);
  return pivot && edge && target && target.via !== 'axiom' && seed && ridge !== null
    ? { kind: 'swivel', via: 'edge', pivot, edge, target, seed, direction, ...(ridge ? { ridge } : {}) }
    : null;
}

/** A direction: two finite numbers, not both (nearly) zero. */
function readModelDirection(value: unknown): FoldModelDirection | null {
  const direction = readPoint(value);
  return direction && Math.hypot(direction[0], direction[1]) >= FOLD_MODEL_LINE_MIN_NORMAL ? direction : null;
}

function readTriple(value: unknown): readonly [SheetPoint, SheetPoint, SheetPoint] | null {
  const points = readPoints(value);
  return points && points.length === 3 ? [points[0], points[1], points[2]] : null;
}

function readDirection(value: unknown): FoldDirection | null {
  return FOLD_DIRECTIONS.find((direction) => direction === value) ?? null;
}

/**
 * A rotate step's rotation: a part of a turn, or an exact angle as this build
 * writes one (`lib/steps/turn`). Anything else locks the step, as an op that
 * does not read does — so a build that knows only the presets locks an exact
 * angle rather than turning by some other amount.
 */
function readRotation(value: unknown): TurnRotation | null {
  if (!isRecord(value) || hasNewerKey(value, TURN_ROTATION_KEYS)) return null;
  return readTurnRotation(value);
}

/** A fold along a line's line, side and seed. */
function readAlongLine(
  value: Record<string, unknown>
): { line: FoldLineInput; moving?: SheetPoint; seed: FoldSeed } | null {
  const line = readLine(value.line);
  const motion = line && readMotion(value, line);
  return line && motion && { line, ...motion };
}

/**
 * The moving side and the seed. The side is stored when nothing else says it
 * (the bridge's `Motion`) — a depth or flaps seed says it, and so does an
 * axiom that carries a point, whether this one does being the engine's to
 * say on replay — and when the step moves the other side than its axiom
 * says, which the engine takes over the axiom's. A seed of `all` along any
 * other line, or along a crease (`line` null), needs it.
 */
function readMotion(
  value: Record<string, unknown>,
  line: FoldLineInput | null = null
): { moving?: SheetPoint; seed: FoldSeed } | null {
  const seed = readSeed(value.seed);
  if (!seed) return null;
  if (value.moving === undefined) return seed.scope === 'all' && line?.via !== 'axiom' ? null : { seed };
  const moving = readPoint(value.moving);
  return moving && { moving, seed };
}

const EXTENT_KEYS = new Map<string, ReadonlySet<string>>([
  ['segment', new Set(['kind', 'from', 'to'])],
  ['pinch', new Set(['kind', 'at', 'length'])],
]);

/**
 * A partial precrease's extent, or null for one this build cannot read: an
 * unknown kind or key, a point that is not a point input, or a length that
 * is not a positive number. Whether its points resolve, or the pinch is
 * long enough to crease, is the engine's to say on replay.
 */
function readExtent(value: unknown): FoldPrecreaseExtent | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null;
  const keys = EXTENT_KEYS.get(value.kind);
  if (!keys || hasNewerKey(value, keys)) return null;
  switch (value.kind) {
    case 'segment': {
      const from = readPointRef(value.from);
      const to = readPointRef(value.to);
      return from && to && { kind: 'segment', from, to };
    }
    case 'pinch': {
      const at = readPointRef(value.at);
      const length = finiteNumber(value.length);
      return at && length !== null && length > 0 ? { kind: 'pinch', at, length } : null;
    }
    default:
      return null;
  }
}

/** A point input: what an axiom's point slot reads. */
function readPointRef(value: unknown): FoldPointRef | null {
  const ref = readRef(value, 'point');
  return ref && ref.kind !== 'edge' ? ref : null;
}

const SEED_KEYS = new Map<string, ReadonlySet<string>>([
  ['all', new Set(['scope'])],
  ['depth', new Set(['scope', 'at', 'layers'])],
  ['flaps', new Set(['scope', 'at'])],
]);

function readSeed(value: unknown): FoldSeed | null {
  if (!isRecord(value) || typeof value.scope !== 'string') return null;
  const keys = SEED_KEYS.get(value.scope);
  if (!keys || hasNewerKey(value, keys)) return null;
  switch (value.scope) {
    case 'all':
      return { scope: 'all' };
    case 'depth': {
      const at = readPoint(value.at);
      const { layers } = value;
      return at &&
        typeof layers === 'number' &&
        Number.isInteger(layers) &&
        layers > 0 &&
        layers <= FOLD_SEED_MAX_LAYERS
        ? { scope: 'depth', at, layers }
        : null;
    }
    case 'flaps': {
      const at = readPoints(value.at);
      return at && at.length > 0 ? { scope: 'flaps', at } : null;
    }
    default:
      return null;
  }
}

const LINE_KEYS = new Map<string, ReadonlySet<string>>([
  ['axiom', new Set(['via', 'axiom', 'inputs'])],
  ['free', new Set(['via', 'through'])],
  ['crease', new Set(['via', 'at'])],
]);

function readLocatedLine(value: unknown): FoldLocatedLine | null {
  if (!isRecord(value) || hasNewerKey(value, new Set(['line', 'root']))) return null;
  const line = readLine(value.line);
  if (!line) return null;
  if (line.via !== 'axiom') return value.root === undefined ? { line } : null;
  const root = readModelLine(value.root);
  return root ? { line, root } : null;
}

function readLine(value: unknown): FoldLineInput | null {
  if (!isRecord(value) || typeof value.via !== 'string') return null;
  const keys = LINE_KEYS.get(value.via);
  if (!keys || hasNewerKey(value, keys)) return null;
  switch (value.via) {
    case 'axiom': {
      const axiom = readAxiom(value.axiom);
      if (axiom === null || !Array.isArray(value.inputs)) return null;
      const slots = AXIOM_SLOTS[axiom];
      if (value.inputs.length !== slots.length) return null;
      const inputs: FoldRef[] = [];
      for (const [k, slot] of slots.entries()) {
        const input = readRef(value.inputs[k], slot);
        if (!input) return null;
        inputs.push(input);
      }
      return { via: 'axiom', axiom, inputs };
    }
    case 'free': {
      const through = readPoints(value.through);
      return through && through.length === 2 ? { via: 'free', through: [through[0], through[1]] } : null;
    }
    case 'crease': {
      const at = readPoint(value.at);
      return at && { via: 'crease', at };
    }
    default:
      return null;
  }
}

function readAxiom(value: unknown): FoldAxiom | null {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6 || value === 7
    ? value
    : null;
}

const POINT_REF_KEYS = new Set(['kind', 'at']);
const MARK_REF_KEYS = new Set(['kind', 'at', 'mark']);
const EDGE_REF_KEYS = new Set(['kind', 'a', 'b']);

/** An axiom input of the kind its slot takes: a point (or a mark's point), or a line by two points. */
function readRef(value: unknown, slot: ReferenceKind): FoldRef | null {
  if (!isRecord(value)) return null;
  if (slot === 'line') {
    if (value.kind !== 'edge' || hasNewerKey(value, EDGE_REF_KEYS)) return null;
    const a = readPoint(value.a);
    const b = readPoint(value.b);
    return a && b && { kind: 'edge', a, b };
  }
  const at = readPoint(value.at);
  if (!at) return null;
  if (value.kind === 'point') return hasNewerKey(value, POINT_REF_KEYS) ? null : { kind: 'point', at };
  if (value.kind !== 'mark' || hasNewerKey(value, MARK_REF_KEYS)) return null;
  return typeof value.mark === 'string' && value.mark.length > 0 ? { kind: 'mark', at, mark: value.mark } : null;
}

// ---------------------------------------------------------------------------
// Reading choices

const CHOICE_KEYS = new Set(['root', 'completion', 'pocket', 'opening']);
const MODEL_LINE_KEYS = new Set(['n', 'd']);
const COMPLETION_KEYS = new Set(['faces', 'orders']);
const OPENING_KEYS = new Set(['upper']);

/**
 * Choices, or null for ones this build cannot read. An empty list reads as
 * no choice of its kind, and so does a completion that orders nothing.
 */
function readChoices(value: unknown): FoldChoices | null {
  if (!isRecord(value) || hasNewerKey(value, CHOICE_KEYS)) return null;
  const choices: {
    root?: FoldModelLine;
    completion?: FoldCompletionChoice;
    pocket?: [SheetPoint, SheetPoint];
    opening?: FoldOpeningChoice[];
  } = {};
  if (value.root !== undefined) {
    const root = readModelLine(value.root);
    if (!root) return null;
    choices.root = root;
  }
  if (value.completion !== undefined) {
    const completion = readCompletion(value.completion);
    if (!completion) return null;
    if (completion.orders.length > 0) choices.completion = completion;
  }
  if (value.pocket !== undefined) {
    const pocket = readPoints(value.pocket);
    if (!pocket || pocket.length !== 2) return null;
    choices.pocket = [pocket[0], pocket[1]];
  }
  if (value.opening !== undefined) {
    const opening = readList(value.opening, readOpening);
    if (!opening) return null;
    if (opening.length > 0) choices.opening = opening;
  }
  return choices;
}

function readModelLine(value: unknown): FoldModelLine | null {
  if (!isRecord(value) || hasNewerKey(value, MODEL_LINE_KEYS)) return null;
  const n = readPoint(value.n);
  const d = finiteNumber(value.d);
  return n && d !== null && Math.hypot(n[0], n[1]) >= FOLD_MODEL_LINE_MIN_NORMAL ? { n, d } : null;
}

/**
 * A completion's witnesses and its FOLD triples. Only the structure is
 * judged here: a triple naming a witness that is not there, or a face against
 * itself, is the engine's to call broken on replay.
 */
function readCompletion(value: unknown): FoldCompletionChoice | null {
  if (!isRecord(value) || hasNewerKey(value, COMPLETION_KEYS)) return null;
  const faces = readPoints(value.faces);
  const orders = readList(value.orders, readFaceOrder);
  return faces && orders && { faces, orders };
}

/** `[f, g, s]`: two witness indices and a sign of 1 or -1. */
function readFaceOrder(value: unknown): FoldFaceOrder | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [f, g, s] = value as unknown[];
  const index = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 0xffff_ffff;
  if (!index(f) || !index(g) || (s !== 1 && s !== -1)) return null;
  return [f, g, s];
}

function readOpening(value: unknown): FoldOpeningChoice | null {
  if (!isRecord(value) || hasNewerKey(value, OPENING_KEYS)) return null;
  const upper = readPoints(value.upper);
  return upper && upper.length > 0 ? { upper } : null;
}

// ---------------------------------------------------------------------------
// Reading marks

const MARK_KEYS = new Set(['id', 'from', 'to', 'divide']);
const COUNT_DIVIDE_KEYS = new Set(['mode', 'parts']);
const RATIO_DIVIDE_KEYS = new Set(['mode', 'ratio']);
const RATIO_KEYS = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const RATIO_KEY_SET = new Set<string>(RATIO_KEYS);

function readMarks(value: unknown): FoldMarkEntry[] {
  return readEntries<FoldMarkEntry>(value, readMark, (id, unknown) => ({ id, unknown }));
}

function readMark(id: string, entry: Record<string, unknown>): FoldMark | typeof NEWER | null {
  if (hasNewerKey(entry, MARK_KEYS)) return NEWER;
  const from = readPoint(entry.from);
  const to = readPoint(entry.to);
  const divide = readDivide(entry.divide);
  if (!from || !to || divide === null) return null;
  return divide === NEWER ? NEWER : { id, from, to, divide };
}

/** A division: a mode or a part count this build does not offer is a newer build's. */
function readDivide(value: unknown): FoldDivide | typeof NEWER | null {
  if (!isRecord(value) || typeof value.mode !== 'string') return null;
  switch (value.mode) {
    case 'count': {
      if (hasNewerKey(value, COUNT_DIVIDE_KEYS)) return NEWER;
      const { parts } = value;
      if (typeof parts !== 'number' || !Number.isInteger(parts) || parts < 2) return null;
      return parts > FOLD_MARK_MAX_PARTS ? NEWER : { mode: 'count', parts };
    }
    case 'ratio': {
      if (hasNewerKey(value, RATIO_DIVIDE_KEYS)) return NEWER;
      const ratio = readRatio(value.ratio);
      return ratio === null || ratio === NEWER ? ratio : { mode: 'ratio', ratio };
    }
    default:
      return NEWER;
  }
}

/** Edit's exact ratio `a + b√c : d + e√f`, both parts positive. */
function readRatio(value: unknown): OristudioCpRatioExpression | typeof NEWER | null {
  if (!isRecord(value)) return null;
  if (hasNewerKey(value, RATIO_KEY_SET)) return NEWER;
  const [a, b, c, d, e, f] = RATIO_KEYS.map((key) => finiteNumber(value[key]));
  if (a === null || b === null || c === null || d === null || e === null || f === null) return null;
  if (c < 0 || f < 0 || !(a + b * Math.sqrt(c) > 0) || !(d + e * Math.sqrt(f) > 0)) return null;
  return { a, b, c, d, e, f };
}

// ---------------------------------------------------------------------------
// Reading values

/** Two finite numbers. */
function readPoint(value: unknown): SheetPoint | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const x = finiteNumber(value[0]);
  const y = finiteNumber(value[1]);
  return x !== null && y !== null ? [x, y] : null;
}

function readPoints(value: unknown): SheetPoint[] | null {
  return readList(value, readPoint);
}

/** Every entry of a list read by `read`, or null when the value is not a list or any entry does not read. */
function readList<T>(value: unknown, read: (entry: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null;
  const list: T[] = [];
  for (const entry of value) {
    const item = read(entry);
    if (item === null) return null;
    list.push(item);
  }
  return list;
}

// ---------------------------------------------------------------------------
// Writing

/** Every field but `formatVersion`, which `writeVersioned` writes first; the carried keys last, as they came. */
function writeSequenceFields(document: FoldSequenceDocument): Record<string, unknown> {
  const { sheetMarks, appearance, carried } = document;
  return {
    id: document.id,
    title: document.title,
    paper: writeFoldPaper(document.paper),
    // Written always, so a later default never changes what a saved sequence is drawn in.
    style: document.style ?? FOLD_DEFAULT_PAPER_STYLE,
    ...(appearance ? { appearance } : {}),
    ...(sheetMarks && sheetMarks.length > 0 ? { sheetMarks: sheetMarks.map(writeMark) } : {}),
    steps: document.steps.map(writeStep),
    ...carried,
  };
}

/** The paper as written, and as `fh1` spells it. */
export function writeFoldPaper({ shape, startSide }: FoldPaper): Record<string, unknown> {
  return { shape: writeShape(shape), startSide };
}

function writeShape(shape: FoldPaperShape): Record<string, unknown> {
  switch (shape.kind) {
    case 'square':
      return { kind: shape.kind };
    case 'rectangle':
      return { kind: shape.kind, aspect: writePoint(shape.aspect) };
    case 'polygon':
      return { kind: shape.kind, points: shape.points.map(writePoint) };
  }
}

function writeStep(node: FoldStepNode): Record<string, unknown> {
  if (isLockedStep(node)) return node.unknown;
  const choices = node.choices ? writeFoldChoices(node.choices) : null;
  return {
    id: node.id,
    parent: node.parent,
    op: writeFoldOp(node.op),
    ...(choices ? { choices } : {}),
    ...(node.expect !== undefined ? { expect: node.expect } : {}),
    ...(node.note !== undefined ? { note: node.note } : {}),
    ...(node.marks && node.marks.length > 0 ? { marks: node.marks.map(writeMark) } : {}),
    ...(node.spread !== undefined ? { spread: writeStepSpread(node.spread) } : {}),
  };
}

/** A step's own spread as written: `'off'`, its fields in a fixed order, or a newer build's as it came. */
function writeStepSpread(spread: FoldStepSpreadEntry): unknown {
  if (spread === 'off') return spread;
  return isKnownSpread(spread) ? writeLayerSpread(spread) : spread.unknown;
}

/** An op as written — every field named, in a fixed order — and as `fh1` spells it. */
export function writeFoldOp(op: FoldOp): Record<string, unknown> {
  switch (op.kind) {
    case 'repeat':
      return { kind: op.kind, source: { ...op.source }, parentState: op.parentState, axis: op.axis,
        ...(op.side === 'behind' ? { side: op.side } : {}),
        steps: op.steps.map((step) => ({ op: writeFoldOp(step.op), ...(step.choices && writeFoldChoices(step.choices) ? { choices: writeFoldChoices(step.choices) } : {}), expect: step.expect, sourceStep: step.sourceStep, ...(step.returnTo !== undefined ? { returnTo: step.returnTo } : {}) })) };
    case 'valley':
    case 'mountain':
      return { kind: op.kind, line: writeLine(op.line), ...writeMotion(op), landing: op.landing ?? { kind: 'outer' } };
    case 'precrease':
      return {
        kind: op.kind,
        line: writeLine(op.line),
        direction: op.direction,
        ...writeMotion(op),
        // Last, and only when present: a whole precrease is written as it
        // always was.
        ...(op.extent ? { extent: writeExtent(op.extent) } : {}),
      };
    case 'unfold':
    case 'refold':
      return { kind: op.kind, crease: writePoint(op.crease), direction: op.direction, ...writeMotion(op) };
    case 'turn':
      return { kind: op.kind, axis: op.axis };
    case 'rotate':
      // A preset as it always was; an exact angle with its degrees between.
      return { kind: op.kind, rotate: writeTurnRotation(op.rotate) };
    case 'unfold-to':
      return { kind: op.kind, target: op.target, source: { ...op.source } };
    case 'cp-jump':
      return { kind: op.kind, cpJson: op.cpJson, orderJson: op.orderJson, origin: op.origin, ...(op.source ? { source: { ...op.source } } : {}) };
    // Compound folds (plan D4), one block per family.
    case 'inside-reverse':
    case 'outside-reverse':
    case 'open-sink':
    case 'closed-sink':
    case 'unsink':
      return { kind: op.kind, line: writeLine(op.line), ...writeMotion(op) };
    case 'pleat':
      return { kind: op.kind, line: writeLine(op.line), second: writeLine(op.second), ...(op.secondRoot ? { secondRoot: { n: [...op.secondRoot.n], d: op.secondRoot.d } } : {}), ...writeMotion(op),
        ...(op.resolved ? { resolved: op.resolved.map((r) => ({ landing: r.landing,
          ...(r.completion ? { completion: { faces: r.completion.faces.map(writePoint), orders: r.completion.orders.map((o) => [...o]) } } : {}),
        })) } : {}) };
    case 'crimp':
      return {
        kind: op.kind,
        line: writeLine(op.line),
        second: writeLine(op.second),
        crimp: op.crimp,
        ...writeMotion(op),
      };
    case 'tuck':
      return {
        kind: op.direction,
        line: writeLine(op.line),
        ...writeMotion(op),
        landing: { kind: 'against', targets: [op.target, ...(op.additionalTargets ?? [])].map(writePoint) },
      };
    case 'squash':
    case 'petal':
    case 'rabbit-ear':
    case 'swivel':
      return writeVertexOp(op);
  }
}

/** A vertex fold's op, every field named in a fixed order; an absent direction left out. */
function writeVertexOp(op: FoldVertexOp): Record<string, unknown> {
  const optional = (key: string, direction: FoldModelDirection | undefined) =>
    direction ? { [key]: writePoint(direction) } : {};
  switch (op.kind) {
    case 'squash':
      return {
        kind: op.kind,
        flap: writePoint(op.flap),
        ...optional('target', op.target),
        direction: op.direction,
        ...(op.hinge ? { hinge: writeLocatedLine(op.hinge) } : {}),
      };
    case 'petal':
      // The precrease form exactly as it was always written; the ends form
      // in the same place.
      return 'ends' in op
        ? { kind: op.kind, ends: op.ends.map(writePoint), petal: writePoint(op.petal), direction: op.direction }
        : { kind: op.kind, crease: writePoint(op.crease), petal: writePoint(op.petal), direction: op.direction };
    case 'rabbit-ear':
      return {
        kind: op.kind,
        corners: op.corners.map(writePoint),
        emergent: writePoint(op.emergent),
        seed: writeSeed(op.seed),
        stayer: writePoint(op.stayer),
        direction: op.direction,
        ...optional('ridge', op.ridge),
      };
    case 'swivel':
      if ('via' in op && op.via === 'valley-mountain') {
        return {
          kind: op.kind,
          via: op.via,
          valley: writeLocatedLine(op.valley),
          mountain: writeLocatedLine(op.mountain),
          ...(op.swivel === 'inside' ? { swivel: op.swivel } : {}),
        };
      }
      if ('via' in op && 'fold' in op) {
        // On a folded edge: `fold` where the free form has its pivot, and
        // neither a seed nor a ridge; last, and only when inside, its kind,
        // so an open swivel is written as it always was.
        return {
          kind: op.kind,
          via: op.via,
          fold: writePoint(op.fold),
          edge: writePoint(op.edge),
          target: writeLine(op.target),
          direction: op.direction,
          ...(op.swivel === 'inside' ? { swivel: op.swivel } : {}),
        };
      }
      if ('via' in op) {
        return {
          kind: op.kind,
          via: op.via,
          pivot: writePoint(op.pivot),
          edge: writePoint(op.edge),
          target: writeLine(op.target),
          seed: writeSeed(op.seed),
          direction: op.direction,
          ...optional('ridge', op.ridge),
        };
      }
      return {
        kind: op.kind,
        vertex: writePoint(op.vertex),
        toward: op.toward.map(writePoint),
        emergent: writePoint(op.emergent),
        seed: writeSeed(op.seed),
        stayer: writePoint(op.stayer),
        direction: op.direction,
      };
  }
}

function writeMotion({ moving, seed }: { moving?: SheetPoint; seed: FoldSeed }): Record<string, unknown> {
  return { ...(moving ? { moving: writePoint(moving) } : {}), seed: writeSeed(seed) };
}

function writeExtent(extent: FoldPrecreaseExtent): Record<string, unknown> {
  switch (extent.kind) {
    case 'segment':
      return { kind: extent.kind, from: writeRef(extent.from), to: writeRef(extent.to) };
    case 'pinch':
      return { kind: extent.kind, at: writeRef(extent.at), length: extent.length };
  }
}

function writeSeed(seed: FoldSeed): Record<string, unknown> {
  switch (seed.scope) {
    case 'all':
      return { scope: seed.scope };
    case 'depth':
      return { scope: seed.scope, at: writePoint(seed.at), layers: seed.layers };
    case 'flaps':
      return { scope: seed.scope, at: seed.at.map(writePoint) };
  }
}

function writeLocatedLine(located: FoldLocatedLine): Record<string, unknown> {
  return { line: writeLine(located.line), ...(located.root ? { root: { n: writePoint(located.root.n), d: located.root.d } } : {}) };
}

function writeLine(line: FoldLineInput): Record<string, unknown> {
  switch (line.via) {
    case 'axiom':
      return { via: line.via, axiom: line.axiom, inputs: line.inputs.map(writeRef) };
    case 'free':
      return { via: line.via, through: line.through.map(writePoint) };
    case 'crease':
      return { via: line.via, at: writePoint(line.at) };
  }
}

function writeRef(ref: FoldRef): Record<string, unknown> {
  switch (ref.kind) {
    case 'point':
      return { kind: ref.kind, at: writePoint(ref.at) };
    case 'mark':
      return { kind: ref.kind, at: writePoint(ref.at), mark: ref.mark };
    case 'edge':
      return { kind: ref.kind, a: writePoint(ref.a), b: writePoint(ref.b) };
  }
}

/** Choices as written, and as `fh1` spells them: null when there are none, so `{}` and none are one value. */
export function writeFoldChoices(choices: FoldChoices): Record<string, unknown> | null {
  const { root, completion, pocket, opening } = choices;
  const written = {
    ...(root ? { root: { n: writePoint(root.n), d: root.d } } : {}),
    ...(completion && completion.orders.length > 0
      ? {
          completion: {
            faces: completion.faces.map(writePoint),
            orders: completion.orders.map(([f, g, s]) => [f, g, s]),
          },
        }
      : {}),
    ...(pocket ? { pocket: pocket.map(writePoint) } : {}),
    ...(opening && opening.length > 0
      ? { opening: opening.map(({ upper }) => ({ upper: upper.map(writePoint) })) }
      : {}),
  };
  return Object.keys(written).length > 0 ? written : null;
}

function writeMark(mark: FoldMarkEntry): Record<string, unknown> {
  if (!isKnownMark(mark)) return mark.unknown;
  return { id: mark.id, from: writePoint(mark.from), to: writePoint(mark.to), divide: writeDivide(mark.divide) };
}

function writeDivide(divide: FoldDivide): Record<string, unknown> {
  if (divide.mode === 'count') return { mode: divide.mode, parts: divide.parts };
  const { a, b, c, d, e, f } = divide.ratio;
  return { mode: divide.mode, ratio: { a, b, c, d, e, f } };
}

function writePoint(point: SheetPoint | readonly [number, number]): [number, number] {
  return [point[0], point[1]];
}

function readLanding(value: unknown): import('./foldSequenceDocument').FoldLanding | null {
  if (value === undefined) return { kind: 'outer' };
  if (!isRecord(value)) return null;
  if (value.kind === 'outer' && !hasNewerKey(value, new Set(['kind']))) return { kind: 'outer' };
  if (value.kind !== 'against' || hasNewerKey(value, new Set(['kind', 'targets'])) || !Array.isArray(value.targets)
    || value.targets.length < 1 || value.targets.length > 65) return null;
  const targets = value.targets.map(readPoint);
  return targets.every((p): p is SheetPoint => p !== null) ? { kind: 'against', targets } : null;
}
