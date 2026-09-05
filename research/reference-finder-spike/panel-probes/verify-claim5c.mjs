import { createFinder } from "./rf.mjs";
const targets = [];
for (const n of [3,4,5,6,7,8,9,10,12,16]) for (let k = 1; k < n; k++) if (gcd(k,n)===1) targets.push([`x=${k}/${n}`, [[k/n,0],[k/n,1]]]);
function gcd(a,b){return b?gcd(b,a%b):a}
async function sweep(label, opts, q) {
  const f = await createFinder(opts);
  const missing = [];
  for (const [n,[p1,p2]] of targets) {
    const r = await f.solveLine(p1, p2, q);
    const ex = r.solutions.filter(s=>s.err<1e-6);
    if (!ex.length) missing.push(`${n}(best r${r.solutions[0].rank} ${r.solutions[0].err.toExponential(1)})`);
  }
  console.log(`${label} [${JSON.stringify(q)}] build ${f.buildMs.toFixed(0)}ms: ${targets.length-missing.length}/${targets.length} exact; missing: ${missing.join(", ")}`);
  return f;
}
const f = await sweep("default rank6", { rank: 6 }, { count: 5, goodEnoughError: 0.005 });
// same DB, different query settings
{
  const q = { count: 5, goodEnoughError: 1e-9 }; const missing = [];
  for (const [n,[p1,p2]] of targets) { const r = await f.solveLine(p1,p2,q); if (!r.solutions.some(s=>s.err<1e-6)) missing.push(n); }
  console.log(`default rank6 [${JSON.stringify(q)}]: ${targets.length-missing.length}/${targets.length} exact; missing: ${missing.join(", ")}`);
  const q2 = { count: 1, goodEnoughError: 0.005 }; const missing2 = [];
  for (const [n,[p1,p2]] of targets) { const r = await f.solveLine(p1,p2,q2); if (!r.solutions.some(s=>s.err<1e-6)) missing2.push(n); }
  console.log(`default rank6 [${JSON.stringify(q2)}]: ${targets.length-missing2.length}/${targets.length} exact; missing: ${missing2.join(", ")}`);
}
await sweep("numA=numD=50000 rank6", { rank: 6, numA: 50000, numD: 50000, numX: 50000, numY: 50000 }, { count: 5, goodEnoughError: 1e-9 });
await sweep("paper 0.84x1 default rank6 (targets are x=k/n of WIDTH 1 → some fall off-paper)", { rank: 6, width: 0.84, height: 1 }, { count: 5, goodEnoughError: 1e-9 });
process.exit(0);
