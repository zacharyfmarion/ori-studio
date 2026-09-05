import { createFinder } from "./rf.mjs";
const key = (s) => JSON.stringify({ sol: s.solution, err: s.err, rank: s.rank, steps: s.steps });
const summarize = (r) => r.solutions.map(s => `r${s.rank} err=${s.err.toExponential(2)} steps=${s.steps.length}`).join(" | ");

const f = await createFinder({ rank: 6 });
console.log("build", f.buildMs.toFixed(0), "ms", f.dbInfo);

// Targets: exact lines of various ranks. x=1/3 vertical; x=1/5; a 22.5° line through a corner; y = x/3.
const targets = {
  "x=1/3": [[1/3, 0], [1/3, 1]],
  "x=1/5": [[0.2, 0], [0.2, 1]],
  "x=1/7": [[1/7, 0], [1/7, 1]],
  "x=3/7": [[3/7, 0], [3/7, 1]],
  "x=5/12": [[5/12, 0], [5/12, 1]],
  "22.5 from sw": [[0, 0], [1, Math.tan(Math.PI / 8)]],
  "y=x/3": [[0, 0], [1, 1/3]],
  "x=1/3 via 2 other pts": [[1/3, 0.2], [1/3, 0.9]],
};

// 1. Determinism / cross-query leakage: A, B, A, A
const a1 = await f.solveLine(...targets["x=1/3"]);
const b1 = await f.solveLine(...targets["y=x/3"]);
const a2 = await f.solveLine(...targets["x=1/3"]);
const a3 = await f.solveLine(...targets["x=1/3"]);
console.log("A==A(after B):", JSON.stringify(a1.solutions) === JSON.stringify(a2.solutions), "A==A again:", JSON.stringify(a2.solutions) === JSON.stringify(a3.solutions));

// 2. Query-setting sensitivity per target
for (const [name, [p1, p2]] of Object.entries(targets)) {
  console.log(`\n== ${name}`);
  for (const opts of [
    { count: 5, goodEnoughError: 0.005, worstCase: 1 },
    { count: 5, goodEnoughError: 1e-9, worstCase: 1 },
    { count: 5, goodEnoughError: 0.005, worstCase: 0 },
    { count: 10, goodEnoughError: 0.005, worstCase: 1 },
    { count: 1, goodEnoughError: 0.005, worstCase: 1 },
  ]) {
    const r = await f.solveLine(p1, p2, opts);
    const exact = r.solutions.filter(s => s.err < 1e-9);
    console.log(`  ${JSON.stringify(opts)} -> ${r.solutions.length} sols, ${exact.length} exact (min exact rank ${exact.length ? Math.min(...exact.map(s=>s.rank)) : "-"}): ${summarize(r)}`);
  }
}
process.exit(0);
