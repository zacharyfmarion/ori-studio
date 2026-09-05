import { createFinder } from "./rf.mjs";
const rf = await createFinder({ rank: 6 });
for (const [name, p, q] of [["A", [0, 0.625], [1, 0.125]], ["B", [0, 0.5], [0.875, 1]]]) {
  const r = await rf.solveLine(p, q, { count: 5 });
  for (const s of r.solutions) console.log(name, "err", s.err, "rank", s.rank, JSON.stringify(s.steps.map(t => ({ ax: t.axiom, p0: t.p0, p1: t.p1, l0: t.l0, l1: t.l1, x: t.x, pinch: t.pinch }))));
}
process.exit(0);
