// Claim 7 verification against the REAL ReferenceFinder wasm: run the spike's greedy stuck-handler on a
// small CP and compare with an exhaustive search over (target, solution) choices at every stuck event.
// usage: node claim7-verify.mjs [candidateIndex|json-lines-spec] [--rank=6]
import { readFileSync } from "node:fs";
import { createFinder } from "./rf.mjs";
import { lineFromPoints, lineKey, State, construct } from "./spike-lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith("--")).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "1"]; }));
const RANK = Number(args.rank ?? 6);
const W = 1, H = 1;
const seg = (a, b) => lineFromPoints(a, b);

// ---- RF step extraction (copied from spike-closure.mjs) ----
function rfSolutionLines(sol) {
  const out = []; const needDiag = new Set(); let j = 0;
  for (const step of sol.steps) {
    for (const f of ["p0", "p1", "l0", "l1"]) if (step[f] === "sw_ne" || step[f] === "nw_se") needDiag.add(step[f]);
    if (step.axiom === 0) continue;
    const diag = sol.diagrams[j++];
    const want = step.pinch ? 7 : 3;
    const el = diag && diag.find(e => e && e.type === 1 && e.style === want);
    if (el) out.push({ line: lineFromPoints(el.from, el.to), axiom: step.axiom, pinch: !!step.pinch });
  }
  const diagonals = [...needDiag].map(k => ({ line: k === "sw_ne" ? lineFromPoints([0, 0], [W, H]) : lineFromPoints([0, H], [W, 0]), axiom: 1, diagonal: true }));
  return { lines: out, diagonals };
}
const desc = (l) => {
  const edges = [{ n: [1, 0], d: 0 }, { n: [1, 0], d: 1 }, { n: [0, 1], d: 0 }, { n: [0, 1], d: 1 }];
  const pts = [];
  for (const e of edges) { const det = l.n[0] * e.n[1] - l.n[1] * e.n[0]; if (Math.abs(det) < 1e-12) continue; const p = [(l.d * e.n[1] - e.d * l.n[1]) / det, (l.n[0] * e.d - e.n[0] * l.d) / det]; if (p[0] > -1e-7 && p[0] < 1 + 1e-7 && p[1] > -1e-7 && p[1] < 1 + 1e-7 && !pts.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1e-6)) pts.push(p); }
  return pts.map(p => `(${p[0].toFixed(4)},${p[1].toFixed(4)})`).join("—");
};

