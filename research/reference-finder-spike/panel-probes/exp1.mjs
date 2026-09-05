import { V, H, T, greedy, exact, rfSolutions, fmt } from "./probe.mjs";
import { lineKey } from "./geom.mjs";
const cps = {
  grid3: [V(1/3), V(2/3), H(1/3), H(2/3)],
  grid3_diag: [V(1/3), V(2/3), H(1/3), H(2/3), T([0,0],[1,1]), T([0,1],[1,0])],
  grid6: [1,2,3,4,5].flatMap(i => [V(i/6), H(i/6)]).concat([T([0,0],[1,1]), T([0,1],[1,0]), T([1/6,0],[1,5/6]), T([0,1/6],[5/6,1])]),
  grid5: [1,2,3,4].flatMap(i => [V(i/5), H(i/5)]),
  thirds_and_fifths: [V(1/3), V(2/3), V(1/5), V(2/5), V(3/5), V(4/5)],
  x13_only: [V(1/3)],
  x15_only: [V(1/5)],
};
for (const [name, targets] of Object.entries(cps)) {
  const t0 = performance.now();
  const g = await greedy(1, 1, targets, { topk: 5 });
  const g1 = await greedy(1, 1, targets, { topk: 1 });
  const gl = await greedy(1, 1, targets, { topk: 5, lookahead: true });
  const gb = await greedy(1, 1, targets, { topk: 5, lookahead: true, beam: 3 });
  const ex = exact(1, 1, targets, 3);
  console.log(`${name.padEnd(18)} |CP|=${targets.length} closure0=${g.closure0}  greedy top1: ${g1.aux.length} aux | top5: ${g.aux.length} aux [${g.aux.map(fmt).join("; ")}] | lookahead: ${gl.aux.length} | beam3: ${gb.aux.length} | exact(≤3,noO6): ${ex.aux ? ex.aux.length + " [" + ex.aux.map(fmt).join("; ") + "]" : ">3"} (${ex.nodes} nodes)  ${(performance.now()-t0).toFixed(0)}ms`);
}
process.exit(0);
