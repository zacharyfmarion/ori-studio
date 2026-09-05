import { V, H, T, rfSolutions, closure, cloneState, forwardCandidates, fmt } from "./probe.mjs";
import { State, lineKey } from "./geom.mjs";
const D1 = T([0,0],[1,1]), D2 = T([0,1],[1,0]);
const targets = [V(1/3), V(2/3), H(1/3), H(2/3), D1, D2, V(1/9)];
const cpKeys = new Set(targets.map(lineKey));
const st = new State(1,1); const rem = closure(st, targets.filter(t => !st.hasLine(t)));
console.log(`first stuck event: remaining ${rem.map(fmt).join(", ")}`);
for (const l of rem) {
  for (const { sol, lines, diagonals } of await rfSolutions(l, 5)) {
    const fresh = [...diagonals, ...lines].filter(x => x.line && !st.hasLine(x.line));
    const aux = fresh.filter(x => !cpKeys.has(lineKey(x.line)));
    const s2 = cloneState(st); for (const x of fresh) s2.addLine(x.line, "x"); if (!s2.hasLine(l)) s2.addLine(l, "cp");
    const r2 = closure(s2, rem.filter(t => !s2.hasLine(t)));
    console.log(`  target ${fmt(l).padEnd(9)} spike-cost(fresh)=${fresh.length} aux=${aux.length} → after closure remaining=${r2.length}   aux=[${aux.map(x=>fmt(x.line)).join("; ")}]`);
  }
}
// forward one-aux candidate set size at this stuck state, and how many of them finish the CP
let t0 = performance.now();
const cands = forwardCandidates(st);
const tGen = performance.now() - t0; t0 = performance.now();
let finishers = [], unlockAny = 0;
for (const c of cands) { if (cpKeys.has(lineKey(c))) continue; const s2 = cloneState(st); s2.addLine(c, "aux"); const r2 = closure(s2, rem); if (r2.length < rem.length) unlockAny++; if (r2.length === 0) finishers.push(c); }
console.log(`\nforward 1-aux candidates from this state (|L|=${st.L.size}, |P|=${st.P.size}): ${cands.length} lines, generated in ${tGen.toFixed(1)}ms; closure-tested in ${(performance.now()-t0).toFixed(0)}ms; ${unlockAny} unlock ≥1 CP line; ${finishers.length} finish everything alone`);
process.exit(0);
