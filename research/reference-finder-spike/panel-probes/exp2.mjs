import { V, H, T, greedy, exact, rf, fmt } from "./probe.mjs";
import { rfSolutionLines } from "./geom.mjs";
const f = await rf(5);
for (const [name, l] of [["x=1/5", V(1/5)], ["x=1/3", V(1/3)], ["x=2/5", V(2/5)], ["x=1/7", V(1/7)]]) {
  const p0 = [l.n[0]*l.d, l.n[1]*l.d], p1 = [p0[0]-l.n[1], p0[1]+l.n[0]];
  const r = await f.solveLine(p0, p1, { count: 5 });
  console.log(`\n== RF top-5 for ${name} (${r.solutions.length} returned) ==`);
  for (const s of r.solutions) {
    const { lines, diagonals } = rfSolutionLines(s, 1, 1);
    console.log(`  err=${s.err.toExponential(2)} rank=${s.rank} steps=${s.steps.map(t => `O${t.axiom}${t.pinch?"p":""}(${[t.p0,t.p1,t.l0,t.l1].filter(Boolean).join(",")})`).join(" ")}  → fresh: ${[...diagonals.map(d=>"DIAG "+fmt(d.line)), ...lines.map(x=>fmt(x.line))].join(" | ")}`);
  }
}
for (const [name, targets] of Object.entries({ grid5: [1,2,3,4].flatMap(i => [V(i/5), H(i/5)]), x15_only: [V(1/5)], thirds_and_fifths: [V(1/3), V(2/3), V(1/5), V(2/5), V(3/5), V(4/5)] })) {
  const g = await greedy(1, 1, targets, { topk: 5 });
  console.log(`${name}: aux=${g.aux.length} unsolved=${g.unsolved}`);
}
process.exit(0);
