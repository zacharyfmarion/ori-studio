import { V, H, T, greedy, exact, closure, fmt } from "./probe.mjs";
import { loadCP, lineFromPoints, lineKey, State, construct } from "./geom.mjs";
const R = "/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/stoic-nightingale-47aa90/";
const load = (path) => { const { segs, width, height } = loadCP(path); const st = new State(width, height); const m = new Map(); for (const s of segs) { const l = lineFromPoints(s.a, s.b); if (l && !st.hasLine(l)) m.set(lineKey(l), l); } return { targets: [...m.values()], width, height }; };
const fx = { kabuto: load(R + "tests/fixtures/flat-folder/kabuto.fold"), sample1: load(R + "tests/fixtures/oriedita/solution_sample_1.cp") };
// (1) replay with axiom labels
for (const [name, { targets, width, height }] of Object.entries(fx)) {
  const ex = exact(width, height, targets, 1);
  const st = new State(width, height); const seq = []; let rem = closure(st, targets.filter(t => !st.hasLine(t)), seq);
  for (const a of ex.aux) { const ax = construct(st, a); st.addLine(a, "aux"); seq.push({ line: a, axiom: ax, kind: "aux" }); rem = closure(st, rem, seq); }
  console.log(`\n== ${name}: replay of 1-aux solution (${seq.length} folds, remaining ${rem.length}) ==`);
  seq.forEach((s, i) => console.log(`  ${String(i+1).padStart(2)}. O${s.axiom} ${s.kind.padEnd(3)} ${fmt(s.line)}`));
}
// (2) order dependence of the spike-equivalent greedy
console.log(`\n== order dependence (spike scoring, top-5, no lookahead) ==`);
const D1 = T([0,0],[1,1]), D2 = T([0,1],[1,0]);
const sets = { g3d_x19: [V(1/3), V(2/3), H(1/3), H(2/3), D1, D2, V(1/9)], kabuto: fx.kabuto.targets, sample1: fx.sample1.targets };
for (const [name, targets] of Object.entries(sets)) {
  const w = name === "g3d_x19" ? 1 : fx[name].width, h = name === "g3d_x19" ? 1 : fx[name].height;
  const counts = [];
  const perms = [targets, [...targets].reverse(), [...targets].sort((a,b)=>a.d-b.d), [...targets].sort((a,b)=>b.d-a.d), [...targets.slice(1), targets[0]], [...targets.slice(-1), ...targets.slice(0,-1)]];
  for (const p of perms) { const g = await greedy(w, h, p, { topk: 5 }); counts.push(g.aux.length); }
  console.log(`  ${name.padEnd(8)} aux by target order [given, reversed, by d asc, by d desc, rot+1, rot-1]: ${counts.join(" ")}`);
}
// (3) price of a complete depth-2 exhaustive search (CP needs 3 aux → budget 2 enumerates the whole depth-2 space)
for (const [name, targets] of Object.entries({ g3_nodiag_x19: [V(1/3), V(2/3), H(1/3), H(2/3), V(1/9)], x14_x13: [V(1/4), V(1/3)], thirds_and_fifths: [V(1/3), V(2/3), V(1/5), V(2/5), V(3/5), V(4/5)] })) {
  const t0 = performance.now(); const ex = exact(1, 1, targets, 2, { verbose: false });
  console.log(`  exhaustive ≤2 on ${name}: ${ex.aux ? "found " + ex.aux.length : "proved none"} in ${ex.nodes} nodes, ${(performance.now()-t0).toFixed(0)}ms (JS, no memo across budgets)`);
}
process.exit(0);
