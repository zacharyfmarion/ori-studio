import { V, H, T, greedy, exact, closure, cloneState, forwardCandidates, fmt } from "./probe.mjs";
import { loadCP, lineFromPoints, lineKey, State } from "./geom.mjs";
const R = "/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/stoic-nightingale-47aa90/";
const load = (path) => { const { segs, width, height } = loadCP(path); const st = new State(width, height); const m = new Map(); for (const s of segs) { const l = lineFromPoints(s.a, s.b); if (l && !st.hasLine(l)) m.set(lineKey(l), l); } return { targets: [...m.values()], width, height }; };
const fx = { kabuto: load(R + "tests/fixtures/flat-folder/kabuto.fold"), sample1: load(R + "tests/fixtures/oriedita/solution_sample_1.cp"), frog: load(R + "crates/oristudio-cp/resources/default-molecules/frog_base.fold") };

/** forward-first stuck handler: smallest aux set (≤maxDepth, forward O1-O5,O7) that unlocks ≥1 CP line, preferring most unlocked; RF fallback */
async function forwardFirst(width, height, targets, { maxDepth = 2 } = {}) {
  const cpKeys = new Set(targets.map(lineKey));
  let st = new State(width, height); let rem = closure(st, targets.filter(t => !st.hasLine(t)));
  const aux = []; let rfFallbacks = 0, closures = 0;
  while (rem.length) {
    let best = null;
    const search = (s, r, depth, chosen) => {
      const cands = forwardCandidates(s).filter(l => !cpKeys.has(lineKey(l)));
      for (const c of cands) {
        const s2 = cloneState(s); s2.addLine(c, "aux"); const r2 = closure(s2, r); closures++;
        const unlocked = r.length - r2.length;
        if (unlocked > 0) { const sc = [chosen.length + 1, -unlocked]; if (!best || sc[0] < best.sc[0] || (sc[0] === best.sc[0] && sc[1] < best.sc[1])) best = { sc, aux: [...chosen, c], st: s2, rem: r2 }; }
        else if (depth + 1 < maxDepth && (!best || best.sc[0] >= depth + 2)) search(s2, r2, depth + 1, [...chosen, c]);
      }
    };
    search(st, rem, 0, []);
    if (!best) { // RF fallback: spike-style single step
      rfFallbacks++;
      const g = await greedy(width, height, [...rem], { topk: 5 }); // approximate: restart from bare state is not equivalent; count its aux as fallback cost
      return { aux: aux.length + g.aux.length, rfFallbacks, closures, note: "rf-fallback(approx)" };
    }
    aux.push(...best.aux); st = best.st; rem = best.rem;
  }
  return { aux: aux.length, rfFallbacks, closures, auxLines: aux };
}
const D1 = T([0,0],[1,1]), D2 = T([0,1],[1,0]);
const g3 = [V(1/3), V(2/3), H(1/3), H(2/3), D1, D2];
const probes = {
  grid3: [V(1/3), V(2/3), H(1/3), H(2/3)], grid3_diag: g3, grid6: [1,2,3,4,5].flatMap(i => [V(i/6), H(i/6)]).concat([D1, D2, T([1/6,0],[1,5/6]), T([0,1/6],[5/6,1])]),
  g3d_x19: [...g3, V(1/9)], g3d_x112: [...g3, V(1/12)], x13_x38: [V(1/3), V(3/8)], x13_diag_pair: [V(1/3), T([0,0],[1,1/3])],
  thirds_and_fifths: [V(1/3), V(2/3), V(1/5), V(2/5), V(3/5), V(4/5)], x13_x19: [V(1/3), V(1/9)], x15_only: [V(1/5)],
};
console.log("CP                 greedy(spike)   forward-first(≤2)            exact(≤3,noO6)");
for (const [name, targets] of Object.entries(probes)) {
  const g = await greedy(1, 1, targets, { topk: 5 });
  const t0 = performance.now(); const ff = await forwardFirst(1, 1, targets); const tf = performance.now() - t0;
  const ex = exact(1, 1, targets, 3);
  console.log(`${name.padEnd(18)} ${String(g.aux.length + (g.unsolved ? `+${g.unsolved}uns` : "")).padEnd(15)} ${String(ff.aux + (ff.note ? " " + ff.note : "")).padEnd(6)} ${String(ff.closures).padStart(6)} closures ${tf.toFixed(0).padStart(5)}ms   ${ex.aux ? ex.aux.length : ">3"}`);
}
for (const [name, { targets, width, height }] of Object.entries(fx)) {
  const g = await greedy(width, height, targets, { topk: 5 });
  const t0 = performance.now(); const ff = await forwardFirst(width, height, targets); const tf = performance.now() - t0;
  console.log(`${name.padEnd(18)} ${String(g.aux.length).padEnd(15)} ${String(ff.aux + (ff.note ? " " + ff.note : "")).padEnd(6)} ${String(ff.closures).padStart(6)} closures ${tf.toFixed(0).padStart(5)}ms   (exact≤1: ${exact(width, height, targets, 1).aux ? 1 : "none"})`);
}
// lookahead order dependence on kabuto
const t = fx.kabuto.targets; const perms = [t, [...t].reverse(), [...t].sort((a,b)=>a.d-b.d), [...t].sort((a,b)=>b.d-a.d), [...t.slice(1), t[0]], [...t.slice(-1), ...t.slice(0,-1)]];
const la = []; for (const p of perms) la.push((await greedy(fx.kabuto.width, fx.kabuto.height, p, { topk: 5, lookahead: true })).aux.length);
console.log(`\nkabuto lookahead-greedy aux by order: ${la.join(" ")}   (spike greedy was 2 1 3 1 2 1)`);
process.exit(0);