const rf = await createFinder({ rank: RANK, width: W, height: H });
console.log(`RF rank ${RANK} built in ${rf.buildMs.toFixed(0)}ms`, rf.dbInfo);
const cache = new Map();
async function solve(l) {
  const k = lineKey(l); if (cache.has(k)) return cache.get(k);
  const p0 = [l.n[0] * l.d, l.n[1] * l.d], p1 = [p0[0] - l.n[1], p0[1] + l.n[0]];
  const r = await rf.solveLine(p0, p1, { count: 5 });
  const sols = r.solutions.filter(s => s.err <= 1e-6).map(s => ({ ...s, ...rfSolutionLines(s) }));
  cache.set(k, sols); return sols;
}
const clone = (st) => { const c = new State(W, H); for (const [k, l] of st.L) if (l.tag !== "edge") c.addLine(l, l.tag); return c; };
function closure(st, remaining) {
  let folded = [];
  for (;;) {
    const next = []; let any = false;
    for (const l of remaining) { const ax = construct(st, l); if (ax) { st.addLine(l, "cp"); folded.push({ l, ax }); any = true; } else next.push(l); }
    remaining = next; if (!any) break;
  }
  return { remaining, folded };
}
// options at a stuck event: for each remaining target, each exact solution → fresh lines
async function options(st, remaining) {
  const opts = [];
  for (const t of remaining) for (const sol of await solve(t)) {
    const fresh = [...sol.diagonals, ...sol.lines].filter(x => x.line && !st.hasLine(x.line));
    const aux = fresh.filter(x => !remaining.some(r => lineKey(r) === lineKey(x.line)));
    opts.push({ target: t, sol, fresh, cost: fresh.length, aux: aux.length });
  }
  return opts;
}
function applyOption(st, remaining, opt) {
  let auxN = 0;
  for (const x of opt.fresh) { const isT = remaining.some(r => lineKey(r) === lineKey(x.line)); st.addLine(x.line, isT ? "cp" : "aux"); if (!isT) auxN++; }
  if (!st.hasLine(opt.target)) st.addLine(opt.target, "cp");
  return { auxN, remaining: remaining.filter(l => !st.hasLine(l)) };
}
async function greedy(targets, log = true) {
  const st = new State(W, H); let rem = closure(st, targets).remaining; let aux = 0; const trace = [];
  if (log) console.log(`  closure0 folded ${targets.length - rem.length}/${targets.length}`);
  while (rem.length) {
    const opts = await options(st, rem);
    if (!opts.length) { trace.push("NO EXACT SOLUTION"); break; }
    let best = null; for (const o of opts) if (!best || o.cost < best.cost) best = o; // first-min, like the spike
    if (log) for (const o of opts) console.log(`    opt target=${desc(o.target)} rank=${o.sol.rank} cost(fresh)=${o.cost} aux=${o.aux} fresh=[${o.fresh.map(x => desc(x.line)).join(" | ")}]`);
    const r = applyOption(st, rem, best); aux += r.auxN;
    const c = closure(st, r.remaining); rem = c.remaining;
    trace.push(`pick ${desc(best.target)} +${r.auxN} aux; closure +${c.folded.length}`);
    if (log) console.log(`    → GREEDY picks ${desc(best.target)} (+${r.auxN} aux), closure unlocks ${c.folded.length}, remaining ${rem.length}`);
  }
  return { aux, trace, unsolved: rem.length };
}
async function best(targets) { // exhaustive over choices
  let bestAux = Infinity, bestTrace = null;
  async function rec(st, rem, aux, trace) {
    if (aux >= bestAux) return;
    if (!rem.length) { bestAux = aux; bestTrace = trace; return; }
    const opts = await options(st, rem);
    for (const o of opts) {
      const st2 = clone(st); const r = applyOption(st2, rem, o); const c = closure(st2, r.remaining);
      await rec(st2, c.remaining, aux + r.auxN, [...trace, `pick ${desc(o.target)} via ${o.fresh.map(x => desc(x.line)).join(" | ")} (+${r.auxN} aux); closure +${c.folded.length}`]);
    }
  }
  const st = new State(W, H); const c0 = closure(st, targets);
  await rec(st, c0.remaining, 0, []);
  return { aux: bestAux, trace: bestTrace };
}

// ---- CP specs ----
const specs = {
  // A: x=1/4 ; B: y = x/2 + 5/8  (through (0,5/8) and (3/4,1))
  c1: [seg([0.25, 0], [0.25, 1]), seg([0, 0.625], [0.75, 1])],
};
let toRun = [];
if (process.argv[2] && !process.argv[2].startsWith("--")) {
  if (specs[process.argv[2]]) toRun = [[process.argv[2], specs[process.argv[2]]]];
  else { const cands = JSON.parse(readFileSync("./claim7-candidates.json", "utf8")); const idx = process.argv[2].split(",").map(Number); for (const i of idx) toRun.push([`cand${i}`, [cands[i].Aline, cands[i].Bline]]); }
} else toRun = Object.entries(specs);

for (const [name, targets] of toRun) {
  console.log(`\n=== ${name}: ${targets.map(desc).join("  ;  ")} ===`);
  const g = await greedy(targets);
  const b = await best(targets);
  console.log(`  GREEDY aux=${g.aux} unsolved=${g.unsolved}  trace: ${g.trace.join(" → ")}`);
  console.log(`  BEST   aux=${b.aux}  trace: ${b.trace?.join(" → ")}`);
  console.log(`  GAP = ${g.aux - b.aux}`);
}
process.exit(0);
