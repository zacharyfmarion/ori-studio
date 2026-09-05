import { V, H, T, greedy, exact, closure, fmt } from "./probe.mjs";
import { State, construct, lineKey } from "./geom.mjs";
const D1 = T([0,0],[1,1]), D2 = T([0,1],[1,0]);
const g3 = [V(1/3), V(2/3), H(1/3), H(2/3), D1, D2];
const cps = { g3d_x19: [...g3, V(1/9)], x13_x38: [V(1/3), V(3/8)], x13_diag_pair: [V(1/3), T([0,0],[1,1/3])], g3d_x112: [...g3, V(1/12)] };
for (const [name, targets] of Object.entries(cps)) {
  const ex = exact(1, 1, targets, 3);
  console.log(`\n== ${name}: exact ${ex.aux.length} aux — replay ==`);
  const st = new State(1, 1); const seq = [];
  let rem = closure(st, targets.filter(t => !st.hasLine(t)), seq);
  for (const a of ex.aux) {
    const ax = construct(st, a);   // label the aux with the (inverse) axiom that constructs it from the current state
    st.addLine(a, "aux"); seq.push({ line: a, axiom: ax, kind: "aux" });
    rem = closure(st, rem, seq);
  }
  seq.forEach((s, i) => console.log(`  ${String(i+1).padStart(2)}. O${s.axiom} ${s.kind.padEnd(3)} ${fmt(s.line)}`));
  console.log(`  remaining: ${rem.length}`);
}
console.log(`\n== g3d_x19: greedy depth-0 candidates (spike scoring = fresh count, first wins ties) ==`);
await greedy(1, 1, cps.g3d_x19, { topk: 5, log: true, beam: 1 });
process.exit(0);
