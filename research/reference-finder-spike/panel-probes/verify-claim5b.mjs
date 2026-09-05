import { createFinder } from "./rf.mjs";
const T = { "x=1/5": [[0.2,0],[0.2,1]], "x=1/7": [[1/7,0],[1/7,1]], "x=3/7": [[3/7,0],[3/7,1]], "x=1/3": [[1/3,0],[1/3,1]], "x=5/12": [[5/12,0],[5/12,1]] };
const sum = (r) => r.solutions.map(s => `r${s.rank} err=${s.err.toExponential(2)} steps=${s.steps.length} ax=[${s.steps.map(x=>x.axiom).join("")}]`).join(" | ");
const run = async (label, opts) => {
  const f = await createFinder(opts);
  console.log(`\n### ${label}: build ${f.buildMs.toFixed(0)}ms`, f.dbInfo);
  const out = {};
  for (const [n, [p1, p2]] of Object.entries(T)) {
    const r = await f.solveLine(p1, p2, { count: 5, goodEnoughError: 1e-9 });
    out[n] = r.solutions;
    console.log(`  ${n}: ${sum(r)}`);
  }
  return out;
};
const base1 = await run("default rank6 (A)", { rank: 6 });
const base2 = await run("default rank6 (B, rebuilt)", { rank: 6 });
console.log("\nbuild A == build B (all 5 targets, full JSON):", JSON.stringify(base1) === JSON.stringify(base2));
const prio = await run("reversed axiom priority 1456732", { rank: 6, axiomPriority: [1,4,5,6,7,3,2] });
for (const n of Object.keys(T)) console.log(`  ${n}: exact steps same as default? `, JSON.stringify(base1[n].filter(s=>s.err<1e-9).map(s=>s.steps)) === JSON.stringify(prio[n].filter(s=>s.err<1e-9).map(s=>s.steps)));
await run("maxLines=3e6 maxMarks=3e6 rank6", { rank: 6, maxLines: 3000000, maxMarks: 3000000 });
await run("numA=numD=numX=numY=50000 rank6", { rank: 6, numA: 50000, numD: 50000, numX: 50000, numY: 50000 });
await run("rank 7 default caps", { rank: 7 });
process.exit(0);
