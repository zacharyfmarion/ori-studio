import { V, H, T, greedy, exact, fmt } from "./probe.mjs";
const D1 = T([0,0],[1,1]), D2 = T([0,1],[1,0]);
const g3 = [V(1/3), V(2/3), H(1/3), H(2/3), D1, D2];
const cps = {
  g3d_x19: [...g3, V(1/9)],
  g3d_x19_y19: [...g3, V(1/9), H(1/9)],
  g3d_x29: [...g3, V(2/9)],
  g3d_x112: [...g3, V(1/12)],
  g3d_x16_x19: [...g3, V(1/6), V(1/9)],
  x13_x19: [V(1/3), V(1/9)],
  x13_y13_x19: [V(1/3), H(1/3), V(1/9)],
  g3_nodiag_x19: [V(1/3), V(2/3), H(1/3), H(2/3), V(1/9)],
  x14_x13: [V(1/4), V(1/3)],
  x13_x38: [V(1/3), V(3/8)],
  x13_steep: [V(1/3), T([0,0],[1/3,1])],
  x13_x23_steep: [V(1/3), V(2/3), T([0,0],[2/3,1])],
  x13_diag_pair: [V(1/3), T([0,0],[1,1/3])],
};
for (const [name, targets] of Object.entries(cps)) {
  const t0 = performance.now();
  const g = await greedy(1, 1, targets, { topk: 5 });
  const g1 = await greedy(1, 1, targets, { topk: 1 });
  const gl = await greedy(1, 1, targets, { topk: 5, lookahead: true });
  const gb = await greedy(1, 1, targets, { topk: 5, lookahead: true, beam: 3 });
  const ex = exact(1, 1, targets, 3);
  const r = (x) => `${x.aux.length}${x.unsolved ? `+${x.unsolved}unsolved` : ""}`;
  console.log(`${name.padEnd(16)} |CP|=${String(targets.length).padStart(2)} cl0=${g.closure0}  top1:${r(g1)}  top5:${r(g)} [${g.aux.map(fmt).join("; ")}]  look:${r(gl)}  beam3:${r(gb)}  exact:${ex.aux ? ex.aux.length + " [" + ex.aux.map(fmt).join("; ") + "]" : ">3"}  ${(performance.now()-t0).toFixed(0)}ms`);
}
process.exit(0);
