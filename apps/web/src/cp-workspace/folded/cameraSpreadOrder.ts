/** Camera ordering of unrelated stacks, subordinate to every known layer relation. */
import type { Mat3, Vec3 } from '@treemaker/origami-simulator';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { faceComponents } from './foldedFlatScene';
import type { CameraSpreadLift } from './cameraSpreadLift';
import type { CameraPaintPlan } from './cameraSpreadVisibility';
import type { CameraSpreadOptions } from './cameraSpreadScene';

interface Block {
  start: number;
  end: number;
  centre: Vec3;
}
interface PreparedOrder {
  blocks: Block[];
  above: number[][];
  pending: Int32Array;
}
const cache = new WeakMap<CameraPaintPlan, PreparedOrder>();

function prepare(
  mesh: CameraSpreadLift,
  kernel: OristudioCpFoldedPaperScene,
  plan: CameraPaintPlan,
  back: boolean
): PreparedOrder {
  const held = cache.get(plan);
  if (held) return held;
  // Preserve each woven component's internal paint sequence and every patch
  // insertion. Merge overlapping rank spans so moving a block cannot separate
  // a patch from the ink it hides, even if that ink belongs to another component.
  const components = faceComponents(kernel.faces.length, kernel.subfaces);
  const componentOf = new Int32Array(kernel.faces.length);
  const spans = components.map(() => ({ start: Infinity, end: -1 }));
  components.forEach((faces, c) =>
    faces.forEach((f) => {
      componentOf[f] = c;
    })
  );
  for (const piece of plan.pieces) {
    const span = spans[componentOf[piece.face]!]!;
    span.start = Math.min(span.start, piece.rank);
    span.end = Math.max(span.end, piece.rank);
  }
  const blocks: Block[] = [];
  for (const span of spans.filter((s) => s.end >= 0).sort((a, b) => a.start - b.start)) {
    const last = blocks.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else blocks.push({ ...span, centre: [0, 0, 0] });
  }
  const blockOf = new Int32Array(kernel.faces.length).fill(-1);
  const rankBlock = new Int32Array(plan.slots).fill(-1);
  blocks.forEach((block, id) => rankBlock.fill(id, block.start, block.end + 1));
  for (const piece of plan.pieces) blockOf[piece.face] = rankBlock[piece.rank]!;
  const counts = new Uint32Array(blocks.length);
  mesh.faceVertices.forEach((vertices, f) => {
    const block = blocks[blockOf[f]!];
    if (!block) return;
    for (const v of vertices) {
      block.centre[0] += mesh.xy[v]!.x;
      block.centre[1] += mesh.xy[v]!.y;
      block.centre[2] += mesh.heights[v]!;
      counts[blockOf[f]!]++;
    }
  });
  blocks.forEach((block, id) => {
    block.centre = block.centre.map((x) => x / counts[id]!) as Vec3;
  });
  const above = blocks.map(() => new Set<number>()),
    pending = new Int32Array(blocks.length);
  for (const cell of kernel.subfaces) {
    const faces = back ? [...cell.faces_top_to_bottom].reverse() : cell.faces_top_to_bottom;
    for (let i = 1; i < faces.length; i++) {
      const lower = blockOf[faces[i]!]!,
        upper = blockOf[faces[i - 1]!]!;
      if (lower < 0 || upper < 0 || lower === upper || above[lower]!.has(upper)) continue;
      above[lower]!.add(upper);
      pending[upper]++;
    }
  }
  const result = { blocks, above: above.map((set) => [...set]), pending };
  cache.set(plan, result);
  return result;
}

/** Geometry and the constraint DAG are cached; only the small rank map changes. */
export function cameraPaintRanks(
  mesh: CameraSpreadLift,
  kernel: OristudioCpFoldedPaperScene,
  plan: CameraPaintPlan,
  back: boolean,
  options: Pick<CameraSpreadOptions, 'amount' | 'projection'>,
  frame: Mat3
): Float32Array {
  const ranks = Float32Array.from({ length: plan.slots }, (_, i) => i);
  if (options.projection === 'diagram' || options.amount === 0) return ranks;
  const { blocks, above, pending: initial } = prepare(mesh, kernel, plan, back);
  const pending = initial.slice();
  const depth = blocks.map(
    ({ centre: [x, y, h] }) => frame[6] * x + frame[7] * y + frame[8] * h * options.amount
  );
  // Only unconstrained blocks compete by depth. No amount or camera angle can
  // replace a known stack relation with the approximate lift's physical order.
  const ready = blocks.flatMap((_, i) => (pending[i] === 0 ? [i] : []));
  let next = 0,
    visited = 0;
  while (ready.length) {
    ready.sort((a, b) => depth[b]! - depth[a]! || b - a);
    const id = ready.pop()!,
      block = blocks[id]!;
    for (let rank = block.start; rank <= block.end; rank++) ranks[rank] = next++;
    visited++;
    for (const upper of above[id]!) if (--pending[upper]! === 0) ready.push(upper);
  }
  if (visited !== blocks.length) throw new Error('Camera paint blocks contain an unresolved layer cycle');
  return ranks;
}
