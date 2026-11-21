import { alongLine, lineThrough, sideOf, toPoint } from '../../fold/canvas/foldCanvasGeometry';
import { foldOpSteps, type FoldOp, type FoldRef, type FoldStepNode, type SheetPoint } from '../../fold/document/foldSequenceDocument';
import { foldStepTree, pathTo } from '../../fold/document/foldStepTree';
import { sheetToScene, type FoldStateFrame } from '../../fold/sequence/foldStateFrame';

// The Fold engine's tolerance for picking the interior of a crease (State::crease_at).
const TOL = 1e-6;

/** The operation that first made the picked crease, including a mirrored operation inside a Repeat. */
function creaseMaker(steps: readonly FoldStepNode[], parent: string, madeAt: number): FoldOp | undefined {
  let count = 0;
  for (const node of pathTo(foldStepTree(steps), parent) ?? []) {
    if (!node.op) return;
    const next = count + foldOpSteps(node.op);
    if (madeAt <= next) return node.op.kind === 'repeat' ? node.op.steps[madeAt - count - 1]?.op : node.op;
    count = next;
  }
}

/** Match Fold's crease pick on the sheet, excluding a shared endpoint. */
function creaseAt(before: FoldStateFrame, witness: SheetPoint) {
  const pick = toPoint(witness);
  for (const crease of before.creases.values()) {
    const line = lineThrough(crease.from, crease.to);
    if (!line || Math.abs(sideOf(line, pick)) > TOL) continue;
    const at = alongLine(line, pick);
    if (at > alongLine(line, crease.from) + TOL && at < alongLine(line, crease.to) - TOL) return crease;
  }
}

function landsOnLine(point: FoldRef | undefined, edge: FoldRef | undefined, before: FoldStateFrame, after: FoldStateFrame): boolean {
  if (!point || point.kind === 'edge' || edge?.kind !== 'edge') return false;
  const start = sheetToScene(before, point.at);
  const landed = sheetToScene(after, point.at);
  const a = sheetToScene(before, edge.a);
  const b = sheetToScene(before, edge.b);
  if (!start || !landed || !a || !b || Math.hypot(start[0] - landed[0], start[1] - landed[1]) <= TOL) return false;
  const target = lineThrough(toPoint(a), toPoint(b));
  return target !== null && Math.abs(sideOf(target, toPoint(landed))) <= TOL;
}

/** Recover the original point references for a Diagram refold only when both points still land on their lines. */
export function diagramFoldConstruction(
  steps: readonly FoldStepNode[],
  node: FoldStepNode,
  before: FoldStateFrame | null,
  after: FoldStateFrame | null
): FoldStepNode {
  if (!before || !after || !node.parent || !node.op) return node;
  const op = node.op;
  if (op.kind !== 'refold' && op.kind !== 'valley' && op.kind !== 'mountain') return node;
  const witness = 'crease' in op ? op.crease : op.line.via === 'crease' ? op.line.at : null;
  if (!witness) return node;
  const crease = creaseAt(before, witness);
  if (!crease?.made_at || crease.kind !== 'flat') return node;
  const maker = creaseMaker(steps, node.parent, crease.made_at);
  if (maker?.kind !== 'precrease' && maker?.kind !== 'valley' && maker?.kind !== 'mountain') return node;
  if (maker.line.via !== 'axiom' || maker.line.axiom !== 6) return node;
  const [p, first, q, second] = maker.line.inputs;
  if (!landsOnLine(p, first, before, after) || !landsOnLine(q, second, before, after)) return node;
  const fold = 'crease' in op ? { kind: op.direction, seed: op.seed, moving: op.moving } : op;
  return { ...node, op: { ...fold, line: maker.line } };
}
